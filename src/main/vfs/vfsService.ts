// VFS 领域服务（spec §7）：错误一律抛 AppError，由 IPC handler 层转 Result DTO；
// 高频语句在工厂闭包内 prepare 一次复用（宪法 A.4-5）
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import {
  E_VFS_DUPLICATE_NAME,
  E_VFS_FILE_TOO_LARGE,
  E_VFS_INVALID_MOVE,
  E_VFS_NOT_FOUND,
  E_VFS_TYPE_MISMATCH,
} from '../../shared/errors';
import { MAX_FILE_BYTES } from '../../shared/vfs-contract';
import { toLocalIsoTime } from '../../shared/time';
import { runWriteTransaction } from '../store/transaction';
import { isTextualMime, lookupMimeType } from './mime';
import { validateNodeName } from './nodeName';
import { createSubtreeStatements } from './subtreeScope';
// 行→元数据映射共用 nodeRowMapper 单一实现（M2 Task 7 DRY 收口：search 服务映射同一行形态）
import { toNodeMeta, type NodeRow } from './nodeRowMapper';
import type {
  AffectedResponse,
  CreateNodeRequest,
  ListChildrenRequest,
  MoveNodeRequest,
  NodeIdRequest,
  NodeMeta,
  ReadFileRequest,
  ReadFileResponse,
  RenameNodeRequest,
  ResolvePathRequest,
  WriteFileRequest,
} from '../../shared/vfs-contract';

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
  // 单节点元数据反查（M4 vfs:get）：不取 content 列，meta 查询禁止物化 50MB 级 BLOB
  // （与 Task 7 评审「避免 BLOB 行二次物化」同一口径）
  const stmtMetaById = db.prepare<number, NodeRow>(
    `SELECT id, parent_id, node_type, name, virtual_path, mime_type, size, created_at, updated_at
     FROM node WHERE id = ? AND deleted_at IS NULL`,
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
  // 重名预查（spec §5）：事务前置读，服务层不依赖 SQLite 报错（partial unique 仅兜底）；
  // 与写语句同为闭包级预编译一次复用，禁在方法体内联 prepare（宪法 A.4-5）
  const stmtDupIdByParentName = db.prepare<[number, string], { id: number }>(
    'SELECT id FROM node WHERE parent_id = ? AND name = ? AND deleted_at IS NULL',
  );
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

  // 子树身份统一走 parent_id 递归 CTE 工厂（M2 spec §3.2）：闭包级预编译（宪法 A.4-5）；
  // 「trash 后同路径重建」孪生树按结构身份互不沾染（M1 状态锚定方案下线，理由见 subtreeScope 头注）
  const subtree = createSubtreeStatements(db);

  // —— 重构类操作语句（FR-VFS-04/05，spec §7.4/§7.5）：rename 与 move 共用级联改写 ——
  const stmtRenameSelf = db.prepare(
    'UPDATE node SET name = @name, updated_at = @now WHERE id = @id',
  );
  // FTS 仅根级 name 联动：路径级联不触碰任何 FTS 列值，子树行零写入（spec §7.7）
  const stmtRenameFtsName = db.prepare('UPDATE node_fts SET name = @name WHERE rowid = @id');
  // 移动的父指针更新：与级联路径写同事务，保证树结构与路径物化原子一致（宪法 A.4-4）
  const stmtMoveParent = db.prepare(
    'UPDATE node SET parent_id = @parentId, updated_at = @now WHERE id = @id',
  );

  // —— 软删除域语句（FR-VFS-06，spec §7.5）：子树级读写统一走上方 CTE 工厂，禁方法体内联 prepare（宪法 A.4-5）——
  // 回收站行获取：仅命中 deleted_at 非空行，作为还原入口的回收站判定（未删除/不存在统一拒绝）
  const stmtRowInTrash = db.prepare<number, NodeRow>(
    'SELECT * FROM node WHERE id = ? AND deleted_at IS NOT NULL',
  );

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
      // 块语句形式为 v8 块级覆盖提供独立范围（单行 if+throw 的真值分支无法被覆盖工具归因）
      if (row === undefined) {
        throw new AppError(E_VFS_NOT_FOUND, '路径不存在或已在回收站');
      }
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

    /**
     * 按 nodeId 反查节点元数据（M4 vfs:get，spec §6.1）：rename/move 后渲染端 meta 新鲜化基座。
     * 未删除校验内联在语句 WHERE 中；未命中抛 E_VFS_NOT_FOUND，由 IPC handler 层转 Result DTO。
     */
    getNode(request: NodeIdRequest): NodeMeta {
      const row = stmtMetaById.get(request.nodeId);
      // 块语句形式为 v8 块级覆盖提供独立范围（单行 if+throw 的真值分支无法被覆盖工具归因）
      if (row === undefined) {
        throw new AppError(E_VFS_NOT_FOUND, '节点不存在或已在回收站');
      }
      return toNodeMeta(row);
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
      const dup = stmtDupIdByParentName.get(parent.id, name);
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

    /**
     * 重命名（FR-VFS-04）：名称校验 → 同名短路 → 重名预查 → 单事务改名 + 子树路径级联 + FTS name 联动。
     * 根节点不可操作（E_VFS_NOT_FOUND）；级联仅改 virtual_path，子树 FTS 列零写入（spec §7.7）。
     * 参数 newName 为用户输入的新名称（入库前经 NFC 规范化校验）；返回 affectedCount 为含自身的子树受影响节点数。
     * 异常：E_VFS_NOT_FOUND（节点缺失/已在回收站/根节点）、E_VFS_INVALID_NAME（非法名称）、
     * E_VFS_DUPLICATE_NAME（同级重名）；全部经 runWriteTransaction 映射后抛出，调用方按 AppError.code 分支处理。
     */
    renameNode(request: RenameNodeRequest): AffectedResponse {
      const row = requireRow(request.nodeId);
      // 根节点是全树唯一 parent_id 为 null 的节点，以空父指针识别根（同时收窄类型供重名预查绑定）
      if (row.parent_id === null) throw new AppError(E_VFS_NOT_FOUND, '根节点不可操作');
      const newName = validateNodeName(request.newName);
      // 同名重命名视为无操作：先短路再重名预查，避免预查命中自身误报重名
      if (newName === row.name) return { affectedCount: 0 };
      const dup = stmtDupIdByParentName.get(row.parent_id, newName);
      if (dup !== undefined) throw new AppError(E_VFS_DUPLICATE_NAME, '同级已存在同名文件或文件夹');
      return runWriteTransaction(db, () => {
        const now = toLocalIsoTime(new Date());
        const oldPath = row.virtual_path;
        // 新路径 = 旧路径去掉末级旧名 + 新名（JS 侧按 UTF-16 切片，SQLite 侧 substr/length 自洽，拼接结果一致）
        const newPath = oldPath.slice(0, oldPath.length - row.name.length) + newName;
        stmtRenameSelf.run({ id: row.id, name: newName, now });
        subtree.stmtCascadePath.run({ rootId: row.id, oldPath, newPath });
        // FTS 仅根级 name 联动；子树节点 name/body 不变，不产生 FTS 写（spec §7.7）
        stmtRenameFtsName.run({ id: row.id, name: newName });
        // 子树计数按 id 身份集合统计（含根自身，勿再 +1）：身份集合与级联前一致，计数不再依赖 newPath
        const affected = subtree.stmtSubtreeIds.all({ rootId: row.id }).length;
        return { affectedCount: affected };
      });
    },

    /**
     * 移动（FR-VFS-05）：环检测（O(1) 前缀比较）→ 目标校验与重名预查 → 单事务级联迁移子树路径并更新父指针。
     * 目标必须是文件夹；根节点不可被移动；移到自身或自身后代一律拒绝（防子树成环）；
     * 移动到当前父目录为无操作短路，直接返回 affectedCount 0（M2 spec §3.3）。
     * 参数 targetDirId 为目标文件夹节点 id；返回 affectedCount 为含自身的子树受影响节点数。
     * 异常：E_VFS_NOT_FOUND（源/目标缺失或已在回收站、根节点）、E_VFS_INVALID_MOVE（目标非文件夹/环/根）、
     * E_VFS_DUPLICATE_NAME（目标目录下已有同名节点）；调用方按 AppError.code 分支处理。
     */
    moveNode(request: MoveNodeRequest): AffectedResponse {
      const row = requireRow(request.nodeId);
      if (row.id === 1) throw new AppError(E_VFS_NOT_FOUND, '根节点不可操作');
      if (row.parent_id === null) throw new AppError(E_VFS_INVALID_MOVE, '根节点不可移动');
      const target = requireRow(request.targetDirId);
      if (target.node_type !== 'dir') throw new AppError(E_VFS_INVALID_MOVE, '目标必须是文件夹');
      // 同父移动为无操作：先于重名预查短路（预查会命中节点自身造成 DUPLICATE 误导，M2 spec §3.3）
      if (row.parent_id === target.id) return { affectedCount: 0 };
      // 环检测 O(1)：目标路径等于被移节点路径或落在其子树内（含移到自身）即拒绝（spec §7.5）
      if (
        target.virtual_path === row.virtual_path ||
        target.virtual_path.startsWith(row.virtual_path + '/')
      ) {
        throw new AppError(E_VFS_INVALID_MOVE, '不能移动到自身或其子文件夹');
      }
      const newName = row.name;
      // 目标目录重名预查（spec §5）：与 create/rename 共用闭包级语句，禁方法体内联 prepare（宪法 A.4-5）
      const dup = stmtDupIdByParentName.get(target.id, newName);
      if (dup !== undefined) {
        throw new AppError(E_VFS_DUPLICATE_NAME, '目标文件夹已存在同名文件或文件夹');
      }
      return runWriteTransaction(db, () => {
        const now = toLocalIsoTime(new Date());
        const oldPath = row.virtual_path;
        // 目标为根（'/'）时不产生双斜杠：直接以斜杠拼接新名
        const newPath =
          target.virtual_path === '/' ? '/' + newName : target.virtual_path + '/' + newName;
        // 先级联改写子树全部路径（含被移节点自身），再更新被移节点父指针，两写同事务（宪法 A.4-4）
        subtree.stmtCascadePath.run({ rootId: row.id, oldPath, newPath });
        stmtMoveParent.run({ parentId: target.id, now, id: row.id });
        // 子树计数按 id 身份集合统计（含被移节点自身，勿再 +1）：计数不再依赖 newPath
        const affected = subtree.stmtSubtreeIds.all({ rootId: row.id }).length;
        return { affectedCount: affected };
      });
    },
    /** 软删除（FR-VFS-06）：先删 FTS 行（宪法 A.4-10 顺序）后置 deleted_at；partial unique 随即让名 */
    trashNode(request: NodeIdRequest): AffectedResponse {
      const row = requireRow(request.nodeId);
      if (row.id === 1) throw new AppError(E_VFS_NOT_FOUND, '根节点不可操作');
      return runWriteTransaction(db, () => {
        const now = toLocalIsoTime(new Date());
        // A.4-10：先删 FTS 索引行后软删业务行；CTE 按 id 圈定整树，同路径回收站孪生树不受沾染
        subtree.stmtDeleteFts.run({ rootId: row.id });
        const info = subtree.stmtSoftDelete.run({ rootId: row.id, now });
        return { affectedCount: info.changes };
      });
    },

    /** 还原（FR-VFS-06）：须在回收站且父链未删；整棵子树恢复 + FTS 重建；撞名由约束映射 */
    restoreNode(request: NodeIdRequest): NodeMeta {
      const row = stmtRowInTrash.get(request.nodeId);
      if (row === undefined || row.id === 1) {
        throw new AppError(E_VFS_NOT_FOUND, '节点不在回收站');
      }
      if (row.parent_id !== null) {
        // 不变式：trash 以子树为单位，父在回收站则子不可单独还原（spec §7.5）
        const parent = stmtRowById.get(row.parent_id);
        if (parent === undefined || parent.deleted_at !== null) {
          throw new AppError(E_VFS_NOT_FOUND, '父文件夹仍在回收站，请先还原上级');
        }
      }
      return runWriteTransaction(db, () => {
        const now = toLocalIsoTime(new Date());
        // 时序结论保留（M1 修复轮）：先取子树全行快照，再整树还原，避免对处于变更中的行集取数
        const rows = subtree.stmtSubtreeRows.all({ rootId: row.id });
        subtree.stmtRestore.run({ rootId: row.id, now });
        // 按快照重建子树 FTS：逐行取内容判定文本（与业务行同事务，宪法 A.4-4）
        for (const r of rows) {
          const body =
            r.mime_type !== null && isTextualMime(r.mime_type)
              ? (r.content?.toString('utf8') ?? '')
              : '';
          stmtInsertFts.run({ id: r.id, name: r.name, body });
        }
        // 返回/广播携带还原时刻 updatedAt（spec §3.3）：以行快照合并已写入字段（还原 UPDATE 刚写入，
        // 值必一致）；不重读、不留死分支——「与库一致」由测试直查 SQL 验证。
        // 注解保留 deleted_at 覆盖语义（还原后必为 null）；toNodeMeta 只读展示字段，多余列不参与映射
        const restoredRow: NodeRow & { deleted_at: string | null } = {
          ...row,
          deleted_at: null,
          updated_at: now,
        };
        return toNodeMeta(restoredRow);
      });
    },

    /**
     * 彻底删除（FR-VFS-06）：物理移除子树并清 FTS。子树身份按 parent_id 递归 CTE 的结构闭包圈定，
     * 不再按目标行删除状态分支锚定——「trash 后同路径重建」的孪生树互不误伤（M2 spec §3.2）。
     * 顺序满足宪法 A.4-10：先清子树 FTS 行（FR-VFS-06「并清 FTS」；回收站目标子树本无 FTS 行
     * ——trash 已先删，本语句恒影响 0 行，仅作不变式兜底），后物理删除业务行。
     */
    purgeNode(request: NodeIdRequest): AffectedResponse {
      const row = stmtRowById.get(request.nodeId); // 不过滤删除态：回收站内节点也可彻底删除
      if (row === undefined) throw new AppError(E_VFS_NOT_FOUND, '节点不存在');
      if (row.id === 1) throw new AppError(E_VFS_NOT_FOUND, '根节点不可操作');
      return runWriteTransaction(db, () => {
        // 计数不取 changes：FK ON DELETE CASCADE 的级联删除不计入 sqlite3_changes（实测）；
        // 计数与删除同源于 id 身份集合（与 rename/move 同一 affectedCount 语义）
        const affected = subtree.stmtSubtreeIds.all({ rootId: row.id }).length;
        subtree.stmtDeleteFts.run({ rootId: row.id });
        subtree.stmtPurge.run({ rootId: row.id });
        return { affectedCount: affected };
      });
    },
  };
}

export type VfsService = ReturnType<typeof createVfsService>;
