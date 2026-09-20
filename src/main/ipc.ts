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
  CreateNodeRequestSchema,
  ListChildrenRequestSchema,
  MoveNodeRequestSchema,
  NodeIdRequestSchema,
  ReadFileRequestSchema,
  RenameNodeRequestSchema,
  ResolvePathRequestSchema,
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
}

/** origin 白名单判定（B.5-6）：senderFrame 可能为 null，null/空串/非白名单一律拒绝 */
function isOriginPermitted(deps: IpcHandlerDeps, event: IpcMainInvokeEvent): boolean {
  const origin = event.senderFrame?.origin;
  return (
    origin !== undefined && origin !== null && origin !== '' && deps.allowedOrigins.includes(origin)
  );
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
    handleWith(deps, SettingsSchema, (data: SettingsData) => ({
      result: deps.settings.set(data) satisfies SettingsData,
    })),
  );
  // —— 外壳域（M4）：guard 放行唯一通道（spec §2.3）——
  ipcMain.handle(
    IPC.shellForceClose,
    handleWith(deps, z.null(), () => {
      deps.requestClose();
      return { result: null };
    }),
  );
}
