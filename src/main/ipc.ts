/**
 * IPC handler 集中注册（宪法 B.3-2）：每通道两道校验——
 * origin 白名单（B.5-6）→ zod safeParse（A.7-5）；服务层 AppError 统一转 Result（A.7-3）。
 * vfs 通道在服务调用成功（= 事务已提交）后广播 vfs:changed（宪法 B.3-4）。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import { IPC } from '../shared/ipc';
import { AppError, err, ok, type Result } from '../shared/result';
import { E_IPC_BAD_PAYLOAD, E_IPC_FORBIDDEN_ORIGIN, E_STORE_INTERNAL } from '../shared/errors';
import type { VfsService } from './vfs/vfsService';
import type { SearchService } from './search/searchService';
import type { SettingsService } from './settings/settingsService';
import { currentRev } from './store/transaction';
import { SearchQueryRequestSchema } from '../shared/search-contract';
import type { SearchQueryRequest, SearchQueryResponse } from '../shared/search-contract';
import { SettingsGetRequestSchema, SettingsSchema } from '../shared/settings-contract';
import type { SettingsData } from '../shared/settings-contract';
import {
  BackupCreateRequestSchema,
  BackupListRequestSchema,
  BackupRestoreRequestSchema,
} from '../shared/backup-contract';
import type {
  BackupCreateResponse,
  BackupEntry,
  BackupRestoreRequest,
  BackupRestoreResponse,
} from '../shared/backup-contract';
import type { BackupService } from './backup/backupService';
import type { ImportService } from './io/importService';
import type { ExportService } from './io/exportService';
import {
  ExportRequestSchema,
  ImportRequestSchema,
  IoCancelRequestSchema,
  IoPickDirectoryRequestSchema,
} from '../shared/io-contract';
import type {
  ExportRequest,
  ImportRequest,
  ImportResult,
  IoCancelRequest,
  IoPickDirectoryRequest,
} from '../shared/io-contract';
import { OpenPathRequestSchema } from '../shared/shell-contract';
import type { OpenPathRequest } from '../shared/shell-contract';
import {
  CreateNodeRequestSchema,
  ListChildrenRequestSchema,
  MoveNodeRequestSchema,
  NodeIdRequestSchema,
  ReadFileRequestSchema,
  RenameNodeRequestSchema,
  ResolvePathRequestSchema,
  VfsCountRequestSchema,
  WriteFileRequestSchema,
} from '../shared/vfs-contract';
import type {
  AffectedResponse,
  CreateNodeRequest,
  ListChildrenRequest,
  MoveNodeRequest,
  NodeIdRequest,
  NodeMeta,
  ReadFileRequest,
  RenameNodeRequest,
  ResolvePathRequest,
  VfsChangedBroadcast,
  VfsChangedEvent,
  WriteFileRequest,
} from '../shared/vfs-contract';

export interface IpcHandlerDeps {
  /** 允许发起 IPC 的 origin 白名单（用 origin 不用 URL，B.5-6） */
  readonly allowedOrigins: readonly string[];
  /** VFS 服务（事务边界唯一归属存储层，handler 仅做转发与 Result 转换） */
  readonly vfs: VfsService;
  /** 搜索服务（纯读，spec §1：搜索通道不产生广播事件） */
  readonly search: SearchService;
  /** 设置服务（spec §5） */
  readonly settings: SettingsService;
  /** 主→渲染广播（app.ts 提供：遍历窗口 webContents.send）；必须在事务提交后调用 */
  readonly broadcast: (broadcast: VfsChangedBroadcast) => void;
  /** guard 确认后强制关闭（app.ts 提供：置放行标记 + win.close()） */
  readonly requestClose: () => void;
  /** 备份服务（M5 批次③）：create/list 通道直接透传；restore 经下方编排闭包 */
  readonly backup: BackupService;
  /**
   * 还原编排（app.ts 提供，照 requestClose 先例的依赖注入）：先在替换点干净关闭数据库
   * 连接释放文件锁（Windows 下打开中的库文件禁止 rename 覆盖），再由服务执行 integrity
   * 校验与原子替换。服务自身不摸连接（BackupServiceDeps 无 close——D11 职责切分）。
   */
  readonly restoreBackup: (fileName: string) => void;
  /** 还原成功后重启（app.ts 提供：app.relaunch() + app.exit(0)，D11：服务不直接 relaunch） */
  readonly requestRelaunch: () => void;
  /** 导入服务（M5 批次⑥）：import 长任务（分批事务，批次间让出事件循环）与 cancel 登记 */
  readonly io: ImportService;
  /**
   * 主进程目录选择供给（app.ts 提供，照 requestRelaunch 先例的依赖注入）：
   * dialog.showOpenDialog（openDirectory）异步弹出；multiple 区分导入多选源与导出单选目标
   * （Task 13 复用）。用户取消返回空数组（不作为错误）。
   */
  readonly pickDirectories: (allowMultiple: boolean) => Promise<readonly string[]>;
  /** 导出服务（M5 批次⑥ Task 13）：export 长任务（逐节点写盘 + 引用改写 + 进度广播） */
  readonly export: ExportService;
  /**
   * 当次会话目录选择登记簿（app.ts 持有，pickDirectories 产出时登记）：io:export 的
   * targetDir、shell:open-path 的 dir 与 io:import 的 sourcePaths 只接受登记簿内的串
   * ——渲染层可伪造任意 IPC 载荷，用户可控串直达磁盘写与 shell 的信任边界必须在主进程
   * 侧收敛（B.5-4 精神）。
   */
  readonly dialogProducedDirs: ReadonlySet<string>;
  /**
   * 系统文件管理器打开目录（app.ts 提供，shell.openPath 包装）：空串语义成功；
   * 非空返回值为错误描述串，转异常上抛经 handleWithAsync 收敛 E_STORE_INTERNAL。
   */
  readonly openDirectoryInShell: (dir: string) => Promise<void>;
  /**
   * 外观主题变更回调（M6 spec §2.2/D12，app.ts 提供）：settings:set 检测 appearance.theme
   * 变更后调用，主进程内聚更新自绘标题栏 overlay 配色（不新增 IPC 通道）。
   */
  readonly onAppearanceThemeChange: (intent: 'light' | 'dark' | 'system') => void;
}

