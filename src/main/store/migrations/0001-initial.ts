// v1 基线 schema：docs/03 §3.1 原文落地 + 根节点种子（spec §3.3）
// 编写规范（spec §3.3）：SQLITE_DQS=0 下字符串一律单引号；不用 IF NOT EXISTS（幂等由执行器保证）
import type Database from 'better-sqlite3';
import type { Migration } from './index';

export const initialMigration: Migration = {
  version: 1,
  name: 'initial-vfs-schema',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE node (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id     INTEGER REFERENCES node(id) ON DELETE CASCADE,
        node_type     TEXT    NOT NULL CHECK (node_type IN ('dir','file')),
        name          TEXT    NOT NULL,
        virtual_path  TEXT    NOT NULL UNIQUE,
        mime_type     TEXT,
        size          INTEGER NOT NULL DEFAULT 0,
        content       BLOB,
        content_hash  TEXT,
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL,
        deleted_at    TEXT
      );
      CREATE UNIQUE INDEX idx_node_parent_name ON node(parent_id, name) WHERE deleted_at IS NULL;
      CREATE INDEX idx_node_parent ON node(parent_id) WHERE deleted_at IS NULL;
      CREATE INDEX idx_node_deleted ON node(deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE VIRTUAL TABLE node_fts USING fts5(name, body);
    `);
    // 根节点种子：id=1、无父、路径 '/'（spec §3.3；name 空串满足 NOT NULL，展示层特殊处理）
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, size, created_at, updated_at)
       VALUES (1, NULL, 'dir', '', '/', 0, @now, @now)`,
    ).run({ now: new Date(0).toISOString() });
  },
};
