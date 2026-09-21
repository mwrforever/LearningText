// 导入服务（M5 批次⑥ Task 12，FR-IO-01 / spec §7.1 D15·D16）：磁盘目录广度遍历 → 节点计划
// → 分批事务写入（每批 ≤200 节点且 ≤16MB 内容，宪法 A.5-4 大批量剥离的分批兑现——批次间
// await 让出事件循环，io:cancel 得以插队）→ 进度广播（onProgress 供给，事务提交后发——B.3-4）
// → 重名三策略（跳过 / 递增改名 / 覆盖 trash 旧节点）。写入语句与 M1 createNode 同形态
// （工厂闭包预编译一次复用 A.4-5；业务行与 FTS 同事务 A.4-4；先清 FTS 后软删 A.4-10），
// 复用 runWriteTransaction（.immediate 变体）与 vfs/mime、vfs/nodeName 领域原语，不另起炉灶。
// 真实 fs 读取经 ImportFs 抽象注入：单元测试以内存树桩驱动，生产装配 nodeFs 适配器。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import { E_IO_SOURCE_NOT_FOUND, E_VFS_NOT_FOUND, E_VFS_TYPE_MISMATCH } from '../../shared/errors';
import { MAX_FILE_BYTES } from '../../shared/vfs-contract';
import { toLocalIsoTime } from '../../shared/time';
import type { ImportProgress, ImportRequest, ImportResult } from '../../shared/io-contract';
import { runWriteTransaction } from '../store/transaction';
import { isTextualMime, lookupMimeType } from '../vfs/mime';
import { validateNodeName } from '../vfs/nodeName';
import { createSubtreeStatements } from '../vfs/subtreeScope';
import { planImportRoots, resolveConflict, type PlannedNode } from './importPlanner';

/** 分批常量（spec D15）：每批 ≤200 节点且 ≤16MB 内容字节；单文件超 16MB 自成一批（不可再分） */
const BATCH_MAX_NODES = 200;
const BATCH_MAX_BYTES = 16 * 1024 * 1024;

/** 文件系统读取抽象（service 注入，单元测试零真实磁盘 IO；A.5 依赖注入先例） */
export interface ImportFs {
  /** 列目录项（名称与是否目录）；不存在/不可读抛错由调用方按语义降级或整体失败 */
  readDir(dir: string): readonly { name: string; isDir: boolean }[];
  /** 文件字节数（读侧 50MB 预检与分批字节闸依据） */
  statSize(file: string): number;
  /** 读文件全文（写入 BLOB；超限文件不会被调用） */
  readFile(file: string): Buffer;
}

/** 生产 fs 适配器：node:fs 同步原语（扫描/读取均为 A.5-4 预算外的分批路径承载） */
export const nodeFs: ImportFs = {
  readDir: (dir) =>
    readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDir: entry.isDirectory(),
    })),
  statSize: (file) => statSync(file).size,
  readFile: (file) => readFileSync(file),
};

/** 写入期目录运行态：既有子项名集合（重名判定事实来源）与 id 映射（覆盖 trash 定位） */
interface DirState {
  readonly names: Set<string>;
  readonly byName: Map<string, { readonly id: number; readonly isDir: boolean }>;
}

/** 写入计划条目：纯函数计划 + service 侧定位信息（绝对路径与父目录相对键） */
interface PlannedEntry {
  readonly node: PlannedNode;
  readonly absPath: string;
  /** 父目录 relPath（根层为空串）；写入期经 dirIds 映射为节点 id */
  readonly parentRel: string;
}

/** 单节点写入结论（计数归因）：imported 新增 / skipped 跳过 / failed 失败 */
type WriteOutcome = 'imported' | 'skipped' | 'failed';

/** 写入期上下文（每次导入独立）：目标锚点、目录 id/路径映射与目录运行态、失败明细归集 */
interface WriteContext {
  readonly conflict: ImportRequest['conflict'];
  readonly dirIds: Map<string, number>;
  readonly dirVPaths: Map<string, string>;
  readonly dirStates: Map<string, DirState>;
  readonly failures: string[];
}