/** origin 白名单判定（B.5-6）：senderFrame 可能为 null，null/空串/非白名单一律拒绝 */
function isOriginPermitted(deps: IpcHandlerDeps, event: IpcMainInvokeEvent): boolean {
  const origin = event.senderFrame?.origin;
  return (
    origin !== undefined && origin !== null && origin !== '' && deps.allowedOrigins.includes(origin)
  );
}

/**
 * 异步通道包装（M5 批次⑥）：与 handleWith 同两道校验（origin → zod，B.3-2），差异仅在
 * 服务调用为 Promise（导入长任务 / 目录选择弹窗）。AppError 转 Result 语义同 handleWith（A.7-3）。
 */
function handleWithAsync<TReq, TRes>(
  deps: IpcHandlerDeps,
  schema: ZodType<TReq>,
  fn: (request: TReq) => Promise<TRes>,
): (event: IpcMainInvokeEvent, payload: unknown) => Promise<Result<TRes>> {
  return async (event, payload) => {
    if (!isOriginPermitted(deps, event)) {
      return err(E_IPC_FORBIDDEN_ORIGIN, '拒绝来自未授权来源的调用');
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return err(E_IPC_BAD_PAYLOAD, '请求载荷不合法');
    }
    try {
      return ok(await fn(parsed.data));
    } catch (error: unknown) {
      // 业务错误码保真透传；非业务异常收敛为 E_STORE_INTERNAL，禁异常跨进程透传（A.7-3）
      if (error instanceof AppError) return err(error.code, error.message);
      return err(E_STORE_INTERNAL, '操作失败');
    }
  };
}

