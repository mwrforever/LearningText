// 导出服务（M5 批次⑥ Task 13，FR-IO-02 / spec §7.1）：子树收集（parent_id 递归 CTE，
// 与导入/删除同一身份来源——createSubtreeStatements 工厂；行序按查询计划输出而非结构
// 序，写盘前按虚拟路径段数=结构深度稳定排序）→ 目标预检（写探针文件，失败
// E_IO_TARGET_UNWRITABLE 整单失败零写盘）→ 逐节点写盘（fs/promises 异步原语，写盘非
// 事务、天然让出事件循环——A.5-4 预算外路径；每 200 条目批间 setImmediate + 进度广播，
// 与导入批次粒度对称）→ text/html 节点读出经 rewriteVfsRefs 改写 vfs:// 引用后写回，
// 其余字节原样落盘。磁盘名以 validateNodeName 复检防御（库内三个写路径均已校验，此处
// 兜底：复检失败计 skipped 不写盘，绝不改写名字落盘——改写会静默合并两个不同节点到
// 同一磁盘名）。真实 fs 经 ExportFs 抽象注入：单元测试以内存记录桩驱动，生产装配
// nodeExportFs 适配器。
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import { E_IO_TARGET_UNWRITABLE, E_VFS_INVALID_NAME, E_VFS_NOT_FOUND } from '../../shared/errors';
import type { ExportProgress, ExportRequest, ExportResult } from '../../shared/io-contract';
import { SUBTREE_CTE } from '../vfs/subtreeScope';
import { validateNodeName } from '../vfs/nodeName';
import type { VfsService } from '../vfs/vfsService';
import { rewriteVfsRefs } from './paths';

/** 进度广播批大小（与导入 BATCH_MAX_NODES 同口径）：批次粒度广播 + 批间让出事件循环 */
const BATCH_MAX_NODES = 200;

/** 导出写盘 fs 抽象（service 注入，单元测试零真实磁盘 IO；ImportFs 同款先例） */
export interface ExportFs {
  /**
   * 建单层目录（非递归：写盘序经结构深度稳定排序，父目录恒先于子建目录——
   * 该不变式是本非递归实现的硬依赖，CTE 行序本身不作任何顺序假设）
   */
  mkdir(dir: string): Promise<void>;
  /** 写文件全文 */
  writeFile(file: string, content: Buffer): Promise<void>;
  /** 目标可写预检：写探针文件并即刻删除（Task 9 临时文件纪律——失败不留残迹）；不可写抛错 */
  probeWrite(dir: string): Promise<void>;
}

/** 生产 fs 适配器：fs/promises 异步原语（写盘为非事务长任务，天然让出事件循环） */
export const nodeExportFs: ExportFs = {
  mkdir: (dir) => mkdir(dir),
  writeFile: (file, content) => writeFile(file, content),
  probeWrite: async (dir) => {
    const probe = path.join(dir, '.lt-export-probe');
    await writeFile(probe, '');
    await unlink(probe);
  },
};

/** 子树收集行形态：只取计划所需列，content 留待写盘期按 id 单节点读取（A.5-4 防整树 BLOB 物化） */
interface SubtreeMetaRow {
  readonly id: number;
  readonly node_type: 'dir' | 'file';
  readonly name: string;
  readonly virtual_path: string;
  readonly mime_type: string | null;
}

/** 单条目写盘计划：虚拟路径 → 磁盘路径与导出容器相对路径的换算结果 */
interface ExportEntry {
  readonly row: SubtreeMetaRow;
  readonly diskPath: string;
  readonly relPath: string;
}

