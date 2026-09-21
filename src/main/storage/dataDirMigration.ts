// 数据目录迁移服务（M6 spec §5.2，FR-AUX-03 修订版）：校验 → 预建 → 关库 → 复制 →
// 写指针 → 重启。全链路同步（better-sqlite3 关库与整文件复制均为同步原语，与备份服务
// 同口径——低频显式操作 + 结果即重启，不入交互毫秒预算，A.5-4）。失败语义（spec D9）：
// 关库前的校验/预建失败 = 未开始迁移，库照常可用、不重启；关库后的复制/指针失败 =
// 清理新目录残留、不写指针、照常重启（旧指针完好，旧位置打开）——失败代价是重启而非
// 数据损坏。服务不摸 electron（依赖注入 checkpoint/closeDatabase/relaunch/writePointer），
// fs 走注入适配器（M5 importService nodeFs 先例），失败路径可单测模拟。
import path from 'node:path';
import * as nodeFs from 'node:fs';
import { AppError } from '../../shared/result';
import { E_STORAGE_INVALID_TARGET, E_STORAGE_MIGRATE_FAILED } from '../../shared/errors';
import type { DataDirLayout } from '../store/dataDir';

/** 注入 fs 适配器（迁移链路实际消费的 node:fs 子集；测试以内存/临时目录适配器模拟失败） */
export interface DataDirMigrationFs {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean };
  mkdirSync(path: string, opts: { recursive: true }): void;
  readdirSync(path: string): string[];
  copyFileSync(src: string, dest: string): void;
  writeFileSync(path: string, data: string): void;
  rmSync(path: string, opts: { recursive: true; force: true }): void;
}

export interface DataDirMigrationDeps {
  /** userData 根（指针文件固定落点，宪法 A.2-1 修订版） */
  readonly userDataRoot: string;
  /** 当前数据布局（迁移源） */
  readonly currentLayout: DataDirLayout;
  /** WAL checkpoint（TRUNCATE）——app.ts 供给，与备份服务同款双语义供给点 */
  readonly checkpoint: () => void;
  /** 干净关库（释放文件锁；自动最终 checkpoint 并清理 -wal/-shm）——app.ts 供给 */
  readonly closeDatabase: () => void;
  /** 原子写指针（dataDir.writeDataDirPointer 闭包供给）：复制全部成功后调用 */
  readonly writePointer: (targetDir: string) => void;
  /** 重启（app.relaunch + exit，D11 同款：服务不直接摸 app） */
  readonly relaunch: () => void;
  /** fs 适配器（生产 nodeFs，测试注入） */
  readonly fs: DataDirMigrationFs;
}

/** 生产 fs 适配器（node:fs 同签名子集，importService nodeFs 先例） */
export const dataDirMigrationFs: DataDirMigrationFs = nodeFs;

/**
 * 执行数据目录迁移（同步，结果即重启）：任一环节失败按 spec §5.2 语义收场，
 * 错误经 AppError 上抛由 IPC handler 转 Result（渲染层 toast 中文呈现）。
 * @param targetDir 目标父目录（数据落 <targetDir>/LearningText，spec D8 与默认形态同构）
 */
export function changeDataDir(deps: DataDirMigrationDeps, targetDir: string): void {
  const { fs, currentLayout } = deps;
  const newRoot = path.join(targetDir, 'LearningText');

  // —— 校验（关库前，失败 = 库照常可用）——
  if (path.resolve(newRoot) === path.resolve(currentLayout.root)) {
    throw new AppError(E_STORAGE_INVALID_TARGET, '新位置与当前数据位置相同');
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new AppError(E_STORAGE_INVALID_TARGET, '目标目录不存在或不是文件夹');
  }
  // 拒绝覆盖已存在的数据目录：迁移是「建立新位置」而非「合并」，存在即拒绝语义最清晰
  // （也保证失败清理时 rmSync 只删本次创建的内容，不误伤用户既有文件）
  if (fs.existsSync(newRoot)) {
    throw new AppError(E_STORAGE_INVALID_TARGET, '目标位置已存在 LearningText 数据目录');
  }

  // —— 预建目录结构 + 可写探针（失败清理本步创建内容，直接拒绝不关库）——
  try {
    fs.mkdirSync(newRoot, { recursive: true });
    fs.mkdirSync(path.join(newRoot, 'settings'), { recursive: true });
    fs.mkdirSync(path.join(newRoot, 'backups'), { recursive: true });
    const probe = path.join(newRoot, '.lt-write-probe');
    fs.writeFileSync(probe, 'probe');
    fs.rmSync(probe, { recursive: true, force: true });
  } catch (e: unknown) {
    cleanupCreated(fs, newRoot);
    console.warn('[storage] 迁移目标不可写', e);
    throw new AppError(E_STORAGE_INVALID_TARGET, '目标目录不可写');
  }

  console.info(`[storage] 数据目录迁移开始：${currentLayout.root} -> ${newRoot}`);

  // —— checkpoint + 干净关库（closeDatabase 抛错 = 库仍可用，不迁移不重启）——
  try {
    deps.checkpoint();
    deps.closeDatabase();
  } catch (e: unknown) {
    cleanupCreated(fs, newRoot);
    console.error('[storage] 关闭数据库失败，迁移中止（应用可继续使用）', e);
    throw new AppError(E_STORAGE_MIGRATE_FAILED, '数据库关闭失败，迁移未开始');
  }

  // —— 复制 + 写指针（关库后失败：清理残留、不写指针、重启走旧位置，spec D9）——
  try {
    fs.copyFileSync(currentLayout.dbFile, path.join(newRoot, path.basename(currentLayout.dbFile)));
    copyDirFlat(fs, currentLayout.settingsDir, path.join(newRoot, 'settings'));
    copyDirFlat(fs, currentLayout.backupDir, path.join(newRoot, 'backups'));
    if (fs.existsSync(currentLayout.markerFile)) {
      fs.copyFileSync(
        currentLayout.markerFile,
        path.join(newRoot, path.basename(currentLayout.markerFile)),
      );
    }
    deps.writePointer(targetDir);
  } catch (e: unknown) {
    cleanupCreated(fs, newRoot);
    console.error('[storage] 迁移复制/写指针失败，已清理残留，重启后从原位置打开', e);
    deps.relaunch();
    return;
  }

  console.info(`[storage] 数据目录迁移完成，即将重启：${newRoot}`);
  deps.relaunch();
}

/** 清理本次迁移创建的新目录树（仅 newRoot 子树——存在性校验已保证其此前不存在） */
function cleanupCreated(fs: DataDirMigrationFs, newRoot: string): void {
  try {
    fs.rmSync(newRoot, { recursive: true, force: true });
  } catch (e: unknown) {
    // 清理失败不掩盖主错误：残留目录不参与数据一致性（旧位置未动），仅记日志
    console.warn('[storage] 清理迁移残留目录失败', e);
  }
}

/** 单层目录复制（settings/backups 均为扁平文件目录，无递归需求——YAGNI） */
function copyDirFlat(fs: DataDirMigrationFs, srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return; // 源目录缺失按空处理（新库可能尚无备份/设置文件）
  for (const entry of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
  }
}
