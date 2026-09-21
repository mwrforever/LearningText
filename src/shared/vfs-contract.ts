/**
 * VFS 域 IPC 契约（宪法 A.7-5 单一来源）：请求/响应 DTO + zod schema。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD，schema 不做逐字段消息定制（spec §8.2）。
 */
import { z } from 'zod';

/** 节点元数据（A.7-2 plain DTO：可结构化克隆、可空字段显式 | null） */
export interface NodeMeta {
  readonly id: number;
  /** 根节点为 null */
  readonly parentId: number | null;
  readonly nodeType: 'dir' | 'file';
  /** 当前级名称（根节点为空串），入库前已 NFC 规范化 */
  readonly name: string;
  readonly virtualPath: string;
  /** 文件 MIME；目录为 null */
  readonly mimeType: string | null;
  /** 文件字节数，目录恒 0 */
  readonly size: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const NodeMetaSchema = z.object({
  id: z.number().int(),
  parentId: z.number().int().nullable(),
  nodeType: z.enum(['dir', 'file']),
  name: z.string(),
  virtualPath: z.string(),
  mimeType: z.string().nullable(),
  size: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * 回收站条目读模型（M5 批次②）：业务节点 meta + 删除时刻（本地 ISO，与库 deleted_at 同源）。
 * 归位 vfs-contract 的裁决：通道属 VFS 域（vfs:list-trashed，B.2-5 命名），trash 请求
 * （NodeIdRequest）与 trash 域广播事件（trashed/restored/purged）均已在本文——单一来源就近，
 * 不另立 trash-contract 碎片化契约（检索/设置等独立域才各自建文件）。
 */
export interface TrashedNodeMeta {
  readonly meta: NodeMeta;
  readonly deletedAt: string;
}

export const TrashedNodeMetaSchema = z.object({
  meta: NodeMetaSchema,
  deletedAt: z.string(),
});

// —— 纯常量落 zod-free 模块（M5 D28 主 chunk 裁剪：渲染层只 import 常量时零 zod 运行时），
//    此处 re-export 维持本文件作为域契约聚合出口（宪法 A.7-5 单一来源）——
export { MAX_FILE_BYTES, VFS_URL_HOST } from './vfs-constants';

// —— 请求 schema：字段级契约即规格（docs/03 §7.1）——

// strictObject 逐分支：二选一强制互斥（双字段/缺字段/多余字段一律拒），z.infer 形态与 M1 等价（spec §3.3）
export const ListChildrenRequestSchema = z.union([
  z.strictObject({ parentId: z.number().int() }),
  z.strictObject({ virtualPath: z.string().min(1) }),
]);
export type ListChildrenRequest = z.infer<typeof ListChildrenRequestSchema>;

export const CreateNodeRequestSchema = z.object({
  parentId: z.number().int(),
  name: z.string(),
  nodeType: z.enum(['dir', 'file']),
  /** 仅 nodeType='file' 且需要初始内容时提供；空文件省略 */
  content: z.instanceof(Uint8Array).optional(),
});
export type CreateNodeRequest = z.infer<typeof CreateNodeRequestSchema>;

export const ReadFileRequestSchema = z.object({ nodeId: z.number().int() });
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

export const WriteFileRequestSchema = z.object({
  nodeId: z.number().int(),
  content: z.instanceof(Uint8Array),
});
export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>;

export const RenameNodeRequestSchema = z.object({ nodeId: z.number().int(), newName: z.string() });
export type RenameNodeRequest = z.infer<typeof RenameNodeRequestSchema>;

export const MoveNodeRequestSchema = z.object({
  nodeId: z.number().int(),
  targetDirId: z.number().int(),
});
export type MoveNodeRequest = z.infer<typeof MoveNodeRequestSchema>;

export const NodeIdRequestSchema = z.object({ nodeId: z.number().int() });
export type NodeIdRequest = z.infer<typeof NodeIdRequestSchema>;

export const ResolvePathRequestSchema = z.object({ virtualPath: z.string().min(1) });
export type ResolvePathRequest = z.infer<typeof ResolvePathRequestSchema>;

// —— 响应 DTO ——

/** 读文件响应：content 以 Uint8Array 过 IPC（Electron 结构化克隆形态） */
export interface ReadFileResponse {
  readonly content: Uint8Array;
  readonly meta: NodeMeta;
}

export interface AffectedResponse {
  /** 受级联影响的子树节点数（rename/move/trash）或物理移除数（purge） */
  readonly affectedCount: number;
}

export interface NodeIdResponse {
  readonly nodeId: number;
}

/** 主→渲染树变更事件（可辨识联合；事务提交成功后广播，宪法 B.3-4） */
export type VfsChangedEvent =
  | { readonly type: 'created'; readonly node: NodeMeta }
  | { readonly type: 'written'; readonly node: NodeMeta }
  | { readonly type: 'renamed'; readonly nodeId: number; readonly affectedCount: number }
  | { readonly type: 'moved'; readonly nodeId: number; readonly affectedCount: number }
  | { readonly type: 'trashed'; readonly nodeId: number; readonly affectedCount: number }
  | { readonly type: 'restored'; readonly node: NodeMeta }
  | { readonly type: 'purged'; readonly nodeId: number; readonly purgedCount: number };

/** 广播载荷包装（M3 spec §4.2 防撕裂）：rev 为主进程写事务版本号，消费侧比对用 */
export interface VfsChangedBroadcast {
  readonly rev: number;
  readonly event: VfsChangedEvent;
}

/** vfs:count 请求形态：无参通道沿 settingsGet 先例传 null（状态栏文档计数，M6 spec §2.6） */
export const VfsCountRequestSchema = z.null();
