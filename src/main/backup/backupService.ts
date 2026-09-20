/**
 * 备份服务（M5 批次③，docs/03 §2.2 / 宪法 A.4-9）：每日自动备份 + 手动立即备份 +
 * 列表 + 完整性校验还原。备份即库文件整文件复制（WAL 下先 checkpoint 冲刷再复制），
 * 滚动保留最近 7 份（retention 纯函数承载）；还原先复制到库文件同目录临时文件并经
 * 独立只读连接执行 integrity_check，通过后 checkpoint + rename 原子覆盖。
 * 职责切分（D11）：本服务不摸数据库连接（checkpoint 由装配层供给）、不摸窗口（onDone
 * 供给 backup:done 广播）、不摸应用生命周期（还原成功后 relaunch 由 IPC/app 层触发），
 * 亦不摸钟（todayIsoDate 由调用方传入，保持可测性）。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { E_BACKUP_CORRUPT, E_BACKUP_FAILED, E_BACKUP_NOT_FOUND } from '../../shared/errors';
import { AppError } from '../../shared/result';
import { toLocalIsoTime } from '../../shared/time';
import type { BackupEntry } from '../../shared/backup-contract';
import { RETENTION_KEEP, isAutoBackupDue, selectBackupsToPrune } from './retention';

export interface BackupServiceDeps {
  /** 备份目录绝对路径（<dataDir>/backups，dataDir 布局供给） */
  readonly backupsDir: string;
  /** 当前库文件绝对路径 */
  readonly dbFile: string;
  /**
   * WAL checkpoint 供给（store/app 层装配，A.4-9）。常规建份路径语义为 TRUNCATE 冲刷；
   * 还原替换点由装配层实现为「干净关闭释放文件锁」——Windows 下打开中的库文件禁止
   * rename 覆盖/删除（实测 EPERM/EBUSY），干净关闭自带最终 checkpoint 与 -wal/-shm 清理，
   * 是替换前一致性准备的最强形态。服务只保证「替换前恰好调用一次」。
   */
  readonly checkpoint: () => void;
  /** backup:done 广播供给（app 层遍历窗口 webContents.send），建份成功后收到文件名 */
  readonly onDone: (fileName: string) => void;
}

/** 备份文件名形态：lt-YYYYMMDD-HHMMSS.db；捕获组供「最近备份日」提取 */
const BACKUP_FILE_RE = /^lt-(\d{4})(\d{2})(\d{2})-\d{6}\.db$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 当前时刻 → 备份文件名（本地时区；同秒内重复建份覆盖同名文件，仍为一份完整备份） */
function formatBackupFileName(date: Date): string {
  return (
    `lt-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.db`
  );
}

/** 文件名 → 本地日期串（YYYY-MM-DD）：名形合法性由唯一调用方 listBackupFileNames 过滤保证 */
function datePartOf(fileName: string): string {
  // 名形已过校验：日期段为定长字段，固定偏移切片即安全（lt-YYYYMMDD-HHMMSS.db）
  return `${fileName.slice(3, 7)}-${fileName.slice(7, 9)}-${fileName.slice(9, 11)}`;
}

/**
 * 对备份副本做完整性校验：独立只读连接执行 PRAGMA integrity_check。
 * 打开失败、执行抛错、结论非 ok 三态同归 false（损坏语义面），调用方据此抛 E_BACKUP_CORRUPT。
 */
function verifyIntegrity(file: string): boolean {
  try {
    const conn = new Database(file, { readonly: true });
    try {
      return conn.pragma('integrity_check', { simple: true }) === 'ok';
    } finally {
      conn.close();
    }
  } catch {
    return false;
  }
}

export class BackupService {
  private readonly deps: BackupServiceDeps;

  constructor(deps: BackupServiceDeps) {
    this.deps = deps;
  }

  /**
   * 创建备份：checkpoint → 整文件复制 → 滚动裁剪 → onDone。
   * @returns 新建备份文件名（lt-YYYYMMDD-HHMMSS.db）
   * @throws AppError(E_BACKUP_FAILED) checkpoint/复制/裁剪计数等 IO 环节失败
   */
  create(): { readonly fileName: string } {
    try {
      // 幂等建目录（首启由 ensureDataDir 创建；直驱服务场景兜底）
      mkdirSync(this.deps.backupsDir, { recursive: true });
      // A.4-9：复制前完成 WAL checkpoint（还原路径供给方实现为干净关闭，语义见 deps 注）
      this.deps.checkpoint();
      const fileName = formatBackupFileName(new Date());
      copyFileSync(this.deps.dbFile, path.join(this.deps.backupsDir, fileName));
      this.pruneOldBackups();
      const size = statSync(path.join(this.deps.backupsDir, fileName)).size;
      console.info(`[backup] 已创建备份 ${fileName}（${String(size)} 字节）`);
      this.deps.onDone(fileName);
      return { fileName };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      console.error('[backup] 创建备份失败', error);
      throw new AppError(E_BACKUP_FAILED, '创建备份失败，请检查磁盘与数据目录');
    }
  }

  /**
   * 列出备份条目（新→旧）：文件名/字节数/修改时刻取自真实目录。
   * @returns 备份条目列表（目录不存在或为空返回空数组）
   */
  list(): readonly BackupEntry[] {
    const entries: BackupEntry[] = [];
    for (const fileName of this.listBackupFileNames()) {
      const stat = statSync(path.join(this.deps.backupsDir, fileName));
      entries.push({
        fileName,
        sizeBytes: stat.size,
        modifiedAt: toLocalIsoTime(stat.mtime),
      });
    }
    // 升序装载后整体倒序：新→旧为列表展示时序
    return entries.reverse();
  }