export function createImportService(deps: {
  /** SQLite 连接（主进程单例，服务禁自行开连接——与 vfs/search 同源） */
  readonly db: Database.Database;
  /** fs 读取抽象（生产 nodeFs，测试内存树桩） */
  readonly fs: ImportFs;
  /** io:progress 广播供给（app 层遍历窗口 webContents.send）；批次提交后调用（B.3-4） */
  readonly onProgress: (progress: ImportProgress) => void;
}) {
  const { db, fs, onProgress } = deps;
  // —— 语句工厂闭包（宪法 A.4-5：高频语句预编译一次复用，禁方法体内联 prepare）——
  // 目标父节点校验：未删除过滤与 vfs 服务读路径同一口径
  const stmtTargetById = db.prepare<
    number,
    { id: number; node_type: 'dir' | 'file'; virtual_path: string }
  >('SELECT id, node_type, virtual_path FROM node WHERE id = ? AND deleted_at IS NULL');
  // 目录既有子项装载（重名判定/覆盖定位的事实来源，事务前置读——spec §5 服务层不依赖报错）
  const stmtEntriesByParent = db.prepare<
    number,
    { id: number; name: string; node_type: 'dir' | 'file' }
  >('SELECT id, name, node_type FROM node WHERE parent_id = ? AND deleted_at IS NULL');
  // 节点插入与 FTS 插入：与 vfsService.createNode 同文本（对齐既有语句工厂形态）
  const stmtInsertNode = db.prepare(
    `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
     VALUES (@parentId, @nodeType, @name, @virtualPath, @mimeType, @size, @content, @contentHash, @now, @now)`,
  );
  const stmtInsertFts = db.prepare(
    'INSERT INTO node_fts (rowid, name, body) VALUES (@id, @name, @body)',
  );
  // 覆盖策略 trash 旧节点：与 vfsService.trashNode 同一 CTE 工厂（整树圈定 + A.4-10 顺序）
  const subtree = createSubtreeStatements(db);

  /** 从库装载目录运行态（首次触达该目录时一次，此后内存维护） */
  function loadDirState(dirId: number): DirState {
    const names = new Set<string>();
    const byName = new Map<string, { id: number; isDir: boolean }>();
    for (const row of stmtEntriesByParent.all(dirId)) {
      names.add(row.name);
      byName.set(row.name, { id: row.id, isDir: row.node_type === 'dir' });
    }
    return { names, byName };
  }

  /** 目录运行态惰性装载（同键幂等） */
  function ensureDirState(ctx: WriteContext, rel: string, dirId: number): DirState {
    const existing = ctx.dirStates.get(rel);
    if (existing !== undefined) return existing;
    const state = loadDirState(dirId);
    ctx.dirStates.set(rel, state);
    return state;
  }

  /** 虚拟路径拼接：根 '/' 不产生双斜杠（与 createNode 拼接语义一致） */
  function joinVPath(parentVPath: string, name: string): string {
    return parentVPath === '/' ? `/${name}` : `${parentVPath}/${name}`;
  }

  /** stat 容错：扫描期读取字节数失败按 0 字节规划，写入期读取自然失败计入 failed（不中断扫描） */
  function safeStatSize(absPath: string): number {
    try {
      return fs.statSize(absPath);
    } catch {
      return 0;
    }
  }

  /**
   * 取消进行中的导入（io:cancel invoke 唯一入口）：登记 importId，当前批完成后生效（D16）。
   * 已完成/未知 id 登记无副作用（永不与后续单调 id 命中）；本导入结束时自行清理登记。
   */
  function cancel(importId: number): void {
    cancelled.add(importId);
  }

  // 取消标志（服务内存态，主进程单例生命周期）：io:cancel 写入、批次边界读取
  const cancelled = new Set<number>();
  // importId 单调分配（进程内唯一）：进度广播携带，渲染层据此寻址取消
  let nextImportId = 1;

  /**
   * 单节点写入（批事务内逐个执行）：目录撞目录合并（三策略一致）→ 重名三策略判定 →
   * 50MB 预检 → 读内容 → 覆盖 trash → 插入业务行 + FTS。语句级失败不毒化事务：
   * 单节点异常就地计 failed，不拖垮整批（全局 §二：不逐节点打日志，明细归集统一上报）。
   */
  function writeOne(ctx: WriteContext, entry: PlannedEntry): WriteOutcome {
    try {
      const parentId = ctx.dirIds.get(entry.parentRel);
      const parentVPath = ctx.dirVPaths.get(entry.parentRel);
      // 父链缺失防御（上级目录创建失败时的连带失败，正常广度序下不可达）
      if (parentId === undefined || parentVPath === undefined) {
        ctx.failures.push(`${entry.node.relPath}（父目录不可用）`);
        return 'failed';
      }
      const state = ensureDirState(ctx, entry.parentRel, parentId);
      const existing = state.byName.get(entry.node.name);
      // 目录撞目录合并（spec §7.1：对三策略一致）——不新建不覆盖，登记映射后进入该目录继续
      if (entry.node.isDir && existing !== undefined && existing.isDir) {
        ctx.dirIds.set(entry.node.relPath, existing.id);
        ctx.dirVPaths.set(entry.node.relPath, joinVPath(parentVPath, entry.node.name));
        ensureDirState(ctx, entry.node.relPath, existing.id);
        return 'skipped';
      }
      const resolved = resolveConflict(entry.node.name, state.names, ctx.conflict);
      if (resolved.action === 'skip') {
        return 'skipped';
      }
      // 写侧 50MB 上限（E_VFS_FILE_TOO_LARGE 语义一致）：跳过计数，不发起读取（A.4-7 前置校验）
      if (!entry.node.isDir && entry.node.sizeBytes > MAX_FILE_BYTES) {
        return 'skipped';
      }
      const name = validateNodeName(resolved.name);
      const content = entry.node.isDir ? null : fs.readFile(entry.absPath);
      const mimeType = entry.node.isDir ? null : lookupMimeType(name);
      // FTS body 提取（spec §7.7）：仅文本类 MIME 入全文索引，二进制/目录 body 为空串；
      // 条件按「内容存在 → 文本判定」短路（目录 content 恒 null，无需对 mime 做可空收尾）
      let body = '';
      if (content !== null && isTextualMime(lookupMimeType(name))) {
        body = content.toString('utf8');
      }
      const now = toLocalIsoTime(new Date());
      // overwrite 命中同名（resolved 保持原名且原名存在）：先清 FTS 后整树软删（A.4-10），
      // 让出名称与路径（partial unique 仅约束活行），回收站可找回（D15 覆盖语义）
      if (existing !== undefined && resolved.name === entry.node.name) {
        subtree.stmtDeleteFts.run({ rootId: existing.id });
        subtree.stmtSoftDelete.run({ rootId: existing.id, now });
        state.names.delete(entry.node.name);
        state.byName.delete(entry.node.name);
      }
      const virtualPath = joinVPath(parentVPath, name);
      const info = stmtInsertNode.run({
        parentId,
        nodeType: entry.node.isDir ? 'dir' : 'file',
        name,
        virtualPath,
        mimeType,
        size: content === null ? 0 : content.byteLength,
        content,
        contentHash: content === null ? null : createHash('sha256').update(content).digest('hex'),
        now,
      });
      const newId = Number(info.lastInsertRowid);
      // 业务行与 FTS 索引行同事务写入（宪法 A.4-4）
      stmtInsertFts.run({ id: newId, name, body });
      // 目录运行态同步（后续兄弟/子级重名判定的事实来源）
      state.names.add(name);
      state.byName.set(name, { id: newId, isDir: entry.node.isDir });
      if (entry.node.isDir) {
        ctx.dirIds.set(entry.node.relPath, newId);
        ctx.dirVPaths.set(entry.node.relPath, virtualPath);
        ensureDirState(ctx, entry.node.relPath, newId);
      }
      return 'imported';
    } catch (error: unknown) {
      // 单节点失败明细归集（导入结束统一一条 error 上报，禁循环内逐节点日志）；
      // 非 Error 抛出值以 String 归因，不留「未知错误」盲区
      ctx.failures.push(
        `${entry.node.relPath}（${error instanceof Error ? error.message : String(error)}）`,
      );
      return 'failed';
    }
  }

  return {
    cancel,
    /**
     * 执行导入（io:import 长任务）：
     * 1. 目标父节点校验（须存在且为文件夹）；
     * 2. 扫描阶段：逐源根 readDir → planImportRoots 根层计划 → 广度遍历追加子层（父恒先于子）；
     * 3. 写入阶段：分批事务（≤200 节点且 ≤16MB）逐批提交，批间 await 让出事件循环，
     *    每批提交后发 writing 进度（B.3-4）；取消在批边界生效，未开工节点不入计数；
     * 4. 返回计数 DTO（取消亦正常返回已写入计数——渲染层 toast 收口）。
     * @throws AppError(E_IO_SOURCE_NOT_FOUND) 任一源根不可读（整单失败，零写入）
     * @throws AppError(E_VFS_NOT_FOUND / E_VFS_TYPE_MISMATCH) 目标父节点缺失或非文件夹
     */
    async importNodes(request: ImportRequest): Promise<ImportResult> {
      const importId = nextImportId;
      nextImportId += 1;
      const target = stmtTargetById.get(request.targetParentId);
      if (target === undefined) {
        throw new AppError(E_VFS_NOT_FOUND, '目标文件夹不存在或已在回收站');
      }
      if (target.node_type !== 'dir') {
        throw new AppError(E_VFS_TYPE_MISMATCH, '目标父节点必须是文件夹');
      }
      console.info(
        `[io] 导入开始 importId=${importId} 源根=${request.sourcePaths.length} 个 目标节点=${request.targetParentId} 策略=${request.conflict}`,
      );
      try {
        // —— 扫描阶段（纯读磁盘）：广度遍历产出全量写入计划 ——
        const planned: PlannedEntry[] = [];
        const scanQueue: Array<{ absDir: string; relDir: string }> = [];
        for (const [index, sourcePath] of request.sourcePaths.entries()) {
          let rootEntries: readonly { name: string; isDir: boolean }[];
          try {
            rootEntries = fs.readDir(sourcePath);
          } catch {
            // 源根失效（选择与发起之间被移动/删除）：整单失败，零写入（E_IO_SOURCE_NOT_FOUND）
            throw new AppError(E_IO_SOURCE_NOT_FOUND, '导入源路径不存在或不可读');
          }
          onProgress({
            kind: 'import',
            importId,
            phase: 'scanning',
            done: index + 1,
            total: request.sourcePaths.length,
            currentPath: sourcePath,
          });
          for (const node of planImportRoots(
            rootEntries.map((entry) => ({
              name: entry.name,
              isDir: entry.isDir,
              sizeBytes: entry.isDir ? 0 : safeStatSize(path.join(sourcePath, entry.name)),
            })),
          )) {
            planned.push({
              node,
              absPath: path.join(sourcePath, node.name),
              parentRel: '',
            });
            if (node.isDir) {
              scanQueue.push({ absDir: path.join(sourcePath, node.name), relDir: node.relPath });
            }
          }
        }
        // 广度遍历：父目录恒先于其子节点入计划（写入期父链映射的前提）；
        // for(;;)+shift 以「shift 越界即队列耗尽」作唯一出口，两分支均可被覆盖
        for (;;) {
          const frontier = scanQueue.shift();
          if (frontier === undefined) break;
          let childEntries: readonly { name: string; isDir: boolean }[] = [];
          try {
            childEntries = fs.readDir(frontier.absDir);
          } catch (error: unknown) {
            // 子目录不可读：降级为空目录导入（warn 留痕不中断，全局 §二）
            console.warn(`[io] 导入子目录不可读，按空目录处理：${frontier.absDir}`, error);
          }
          for (const entry of childEntries) {
            const absPath = path.join(frontier.absDir, entry.name);
            const relPath = `${frontier.relDir}/${entry.name}`;
            planned.push({
              node: {
                relPath,
                name: entry.name,
                isDir: entry.isDir,
                sizeBytes: entry.isDir ? 0 : safeStatSize(absPath),
              },
              absPath,
              parentRel: frontier.relDir,
            });
            if (entry.isDir) {
              scanQueue.push({ absDir: absPath, relDir: relPath });
            }
          }
        }

        // —— 写入阶段：分批事务 + 批间让出事件循环 + 提交后进度广播 ——
        const ctx: WriteContext = {
          conflict: request.conflict,
          dirIds: new Map([['', target.id]]),
          dirVPaths: new Map([['', target.virtual_path]]),
          dirStates: new Map(),
          failures: [],
        };
        let imported = 0;
        let skipped = 0;
        let failed = 0;
        let done = 0;
        const writeBatch = async (batch: readonly PlannedEntry[]): Promise<void> => {
          // 整批一事务（A.4-4/A.4-6：批量写合并单事务；事务体同步，不跨事件循环 tick）
          runWriteTransaction(db, () => {
            for (const entry of batch) {
              const outcome = writeOne(ctx, entry);
              if (outcome === 'imported') imported += 1;
              else if (outcome === 'skipped') skipped += 1;
              else failed += 1;
            }
          });
          done += batch.length;
          // B.3-4：事务提交成功后才发进度；批次粒度广播（禁逐节点）
          let currentPath = '';
          for (const entry of batch) {
            currentPath = entry.node.relPath;
          }
          onProgress({
            kind: 'import',
            importId,
            phase: 'writing',
            done,
            total: planned.length,
            currentPath,
          });
          // 批间让出事件循环（A.5-4/D15）：io:cancel 等 invoke 得以在批间插队
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
        };
        let batch: PlannedEntry[] = [];
        let batchBytes = 0;
        let stoppedByCancel = false;
        for (const entry of planned) {
          const bytes = entry.node.isDir ? 0 : entry.node.sizeBytes;
          // 双闸切批：节点数到顶，或批非空时累加字节将越 16MB（单文件超 16MB 自成一批）
          const needFlush =
            batch.length >= BATCH_MAX_NODES ||
            (batch.length > 0 && batchBytes + bytes > BATCH_MAX_BYTES);
          if (needFlush) {
            // 取消在当前批完成后生效（D16）：待写批整体弃置，不入任何计数
            if (cancelled.has(importId)) {
              stoppedByCancel = true;
              break;
            }
            await writeBatch(batch);
            batch = [];
            batchBytes = 0;
          }
          batch.push(entry);
          batchBytes += bytes;
        }
        if (!stoppedByCancel && cancelled.has(importId)) {
          stoppedByCancel = true; // 末批提交前已取消（含开工前预置）：整批弃置
        } else if (!stoppedByCancel && batch.length > 0) {
          await writeBatch(batch);
        }
        if (ctx.failures.length > 0) {
          // 失败明细单条上报（D17 控制台明细口径，全局 §二 error 级）
          console.error(
            `[io] 导入失败项 importId=${importId} 共 ${ctx.failures.length}：${ctx.failures.join('；')}`,
          );
        }
        if (stoppedByCancel) {
          console.info(
            `[io] 导入已取消 importId=${importId} 已写入=${imported} 跳过=${skipped} 失败=${failed}`,
          );
        } else {
          console.info(
            `[io] 导入完成 importId=${importId} 新增=${imported} 跳过=${skipped} 失败=${failed}`,
          );
        }
        return { imported, skipped, failed };
      } finally {
        cancelled.delete(importId); // 取消登记随导入终结清理（内存态有界）
      }
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
