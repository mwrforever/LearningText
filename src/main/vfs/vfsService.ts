// VFS 领域服务（spec §7）：错误一律抛 AppError，由 IPC handler 层转 Result DTO；
// 高频语句在工厂闭包内 prepare 一次复用（宪法 A.4-5）
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import {
  E_STORE_INTERNAL,
  E_VFS_DUPLICATE_NAME,
  E_VFS_FILE_TOO_LARGE,
  E_VFS_NOT_FOUND,
  E_VFS_TYPE_MISMATCH,
} from '../../shared/errors';
import { MAX_FILE_BYTES } from '../../shared/vfs-contract';
import { toLocalIsoTime } from '../../shared/time';
import { runWriteTransaction } from '../store/transaction';
import { isTextualMime, lookupMimeType } from './mime';
import { validateNodeName } from './nodeName';
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
  // SELECT * 的行含 deleted_at/content 等列，interface 只声明消费字段（结构类型兼容）；
  // 完整行类型在 NodeRow 之上附加回收站判定与内容列，requireRow 原样保留该形态，
  // 读内容路径直接消费 content 列，避免 BLOB 行二次物化（Task 7 评审遗留项的最小修复）
  const stmtRowById = db.prepare<
    number,
    NodeRow & { deleted_at: string | null; content: Buffer | null }
  >('SELECT * FROM node WHERE id = ?');

  /** 取未删除节点行（含 content 完整列）；不存在或已在回收站抛 E_VFS_NOT_FOUND（服务内高频路径） */
  function requireRow(id: number): NodeRow & { deleted_at: string | null; content: Buffer | null } {
    const row = stmtRowById.get(id);
    if (row === undefined || row.deleted_at !== null) {
      throw new AppError(E_VFS_NOT_FOUND, '节点不存在或已在回收站');
    }
    return row;
  }

  // —— 写路径语句（FR-VFS-01/03）：业务行与 FTS 索引行必须同事务写入（宪法 A.4-4）——
  const stmtInsertNode = db.prepare(
    `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
     VALUES (@parentId, @nodeType, @name, @virtualPath, @mimeType, @size, @content, @contentHash, @now, @now)`,
  );
  const stmtInsertFts = db.prepare(
    'INSERT INTO node_fts (rowid, name, body) VALUES (@id, @name, @body)',
  );
  const stmtUpdateContent = db.prepare(
    `UPDATE node SET content = @content, size = @size, content_hash = @hash, updated_at = @now WHERE id = @id`,
  );
  const stmtUpdateFtsBody = db.prepare('UPDATE node_fts SET body = @body WHERE rowid = @id');

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
      // requireRow 已带 content 完整列，直接消费；单行 BLOB 物化在 50MB 上限内可接受（spec §7.3）
      return { content: new Uint8Array(row.content ?? Buffer.alloc(0)), meta: toNodeMeta(row) };
    },

    /** 建目录/文件（FR-VFS-01）：名称校验 → 重名预查 → 单事务落库 + FTS */
    createNode(input: CreateNodeRequest): NodeMeta {
      const name = validateNodeName(input.name);
      const parent = requireRow(input.parentId);
      // 简报代码适配：requireRow 返回数据库原始行（snake_case 列名），父路径取 virtual_path
      const virtualPath = (parent.virtual_path === '/' ? '' : parent.virtual_path) + '/' + name;
      const now = toLocalIsoTime(new Date());
      let content: Buffer = Buffer.alloc(0);
      if (input.content !== undefined) {
        if (input.nodeType === 'dir') {
          throw new AppError(E_VFS_TYPE_MISMATCH, '文件夹不能携带内容');
        }
        if (input.content.byteLength > MAX_FILE_BYTES) {
          throw new AppError(E_VFS_FILE_TOO_LARGE, '文件超过 50MB 上限');
        }
        content = Buffer.from(input.content);
      }
      // 重名前置校验（spec §5：不依赖 SQLite 报错；partial unique 兜底）
      const dup = db
        .prepare<[number, string], { id: number }>(
          'SELECT id FROM node WHERE parent_id = ? AND name = ? AND deleted_at IS NULL',
        )
        .get(parent.id, name);
      if (dup !== undefined) {
        throw new AppError(E_VFS_DUPLICATE_NAME, '同级已存在同名文件或文件夹');
      }
      const mimeType = input.nodeType === 'file' ? lookupMimeType(name) : null;
      const body = mimeType !== null && isTextualMime(mimeType) ? content.toString('utf8') : '';
      return runWriteTransaction(db, () => {
        const info = stmtInsertNode.run({
          parentId: parent.id,
          nodeType: input.nodeType,
          name,
          virtualPath,
          mimeType,
          size: content.byteLength,
          content: input.nodeType === 'file' ? content : null,
          contentHash:
            input.nodeType === 'file' ? createHash('sha256').update(content).digest('hex') : null,
          now,
        });
        const id = Number(info.lastInsertRowid);
        stmtInsertFts.run({ id, name, body });
        return {
          id,
          parentId: parent.id,
          nodeType: input.nodeType,
          name,
          virtualPath,
          mimeType,
          size: content.byteLength,
          createdAt: now,
          updatedAt: now,
        };
      });
    },

    /** 覆盖写（FR-VFS-03）：上限校验 → 单事务更新内容与 FTS body */
    writeFile(request: WriteFileRequest): NodeMeta {
      const row = requireRow(request.nodeId);
      if (row.node_type !== 'file') {
        throw new AppError(E_VFS_TYPE_MISMATCH, '文件夹不能写入内容');
      }
      const content = Buffer.from(request.content);
      if (content.byteLength > MAX_FILE_BYTES) {
        throw new AppError(E_VFS_FILE_TOO_LARGE, '文件超过 50MB 上限');
      }
      const body =
        row.mime_type !== null && isTextualMime(row.mime_type) ? content.toString('utf8') : '';
      return runWriteTransaction(db, () => {
        const now = toLocalIsoTime(new Date());
        stmtUpdateContent.run({
          content,
          size: content.byteLength,
          hash: createHash('sha256').update(content).digest('hex'),
          now,
          id: row.id,
        });
        stmtUpdateFtsBody.run({ body, id: row.id });
        return toNodeMeta({ ...row, size: content.byteLength, updated_at: now });
      });
    },

    // —— 以下占位桩由 Task 9/10 逐个替换（过渡桩不跨任务存续）——
    // 占位桩仅保留签名形态（供 IPC 装配按契约引用），参数留待实现时消费，
    // 逐个排除未用参数告警（随桩替换一并移除，nodeName.ts 先例）
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
