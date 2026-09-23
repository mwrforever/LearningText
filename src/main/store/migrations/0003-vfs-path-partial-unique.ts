// v3：路径唯一约束收敛为「部分唯一索引」——历史库 schema 修复（用户实测缺陷根因）。
// 背景：v1 初次落地时 `virtual_path` 为列级 `UNIQUE`（全量约束，含回收站行）；2026-09-17
// 软删除域批次（e17da0f）把 v1 定义**就地**改为「列不带 UNIQUE + 部分唯一索引
// idx_node_virtual_path (WHERE deleted_at IS NULL)」——就地修改对已建库无效（user_version
// 已为 1/2，迁移不再重放），于是该日之前创建的库一直带着列级 UNIQUE：软删行不让出路径，
// 回收站让名语义（FR-VFS-06）整条失效——trash 后建同名目录/导入同名文件/重命名/移动/还原
// 一律 SQLITE_CONSTRAINT_UNIQUE → E_VFS_DUPLICATE_NAME「同级已存在同名文件或文件夹」，
// 且服务层重名预查（仅查活行）放行后由约束兜底报错，用户侧表现为「删除后无法再建同名目录」。
// 落法（SQLite 无法 DROP 列级约束）：官方推荐范式重建表——重名旧表 → 建新表（现行 0001
// 定义，无列级 UNIQUE）→ 按 id 升序复制（父节点 id 恒小于子节点，FK 即时校验下父先行）→
// 删旧表 → 重建全部索引（0001 四条 + v2 的 idx_node_parent_all）→ 回填 AUTOINCREMENT 高水位
// （purge 过最高 id 的库 max(id) 低于历史高水位，不回填会复用 id，破坏 FTS rowid 身份语义）。
// 健康库（无列级 UNIQUE）走快速路径直接返回：只做一次索引形状判定，不动任何数据。
// 单迁移单事务（执行器保证）：任一语句失败整体回滚、user_version 不推进，启动 fail-fast。
import type Database from 'better-sqlite3';
import type { Migration } from './index';

/** 旧表名（重建中转）：迁移事务内生命周期，成功后即删 */
const LEGACY_TABLE = 'node_v1_legacy';

/**
 * 旧库判定：node 上存在**表级约束的自动索引**（`origin='u'`，即 DDL 里写了列级/表级 UNIQUE）。
 * 现行 schema 的唯一性全部由显式 `CREATE [UNIQUE] INDEX`（`origin='c'`）承载，表定义零约束——
 * 故「存在 origin='u' 的自动索引」与「库还是旧形态」等价，无需逐列内省（SQLite 的自动索引
 * 必为唯一索引且非部分索引，`partial`/列名判定在两种真实形态下均不可达，徒增不可测分支）。
 * 判定与重建共用同一事实：v3 的职责就是让 node 收敛到零表级约束的规范 DDL。
 */
function hasLegacyTableConstraint(db: Database.Database): boolean {
  const row = db
    .prepare<[], { c: number }>(
      "SELECT COUNT(*) AS c FROM pragma_index_list('node') WHERE origin = 'u'",
    )
    .get() as { c: number };
  return row.c > 0;
}

export const pathPartialUniqueMigration: Migration = {
  version: 3,
  name: 'vfs-path-partial-unique',
  up(db: Database.Database): void {
    if (!hasLegacyTableConstraint(db)) return;

    // AUTOINCREMENT 高水位先读后建（旧表被 DROP 时其 sqlite_sequence 行随之消失）；
    // 序列行缺失（库被手工整理过）按 0 兜底：新表 seq 由复制行自动落到 max(id)，语义不劣化
    const seqRow = db
      .prepare<[], { seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'node'")
      .get();
    const legacySeq = seqRow?.seq ?? 0;

    db.exec(`
      ALTER TABLE node RENAME TO ${LEGACY_TABLE};
      CREATE TABLE node (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id     INTEGER REFERENCES node(id) ON DELETE CASCADE,
        node_type     TEXT    NOT NULL CHECK (node_type IN ('dir','file')),
        name          TEXT    NOT NULL,
        virtual_path  TEXT    NOT NULL,    -- 物化完整路径（唯一性由下方部分唯一索引约束，软删行让出路径 FR-VFS-06）
        mime_type     TEXT,
        size          INTEGER NOT NULL DEFAULT 0,
        content       BLOB,
        content_hash  TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL,
        deleted_at    TEXT
      );
      INSERT INTO node (id, parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at, deleted_at)
        SELECT id, parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at, deleted_at
        FROM ${LEGACY_TABLE} ORDER BY id;
      DROP TABLE ${LEGACY_TABLE};
      CREATE UNIQUE INDEX idx_node_parent_name ON node(parent_id, name) WHERE deleted_at IS NULL;
      CREATE INDEX idx_node_parent ON node(parent_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_node_deleted ON node(deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE UNIQUE INDEX idx_node_virtual_path ON node(virtual_path) WHERE deleted_at IS NULL;
      CREATE INDEX idx_node_parent_all ON node(parent_id);
    `);

    // 高水位回填：只升不降（复制后新表的 seq 为当前 max(id)，历史高水位可能更高）
    db.prepare("UPDATE sqlite_sequence SET seq = @seq WHERE name = 'node' AND seq < @seq").run({
      seq: legacySeq,
    });
  },
};
