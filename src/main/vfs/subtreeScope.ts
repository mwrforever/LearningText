// 子树身份唯一来源（M2 spec §3.2）：parent_id 传递闭包（递归 CTE）取代 M1 路径前缀谓词——
// 路径是可变展示属性（trash 让名后可出现同路径孪生树），身份必须锚定结构（id）。
// 依赖不变式：软删行构成闭包子树（创建/还原要求活父链、trash/restore/move 整树原子），
// 任一子树内行同态，故 CTE 无需删除态过滤，孪生树互不沾染（M1 状态锚定方案随之下线）。
// 性能：递归下钻每层走 v2 的 idx_node_parent_all（spec §2.2④）。
// vfsService 与 searchService（underPath 过滤）共用本工厂，各自闭包级预编译（宪法 A.4-5）。
import type { Statement } from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { NodeRow } from './nodeRowMapper';

/** CTE 头部：WITH RECURSIVE subtree(id) AS (...) —— 可前置到 SELECT/UPDATE/DELETE 任一种语句；
 *  searchService 以同一文本组合 underPath 子树限定谓词（身份来源唯一，spec §3.1） */
export const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT @rootId
  UNION ALL
  SELECT n.id FROM node n JOIN subtree s ON n.parent_id = s.id
)`;

/** 子树行基形态：复用 nodeRowMapper 的存储行模型（字段与 node 表读取行同源，消除双份手写漂移） */
export type SubtreeRowBase = NodeRow;

export interface SubtreeStatements {
  readonly stmtSubtreeIds: Statement<{ rootId: number }, { id: number }>;
  readonly stmtSubtreeRows: Statement<
    { rootId: number },
    SubtreeRowBase & { content: Buffer | null }
  >;
  readonly stmtDeleteFts: Statement<{ rootId: number }, unknown>;
  readonly stmtSoftDelete: Statement<{ rootId: number; now: string }, { changes: number }>;
  readonly stmtRestore: Statement<{ rootId: number; now: string }, { changes: number }>;
  readonly stmtPurge: Statement<{ rootId: number }, { changes: number }>;
  readonly stmtCascadePath: Statement<
    { rootId: number; oldPath: string; newPath: string },
    { changes: number }
  >;
}

export function createSubtreeStatements(db: Database.Database): SubtreeStatements {
  return {
    stmtSubtreeIds: db.prepare<{ rootId: number }, { id: number }>(
      `${SUBTREE_CTE} SELECT id FROM subtree`,
    ),
    stmtSubtreeRows: db.prepare<{ rootId: number }, SubtreeRowBase & { content: Buffer | null }>(
      `${SUBTREE_CTE} SELECT id, parent_id, node_type, name, virtual_path, mime_type, size,
              created_at, updated_at, content FROM node WHERE id IN (SELECT id FROM subtree)`,
    ),
    // A.4-10：FTS 索引行删除先于业务行改写/删除（调用方在事务内保证顺序）
    stmtDeleteFts: db.prepare(
      `${SUBTREE_CTE} DELETE FROM node_fts WHERE rowid IN (SELECT id FROM subtree)`,
    ),
    stmtSoftDelete: db.prepare(
      `${SUBTREE_CTE} UPDATE node SET deleted_at = @now, updated_at = @now WHERE id IN (SELECT id FROM subtree)`,
    ),
    stmtRestore: db.prepare(
      `${SUBTREE_CTE} UPDATE node SET deleted_at = NULL, updated_at = @now WHERE id IN (SELECT id FROM subtree)`,
    ),
    stmtPurge: db.prepare(`${SUBTREE_CTE} DELETE FROM node WHERE id IN (SELECT id FROM subtree)`),
    // 路径值仍由旧前缀→新前缀拼接计算（与 M1 级联语义一致），仅身份圈定从「路径谓词」改为「子树 id 集合」
    stmtCascadePath: db.prepare(
      `${SUBTREE_CTE} UPDATE node SET virtual_path = @newPath || substr(virtual_path, length(@oldPath) + 1)
       WHERE id IN (SELECT id FROM subtree)`,
    ),
  };
}