  /**
   * 还原到指定备份：存在性 → 复制到库文件同目录临时文件 → integrity 校验 →
   * checkpoint（还原路径供给方实现为关库）→ rename 原子覆盖。
   * @param fileName 目标备份文件名（渲染端入参：名形不合法/不存在同归「未找到」，防路径逃逸）
   * @throws AppError(E_BACKUP_NOT_FOUND) 名形不合法或文件已不存在
   * @throws AppError(E_BACKUP_CORRUPT) 完整性校验未通过（临时文件已清理）
   * @throws AppError(E_BACKUP_FAILED) 复制/替换环节 IO 失败（临时文件已清理）
   */
  restore(fileName: string): void {
    // 名形校验拒绝路径逃逸（../、绝对路径等），与存在性校验同归「未找到」语义
    const source = path.join(this.deps.backupsDir, fileName);
    if (!BACKUP_FILE_RE.test(fileName) || !existsSync(source)) {
      throw new AppError(E_BACKUP_NOT_FOUND, '备份不存在或已被滚动清理');
    }
    // 临时文件置于库文件同目录：与目标同卷 rename 才具备原子覆盖语义
    const tmp = `${this.deps.dbFile}.restore-tmp`;
    try {
      copyFileSync(source, tmp);
    } catch (error: unknown) {
      this.cleanupTmp(tmp);
      console.error(`[backup] 还原失败：复制备份 ${fileName} 到临时文件出错`, error);
      throw new AppError(E_BACKUP_FAILED, '还原失败：备份文件无法读取');
    }
    if (!verifyIntegrity(tmp)) {
      this.cleanupTmp(tmp);
      console.error(`[backup] 还原失败：备份 ${fileName} 完整性校验未通过`);
      throw new AppError(E_BACKUP_CORRUPT, '备份文件已损坏，无法还原');
    }
    try {
      // A.4-9：替换前冲刷当前库（还原路径供给方此刻干净关闭释放文件锁）
      this.deps.checkpoint();
      renameSync(tmp, this.deps.dbFile);
      // 替换成功同样扫清 integrity 校验期创建的 WAL 伴生残留（文件名含 restore-tmp，无害但禁留）
      this.cleanupTmp(tmp);
    } catch (error: unknown) {
      this.cleanupTmp(tmp);
      console.error(`[backup] 还原失败：替换当前库文件出错（${fileName}）`, error);
      throw new AppError(E_BACKUP_FAILED, '还原失败：当前库文件无法替换');
    }
    const size = statSync(this.deps.dbFile).size;
    console.info(`[backup] 已还原备份 ${fileName}（${String(size)} 字节），应用即将重启`);
  }

  /**
   * 每日自动备份判定入口（装配层启动期调用一次）：开关开启且最近备份日早于今天才建份。
   * 「最近备份日」取自备份目录最新文件名日期段（字典序=时间序），无任何备份视为首启到期。
   * @param todayIsoDate 本地时区日期串（app 层传入）
   * @param autoEnabled 设置域 backup.autoEnabled 开关
   */
  autoBackupIfNeeded(todayIsoDate: string, autoEnabled: boolean): void {
    if (!autoEnabled) return;
    const names = this.listBackupFileNames();
    const newest = names.at(-1) ?? null;
    const lastIso = newest === null ? null : datePartOf(newest);
    if (!isAutoBackupDue(todayIsoDate, lastIso)) return;
    try {
      this.create();
    } catch (error: unknown) {
      // 装配契约：每日自动备份失败 warn 留痕不阻断启动（用户可手动立即备份）
      console.warn('[backup] 每日自动备份未完成（不阻断启动）', error);
    }
  }

  /** 备份目录内合法名形文件名（升序=最旧在前）；目录不存在返回空（首启未建目录场景） */
  private listBackupFileNames(): readonly string[] {
    if (!existsSync(this.deps.backupsDir)) return [];
    return readdirSync(this.deps.backupsDir)
      .filter((name) => BACKUP_FILE_RE.test(name))
      .sort();
  }

  /**
   * 滚动裁剪（create 成功复制后调用，名单计入新文件）：超出 RETENTION_KEEP 的最旧份
   * 逐个删除。单份删除失败仅 warn 不回滚建份（备份本体已成功，下一轮滚动再清）。
   */
  private pruneOldBackups(): void {
    for (const fileName of selectBackupsToPrune(this.listBackupFileNames(), RETENTION_KEEP)) {
      try {
        unlinkSync(path.join(this.deps.backupsDir, fileName));
      } catch (error: unknown) {
        console.warn(`[backup] 裁剪旧备份失败：${fileName}`, error);
      }
    }
  }

  /**
   * 临时文件族清理：主文件 + WAL 伴生（-wal/-shm）。integrity 校验以只读连接打开
   * WAL 形态副本时会在临时文件旁创建伴生文件，成功替换与失败清理两条路径都须扫清，
   * 避免数据目录残留。单件失败仅 warn，不掩盖调用方的原业务错误。
   */
  private cleanupTmp(tmp: string): void {
    for (const file of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch (error: unknown) {
        console.warn('[backup] 还原临时文件清理失败', error);
      }
    }
  }
}
