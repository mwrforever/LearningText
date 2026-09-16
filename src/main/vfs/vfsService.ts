// VFS 领域服务（spec §7）：错误一律抛 AppError，由 IPC handler 层转 Result DTO；
// 高频语句在工厂闭包内 prepare 一次复用（宪法 A.4-5）
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import { E_STORE_INTERNAL, E_VFS_NOT_FOUND, E_VFS_TYPE_MISMATCH } from '../../shared/errors';
import type {
  AffectedResponse,
  CreateNodeRequest,
  ListChildrenRequest,
  MoveNodeRequest,
  NodeIdRequest,
  NodeMeta,
  NodeResponse,
  ReadFileRequest,
  ReadFileResponse,
  RenameNodeRequest,
  ResolvePathRequest,
  WriteFileRequest,
} from '../../shared/vfs-contract';

/** node 行 → NodeMeta（读模型 ≠ 存储行 ≠ 请求 DTO，各自建模，宪法 A.7-4） */
interface NodeRow {
  id: number;
  parent_id: number | null;
  node_type: string;
  name: string;
  virtual_path: string;
  mime_type: string | null;
  size: number;
  created_at: string;
  updated_at: string;
}

function toNodeMeta(row: NodeRow): NodeMeta {
  return {
    id: row.id,
    parentId: row.parent_id,
    nodeType: row.node_type === 'dir' ? 'dir' : 'file',
    name: row.name,
    virtualPath: row.virtual_path,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createVfsService(db: Database.Database) {
  // 高频语句与行获取助手在工厂闭包内预编译一次复用（宪法 A.4-5）
  const stmtChildren = db.prepare<[number], NodeRow>(
    `SELECT id, parent_id, node_type, name, virtual_path, mime_type, size, created_at, updated_at
     FROM node WHERE parent_id = ? AND deleted_at IS NULL
     ORDER BY CASE WHEN node_type = 'dir' THEN 0 ELSE 1 END, name COLLATE BINARY`,
  );
  const stmtIdByPath = db.prepare<string, { id: number }>(
    'SELECT id FROM node WHERE virtual_path = ? AND deleted_at IS NULL',
  );
  // SELECT * 的行含 deleted_at/content 等列，interface 只声明消费字段（结构类型兼容）
  const stmtRowById = db.prepare<
    number,
    NodeRow & { deleted_at: string | null; content: Buffer | null }
  >('SELECT * FROM node WHERE id = ?');

  /** 取未删除节点行；不存在或已在回收站抛 E_VFS_NOT_FOUND（服务内高频路径） */
  function requireRow(id: number): NodeRow {
    const row = stmtRowById.get(id);
    if (row === undefined || row.deleted_at !== null) {
      throw new AppError(E_VFS_NOT_FOUND, '节点不存在或已在回收站');
    }
    return row;
  }

  return {
    /** 列直接子节点（FR-VFS-02/08）：目录在前、名称升序 */
    listChildren(query: ListChildrenRequest): NodeMeta[] {
      let parentId: number;
      if ('parentId' in query) {
        requireRow(query.parentId); // 父必须存在且未删除
        parentId = query.parentId;
      } else {
        const row = stmtIdByPath.get(query.virtualPath);
        if (row === undefined) throw new AppError(E_VFS_NOT_FOUND, '节点不存在或已在回收站');
        parentId = row.id;
      }
      return stmtChildren.all(parentId).map(toNodeMeta);
    },

    /** 虚拟路径 → 节点 id（FR-VFS-07），含未删除校验 */
    resolvePath(request: ResolvePathRequest): { nodeId: number } {
      const row = stmtIdByPath.get(request.virtualPath);
      if (row === undefined) throw new AppError(E_VFS_NOT_FOUND, '路径不存在或已在回收站');
      return { nodeId: row.id };
    },

    /** 读文件内容与元数据（FR-VFS-02）；目录 → 类型不匹配 */
    readFile(request: ReadFileRequest): ReadFileResponse {
      const row = requireRow(request.nodeId);
      if (row.node_type !== 'file') {
        throw new AppError(E_VFS_TYPE_MISMATCH, '目标节点是文件夹，不能作为文件读取');
      }
      // stmtRowById 行类型已含 content；单行 BLOB 物化在 50MB 上限内可接受（spec §7.3）
      const full = stmtRowById.get(request.nodeId);
      return { content: new Uint8Array(full?.content ?? Buffer.alloc(0)), meta: toNodeMeta(row) };
    },

    // —— 写路径方法由 Task 8/9/10 逐个替换此占位区（过渡桩不跨任务存续）——
    // 占位桩仅保留签名形态（供 IPC 装配按契约引用），参数留待实现时消费，
    // 逐个排除未用参数告警（随桩替换一并移除，nodeName.ts 先例）
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    createNode(_input: CreateNodeRequest): NodeMeta {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    writeFile(_request: WriteFileRequest): NodeMeta {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    renameNode(_request: RenameNodeRequest): AffectedResponse {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    moveNode(_request: MoveNodeRequest): AffectedResponse {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    trashNode(_request: NodeIdRequest): AffectedResponse {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    restoreNode(_request: NodeIdRequest): NodeResponse['node'] {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    purgeNode(_request: NodeIdRequest): AffectedResponse {
      throw new AppError(E_STORE_INTERNAL, '该方法由后续任务实现');
    },
  };
}

export type VfsService = ReturnType<typeof createVfsService>;
