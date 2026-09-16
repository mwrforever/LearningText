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

/** 50MB 单文件上限（docs/03 §3.2-3），服务层写入前校验 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// —— 请求 schema：字段级契约即规格（docs/03 §7.1）——

export const ListChildrenRequestSchema = z.union([
  z.object({ parentId: z.number().int() }),
  z.object({ virtualPath: z.string().min(1) }),
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

export interface NodeResponse {
  readonly node: NodeMeta;
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