export function createExportService(deps: {
  /** SQLite 连接（主进程单例，服务禁自行开连接——与 vfs/search/io 同源） */
  readonly db: Database.Database;
  /** VFS 服务（BLOB 读取走既有 readFile 读路径：未删除校验 + 类型校验同源） */
  readonly vfs: VfsService;
  /** fs 写盘抽象（生产 nodeExportFs，测试内存记录桩） */
  readonly fs: ExportFs;
  /** io:progress 广播供给（app 层遍历窗口 webContents.send）；批次边界调用 */
  readonly onProgress: (progress: ExportProgress) => void;
}) {
  const { db, vfs, fs, onProgress } = deps;
  // —— 语句工厂闭包（宪法 A.4-5：高频语句预编译一次复用，禁方法体内联 prepare）——
  // 导出根校验：未删除过滤与 vfs 服务读路径同一口径；parent_id 供根节点拒绝判定
  const stmtRootById = db.prepare<
    number,
    {
      id: number;
      parent_id: number | null;
      name: string;
      virtual_path: string;
      deleted_at: string | null;
    }
  >('SELECT id, parent_id, name, virtual_path, deleted_at FROM node WHERE id = ?');
  // 子树元数据收集：与 trash/restore/search 同一 CTE 工厂文本组合（身份来源唯一，spec §3.2）；
  // 无删除态过滤是 CTE 契约本身（整树同态），写盘期 readFile 按未删除逐节点拒判
  const stmtSubtreeMeta = db.prepare<{ rootId: number }, SubtreeMetaRow>(
    `${SUBTREE_CTE} SELECT id, node_type, name, virtual_path, mime_type
     FROM node WHERE id IN (SELECT id FROM subtree)`,
  );

  // exportId 单调分配（进程内唯一）：进度广播携带，渲染层据此展示（无取消寻址语义）
  let nextExportId = 1;

  return {
    /**
     * 执行导出（io:export 长任务）：
     * 1. 导出根校验：须存在且未删除（回收站节点拒绝）；根节点不可导出（rename/trash 同款
     *    根拒绝先例——根无父容器，磁盘布局模型无法表达）；
     * 2. 子树收集：CTE 取全子树元数据（行序无结构保证，按虚拟路径段数=结构深度稳定
     *    排序后父恒先于子），换算磁盘路径与容器相对路径映射；
     * 3. 目标预检：写探针文件验证可写，失败 E_IO_TARGET_UNWRITABLE 整单失败零写盘；
     * 4. 写盘阶段：目录 mkdir、文件 readFile 后写盘（text/html 先经 rewriteVfsRefs 改写
     *    vfs:// 引用为相对路径），每 200 条目批间让出事件循环并发 writing 进度；
     * 5. 返回计数 DTO：单条目失败（读取拒判/写盘 IO）计 failed 不拖垮整单。
     * @throws AppError(E_VFS_NOT_FOUND) 根节点缺失 / 已在回收站 / 根节点不可导出
     * @throws AppError(E_IO_TARGET_UNWRITABLE) 目标目录不可写或不存在（零写盘）
     */
    async exportNodes(request: ExportRequest): Promise<ExportResult> {
      const exportId = nextExportId;
      nextExportId += 1;
      const root = stmtRootById.get(request.nodeId);
      if (root === undefined || root.deleted_at !== null) {
        throw new AppError(E_VFS_NOT_FOUND, '节点不存在或已在回收站');
      }
      if (root.parent_id === null) {
        throw new AppError(E_VFS_NOT_FOUND, '根节点不可导出');
      }
      console.info(
        `[io] 导出开始 exportId=${exportId} 节点=${root.id} 路径=${root.virtual_path} 目标=${request.targetDir}`,
      );
      // 导出容器 = 根节点在磁盘上的落点 targetDir/<rootName>；引用改写的锚定根取其父目录
      // 虚拟路径（容器相对路径以父为基，文件型根与目录型根统一：根条目 = 容器内一项）。
      // 截掉拼接斜杠（顶层根的父为虚拟根 '/'，嵌套根为 '/父路径'——归一为 '' / '/父' 无尾斜杠形态）
      const containerVPath = root.virtual_path
        .slice(0, root.virtual_path.length - root.name.length)
        .replace(/\/$/, '');
      // —— 收集阶段（纯读库）：换算磁盘路径与「虚拟路径 → 容器相对路径」改写映射 ——
      const rows = stmtSubtreeMeta.all({ rootId: root.id });
      const entries: ExportEntry[] = [];
      const relByVPath = new Map<string, string>();
      for (const row of rows) {
        // 容器相对路径：剥父目录前缀（顶层根的父为 ''，剥前导 '/'；嵌套根剥 '/父路径'）
        const relPath = row.virtual_path.slice(
          containerVPath === '' ? 1 : containerVPath.length + 1,
        );
        entries.push({
          row,
          diskPath: path.join(request.targetDir, ...relPath.split('/')),
          relPath,
        });
        relByVPath.set(row.virtual_path, relPath);
      }
      // 结构深度升序稳定排序（评审 Important 修复）：CTE 的 IN 扫描实测按查询计划输出
      // 行序（id 升序=创建序）而非结构序——「move 过的子树」子行 rowid 小于父行时先于
      // 父行输出，非递归 mkdir 会先触碰子目录 ENOENT（整批 failed 只落空壳根）。虚拟路径
      // 段数 = 结构深度不变式保证排序后父恒先于子；稳定排序保持同深度 CTE 原序（写盘序
      // 确定性）。评审两案中取本案（一行排序）而非两阶段递归 mkdir：改动面最小、零额外
      // 磁盘往返，且进度 currentPath 推进序与结构一致。
      entries.sort((x, y) => x.relPath.split('/').length - y.relPath.split('/').length);
      // —— 目标预检（Task 9 临时文件纪律）：失败整单上抛，此刻零写盘 ——
      try {
        await fs.probeWrite(request.targetDir);
      } catch (error: unknown) {
        const failure = new AppError(E_IO_TARGET_UNWRITABLE, '导出目标目录不可写或不存在');
        console.error(
          `[io] ${failure.code} ${failure.message}（目标 ${request.targetDir}）`,
          error,
        );
        throw failure;
      }
      onProgress({
        kind: 'export',
        exportId,
        phase: 'collecting',
        done: 0,
        total: entries.length,
        currentPath: root.virtual_path,
      });
      // —— 写盘阶段（事务外逐节点）：html 改写门控 + 单条目失败归集不拖垮整单 ——
      let exported = 0;
      let rewritten = 0;
      let missing = 0;
      let skipped = 0;
      let failed = 0;
      let done = 0;
      // 末次触达条目的容器相对路径（进度呈现用；初值=导出根虚拟路径，收集恒非空——
      // CTE 首行即根自身，末批广播与批内广播共用同一取值，无死分支）
      let lastWrittenPath = root.virtual_path;
      const failures: string[] = [];
      for (const entry of entries) {
        try {
          // 磁盘合法性复检（createNode/import/rename 三写路径均已校验，此处防御库外写入形态；
          // 失败计 skipped 不写盘，绝不改写名字——改写会让两个节点静默合并到同一磁盘名）
          validateNodeName(entry.row.name);
          if (entry.row.node_type === 'dir') {
            await fs.mkdir(entry.diskPath);
          } else {
            const read = await vfs.readFile({ nodeId: entry.row.id });
            let content = Buffer.from(read.content);
            // 改写仅限 text/html（由调用方门控，brief 语义；其余 MIME 内 vfs:// 字样原样保留）
            if (read.meta.mimeType === 'text/html') {
              const result = rewriteVfsRefs(
                content.toString('utf8'),
                entry.row.virtual_path,
                containerVPath,
                (vpath) => relByVPath.get(vpath) ?? null,
              );
              content = Buffer.from(result.html, 'utf8');
              rewritten += result.rewritten;
              missing += result.missing;
            }
            await fs.writeFile(entry.diskPath, content);
          }
          exported += 1;
        } catch (error: unknown) {
          // 非法名 → skipped（磁盘不可表达）；其余（中途入回收站读取拒判 / 写盘 IO）→ failed
          if (error instanceof AppError && error.code === E_VFS_INVALID_NAME) {
            skipped += 1;
          } else {
            failed += 1;
          }
          failures.push(
            `${entry.relPath}（${error instanceof Error ? error.message : String(error)}）`,
          );
        }
        done += 1;
        lastWrittenPath = entry.relPath;
        // 批边界：进度广播 + 让出事件循环（与导入批次粒度对称；广播在写盘动作落地之后）
        if (done % BATCH_MAX_NODES === 0) {
          onProgress({
            kind: 'export',
            exportId,
            phase: 'writing',
            done,
            total: entries.length,
            currentPath: lastWrittenPath,
          });
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
        }
      }
      if (done % BATCH_MAX_NODES !== 0) {
        // 末批（不满 200）同样广播收口，保证 done/total 终值必达渲染层
        onProgress({
          kind: 'export',
          exportId,
          phase: 'writing',
          done,
          total: entries.length,
          currentPath: lastWrittenPath,
        });
      }
      if (failures.length > 0) {
        // 失败明细单条上报（导入同款收口口径，全局 §二：禁循环内逐节点日志）
        console.error(
          `[io] 导出失败项 exportId=${exportId} 共 ${failures.length}：${failures.join('；')}`,
        );
      }
      console.info(
        `[io] 导出完成 exportId=${exportId} 写出=${exported} 改写=${rewritten} 越界=${missing} 跳过=${skipped} 失败=${failed}`,
      );
      return { exported, rewritten, missing, skipped, failed };
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