/** 通用包装：origin 校验 → zod 校验 → 服务调用（AppError 转 Result）→ 广播钩子 */
function handleWith<TReq, TRes>(
  deps: IpcHandlerDeps,
  schema: ZodType<TReq>,
  fn: (request: TReq) => { result: TRes; event?: VfsChangedEvent },
): (event: IpcMainInvokeEvent, payload: unknown) => Result<TRes> {
  return (event, payload) => {
    if (!isOriginPermitted(deps, event)) {
      return err(E_IPC_FORBIDDEN_ORIGIN, '拒绝来自未授权来源的调用');
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return err(E_IPC_BAD_PAYLOAD, '请求载荷不合法');
    }
    try {
      const { result, event: changed } = fn(parsed.data);
      // 服务方法内部事务已提交成功，此刻广播满足宪法 B.3-4（事务提交后）
      if (changed !== undefined)
        deps.broadcast({ rev: currentRev(), event: changed } satisfies VfsChangedBroadcast);
      return ok(result);
    } catch (error: unknown) {
      // 业务错误码保真透传；非业务异常收敛为 E_STORE_INTERNAL，禁异常跨进程透传（A.7-3）
      if (error instanceof AppError) return err(error.code, error.message);
      return err(E_STORE_INTERNAL, '操作失败');
    }
  };
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // M0 通道保持不变（system:ping 载荷固定为 null）
  ipcMain.handle(IPC.systemPing, (event, payload: unknown): Result<{ pong: true }> => {
    if (!isOriginPermitted(deps, event)) {
      return err(E_IPC_FORBIDDEN_ORIGIN, '拒绝来自未授权来源的调用');
    }
    if (z.null().safeParse(payload).success === false) {
      return err(E_IPC_BAD_PAYLOAD, '请求载荷不合法');
    }
    return ok({ pong: true });
  });

  ipcMain.handle(
    IPC.vfsList,
    handleWith(deps, ListChildrenRequestSchema, (q: ListChildrenRequest) => ({
      result: deps.vfs.listChildren(q),
    })),
  );
  ipcMain.handle(
    IPC.vfsCreate,
    handleWith(deps, CreateNodeRequestSchema, (q: CreateNodeRequest) => {
      const node = deps.vfs.createNode(q);
      return { result: node, event: { type: 'created', node } satisfies VfsChangedEvent };
    }),
  );
  ipcMain.handle(
    IPC.vfsRead,
    handleWith(deps, ReadFileRequestSchema, (q: ReadFileRequest) => ({
      result: deps.vfs.readFile(q),
    })),
  );
  ipcMain.handle(
    IPC.vfsWrite,
    handleWith(deps, WriteFileRequestSchema, (q: WriteFileRequest) => {
      const node = deps.vfs.writeFile(q);
      return { result: node, event: { type: 'written', node } satisfies VfsChangedEvent };
    }),
  );
  ipcMain.handle(
    IPC.vfsRename,
    handleWith(deps, RenameNodeRequestSchema, (q: RenameNodeRequest) => {
      const result: AffectedResponse = deps.vfs.renameNode(q);
      return {
        result,
        event: {
          type: 'renamed',
          nodeId: q.nodeId,
          affectedCount: result.affectedCount,
        } satisfies VfsChangedEvent,
      };
    }),
  );
  ipcMain.handle(
    IPC.vfsMove,
    handleWith(deps, MoveNodeRequestSchema, (q: MoveNodeRequest) => {
      const result: AffectedResponse = deps.vfs.moveNode(q);
      return {
        result,
        event: {
          type: 'moved',
          nodeId: q.nodeId,
          affectedCount: result.affectedCount,
        } satisfies VfsChangedEvent,
      };
    }),
  );
  ipcMain.handle(
    IPC.vfsTrash,
    handleWith(deps, NodeIdRequestSchema, (q: NodeIdRequest) => {
      const result: AffectedResponse = deps.vfs.trashNode(q);
      return {
        result,
        event: {
          type: 'trashed',
          nodeId: q.nodeId,
          affectedCount: result.affectedCount,
        } satisfies VfsChangedEvent,
      };
    }),
  );
  ipcMain.handle(
    IPC.vfsRestore,
    handleWith(deps, NodeIdRequestSchema, (q: NodeIdRequest) => {
      const node: NodeMeta = deps.vfs.restoreNode(q);
      return { result: node, event: { type: 'restored', node } satisfies VfsChangedEvent };
    }),
  );
  ipcMain.handle(
    IPC.vfsPurge,
    handleWith(deps, NodeIdRequestSchema, (q: NodeIdRequest) => {
      const result: AffectedResponse = deps.vfs.purgeNode(q);
      return {
        result,
        event: {
          type: 'purged',
          nodeId: q.nodeId,
          purgedCount: result.affectedCount,
        } satisfies VfsChangedEvent,
      };
    }),
  );
  // 回收站列表（M5 批次②）：纯读无写事务 → 返回对象无 event 键 → 不广播（B.3-4）；
  // 无参通道载荷固定 null 照 settingsGet 先例（NodeIdRequest 不适用）
  ipcMain.handle(
    IPC.vfsListTrashed,
    handleWith(deps, z.null(), () => ({ result: deps.vfs.listTrashed() })),
  );
  ipcMain.handle(
    IPC.vfsResolve,
    handleWith(deps, ResolvePathRequestSchema, (q: ResolvePathRequest) => ({
      result: deps.vfs.resolvePath(q),
    })),
  );
  // 单节点反查（M4 spec §6.1）：纯读无写事务，返回对象无 event 键 → 不广播
  ipcMain.handle(
    IPC.vfsGet,
    handleWith(deps, NodeIdRequestSchema, (data: NodeIdRequest) => ({
      result: deps.vfs.getNode(data),
    })),
  );
  // 活节点总数（M6 spec §2.6 状态栏文档计数）：纯读无写事务 → 不广播
  ipcMain.handle(
    IPC.vfsCount,
    handleWith(deps, VfsCountRequestSchema, () => ({ result: deps.vfs.countNodes() })),
  );
  // 搜索通道纯读、无写事务：返回对象无 event 键 → handleWith 守卫不广播（spec §1）
  ipcMain.handle(
    IPC.searchQuery,
    handleWith(deps, SearchQueryRequestSchema, (q: SearchQueryRequest) => ({
      result: deps.search.query(q) satisfies SearchQueryResponse,
    })),
  );
  ipcMain.handle(
    IPC.settingsGet,
    handleWith(deps, SettingsGetRequestSchema, () => ({ result: deps.settings.get() })),
  );
  ipcMain.handle(
    IPC.settingsSet,
    handleWith(deps, SettingsSchema, (data: SettingsData) => {
      // 主题联动（M6 spec §2.2/D12）：set 前取旧意图比对，变更即回调主进程更新 overlay 配色
      const previousTheme = deps.settings.get().appearance.theme;
      const result = deps.settings.set(data) satisfies SettingsData;
      if (data.appearance.theme !== previousTheme) {
        deps.onAppearanceThemeChange(data.appearance.theme);
      }
      return { result };
    }),
  );
  // —— 外壳域（M4）：guard 放行唯一通道（spec §2.3）——
  ipcMain.handle(
    IPC.shellForceClose,
    handleWith(deps, z.null(), () => {
      deps.requestClose();
      return { result: null };
    }),
  );

  // —— 备份域（M5 批次③）：文件级操作无 vfs 写事务 → 返回对象无 event 键 → 不广播；
  //    建份完成的列表刷新经 backup:done 专用广播到达（onDone 供给，宪法 B.3-4 不涉 vfs 事务）——
  ipcMain.handle(
    IPC.backupCreate,
    handleWith(deps, BackupCreateRequestSchema, () => ({
      result: deps.backup.create() satisfies BackupCreateResponse,
    })),
  );
  ipcMain.handle(
    IPC.backupList,
    handleWith(deps, BackupListRequestSchema, () => ({
      result: deps.backup.list() satisfies readonly BackupEntry[],
    })),
  );
  // 还原走 app 层编排闭包（替换点关库 → 服务替换 → 失败重开原库），成功即 relaunch（D11）
  ipcMain.handle(
    IPC.backupRestore,
    handleWith(deps, BackupRestoreRequestSchema, (q: BackupRestoreRequest) => {
      deps.restoreBackup(q.fileName);
      deps.requestRelaunch();
      return { result: { relaunch: true } satisfies BackupRestoreResponse };
    }),
  );

  // —— 导入域（M5 批次⑥）：导入为分批长任务（批次间让出事件循环，io:cancel 可插队），
  //    树刷新由渲染层在 invoke 结果到达后统一收口；进度经 io:progress 广播（服务侧 B.3-4）；
  //    源路径只接受登记簿内串（与 io:export / shell:open-path 同一信任边界，见 deps 注：
  //    源经 io:pick-directory 目录模式产出、登记形态即目录绝对路径，语义一致）——
  ipcMain.handle(
    IPC.ioImport,
    handleWithAsync(deps, ImportRequestSchema, async (q: ImportRequest) => {
      for (const sourcePath of q.sourcePaths) {
        if (!deps.dialogProducedDirs.has(sourcePath)) {
          throw new AppError(E_IPC_BAD_PAYLOAD, '导入源路径必须来自目录选择对话框');
        }
      }
      const result: ImportResult = await deps.io.importNodes(q);
      return result;
    }),
  );
  // 取消登记：纯内存操作无写事务 → 返回对象无 event 键 → 不广播
  ipcMain.handle(
    IPC.ioCancel,
    handleWith(deps, IoCancelRequestSchema, (q: IoCancelRequest) => {
      deps.io.cancel(q.importId);
      return { result: null };
    }),
  );
  // 目录选择（dialog.showOpenDialog 异步 API，主进程弹窗不阻塞渲染进程）；无写事务不广播
  ipcMain.handle(
    IPC.ioPickDirectory,
    handleWithAsync(deps, IoPickDirectoryRequestSchema, (q: IoPickDirectoryRequest) =>
      deps.pickDirectories(q.multiple),
    ),
  );

  // —— 导出域（M5 批次⑥ Task 13）：写盘为事务外逐节点长任务（无 vfs 写事务 → 不广播，
  //    进度经 io:progress 服务侧广播）；targetDir 只接受登记簿内串（见 deps 注）——
  ipcMain.handle(
    IPC.ioExport,
    handleWithAsync(deps, ExportRequestSchema, async (q: ExportRequest) => {
      if (!deps.dialogProducedDirs.has(q.targetDir)) {
        throw new AppError(E_IPC_BAD_PAYLOAD, '导出目标目录必须来自目录选择对话框');
      }
      return deps.export.exportNodes(q);
    }),
  );
  // 打开目录（导出完成动作）：入参信任边界同上（登记簿），伪造串不达 shell；
  // 供给为 Promise<void>，响应固定 null（A.7-2 禁 undefined 承载语义）
  ipcMain.handle(
    IPC.shellOpenPath,
    handleWithAsync(deps, OpenPathRequestSchema, async (q: OpenPathRequest) => {
      if (!deps.dialogProducedDirs.has(q.dir)) {
        throw new AppError(E_IPC_BAD_PAYLOAD, '目录必须来自目录选择对话框');
      }
      await deps.openDirectoryInShell(q.dir);
      return null;
    }),
  );
}
