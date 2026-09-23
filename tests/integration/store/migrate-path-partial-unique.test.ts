// v3 迁移语义（历史库 schema 修复）：列级 UNIQUE 复现「回收站不让名」缺陷 → 迁移后收敛到
// 部分唯一索引且语义恢复；同时锁定数据保全（行/内容/FTS/AUTOINCREMENT 高水位）与健康库无操作。
// 历史库形态以「v1 旧定义 DDL 快照」在现场重建——0001 曾被就地修改（e17da0f 起为部分唯一
// 索引形态），无法再用 initialMigration 构造旧库，故此处显式固化当年 DDL（仅列级 UNIQUE 一处
// 差异，其余与 0001 逐字一致）作为复现夹具。
import { describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { ALL_MIGRATIONS } from '../../../src/main/store/migrations';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import { E_VFS_DUPLICATE_NAME } from '../../../src/shared/errors';

/** 静音迁移 info 日志（断言日志的用例自行 spy；restore 会清空调用记录，断言放 try 内） */
function silence(): () => void {
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  return () => spy.mockRestore();
}

/**
 * 旧库（2026-09-17 前创建）夹具：`virtual_path` 为**列级 UNIQUE**（全量约束，含回收站行）、
 * 无部分唯一索引 idx_node_virtual_path；FTS 已是 v2 trigram 形态、索引与 user_version 与
 * 用户真实旧库逐项一致（取证见 docs/progress/2026-09-23-四项历史前置修复项核验报告.md）。
 */
function openLegacyV2(): Database.Database {
  const db = openDatabase({ file: ':memory:' });
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
    CREATE INDEX idx_node_parent_all ON node(parent_id);
    CREATE VIRTUAL TABLE node_fts USING fts5(name, body, tokenize = 'trigram');
    INSERT INTO node (id, parent_id, node_type, name, virtual_path, size, created_at, updated_at)
      VALUES (1, NULL, 'dir', '', '/', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
  `);
  db.pragma('user_version = 2');
  return db;
}

/** 索引形状摘要：`名(unique,partial)` 序列，用于逐项断言 schema 收敛 */
function indexShape(db: Database.Database): string[] {
  const indexes = db.pragma('index_list(node)') as Array<{
    name: string;
    unique: number;
    partial: number;
  }>;
  return indexes.map((i) => `${i.name}(${String(i.unique)},${String(i.partial)})`).sort();
}

describe('v3 路径部分唯一索引迁移（历史库 schema 修复）', () => {
  it('注册表含 v1+v2+v3 且版本严格递增', () => {
    expect(ALL_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3]);
  });

  it('旧库复现缺陷：trash 后建同名目录被拒（列级 UNIQUE 占名，服务层预查放行后由约束兜底）', () => {
    const db = openLegacyV2();
    const vfs = createVfsService(db);
    const dir = vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' });
    vfs.trashNode({ nodeId: dir.id });
    try {
      vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' });
      expect.unreachable('旧库下应被列级 UNIQUE 拒绝（用户实测缺陷）');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
    db.close();
  });

  it('对照：现行 schema（全新库）同一序列通过——证明缺陷源自 schema 而非服务逻辑', () => {
    const db = openDatabase({ file: ':memory:' });
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    const vfs = createVfsService(db);
    const dir = vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' });
    vfs.trashNode({ nodeId: dir.id });
    expect(vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' }).name).toBe('资料');
    db.close();
  });

  it('迁移收敛 schema：列级 UNIQUE 消失、部分唯一索引 idx_node_virtual_path 到位、全部索引重建', () => {
    const db = openLegacyV2();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    // 表定义不再含列级 UNIQUE（SQL 层面的收敛事实）
    const tableSql = db
      .prepare<[], { sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'node'",
      )
      .get()?.sql;
    expect(tableSql).not.toMatch(/UNIQUE/i);
    // 索引形状与现行库一致：路径唯一性为部分索引（1,1），无 origin='u' 的 virtual_path 自动索引
    expect(indexShape(db)).toEqual([
      'idx_node_deleted(0,1)',
      'idx_node_parent(0,1)',
      'idx_node_parent_all(0,0)',
      'idx_node_parent_name(1,1)',
      'idx_node_virtual_path(1,1)',
    ]);
    // 中转表不残留（重建后即删）
    expect(
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE name = 'node_v1_legacy'",
        )
        .all(),
    ).toHaveLength(0);
    db.close();
  });

  it('数据保全：行（含回收站行与 BLOB 内容）/ FTS 索引行 / 外键 / 完整性逐项不变', () => {
    const db = openLegacyV2();
    const content = Buffer.from('<p>Spring 框架全景解析</p>', 'utf8');
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at, deleted_at)
       VALUES (2, 1, 'file', '笔记.html', '/笔记.html', 'text/html', @size, @content, 'hash-2', 'created-2', 'updated-2', NULL)`,
    ).run({ size: content.byteLength, content });
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, mime_type, size, content, created_at, updated_at, deleted_at)
       VALUES (3, 1, 'dir', '资料', '/资料', NULL, 0, NULL, 'created-3', 'updated-3', '2026-09-23T10:00:00.000+08:00')`,
    ).run();
    db.prepare(
      `INSERT INTO node_fts (rowid, name, body) VALUES (2, '笔记.html', '<p>Spring 框架全景解析</p>')`,
    ).run();
    // 高水位抬升（id=7 曾存在后被 purge 的真实形态）：迁移必须回填，防 id 复用
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, size, created_at, updated_at)
       VALUES (7, 1, 'dir', '曾删目录', '/曾删目录', 0, 'created-7', 'updated-7')`,
    ).run();
    db.prepare('DELETE FROM node WHERE id = 7').run();

    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }

    const rows = db
      .prepare<[], { id: number; name: string; deleted_at: string | null; content: Buffer | null }>(
        'SELECT id, name, deleted_at, content FROM node ORDER BY id',
      )
      .all();
    expect(rows.map((r) => `${String(r.id)}:${r.name}:${String(r.deleted_at)}`)).toEqual([
      '1::null',
      '2:笔记.html:null',
      '3:资料:2026-09-23T10:00:00.000+08:00',
    ]);
    expect(rows[1]?.content?.equals(content)).toBe(true);
    const ftsRows = db
      .prepare<[], { rowid: number; name: string; body: string }>(
        'SELECT rowid, name, body FROM node_fts ORDER BY rowid',
      )
      .all();
    expect(ftsRows).toEqual([{ rowid: 2, name: '笔记.html', body: '<p>Spring 框架全景解析</p>' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    // AUTOINCREMENT 高水位回填：purge 过 id=7 后新插入必须是 8，而非复用 4
    db.prepare(
      `INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at)
       VALUES (1, 'dir', '新目录', '/新目录', 0, 'now', 'now')`,
    ).run();
    expect(
      db.prepare<[string], { id: number }>('SELECT id FROM node WHERE name = ?').get('新目录')?.id,
    ).toBe(8);
    db.close();
  });

  it('迁移后语义恢复：trash 让名可建同名；还原撞名仍由约束拒绝（部分索引语义完整）', () => {
    const db = openLegacyV2();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    const vfs = createVfsService(db);
    const first = vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' });
    vfs.trashNode({ nodeId: first.id });
    // 让名：回收站占位不再阻拦同名新建（用户实测缺陷面）
    const second = vfs.createNode({ parentId: 1, name: '资料', nodeType: 'dir' });
    expect(second.id).not.toBe(first.id);
    // 还原撞名：活行占路径时仍拒绝（FR-VFS-06 语义——唯一性只对活行生效，不放开为无约束）
    try {
      vfs.restoreNode({ nodeId: first.id });
      expect.unreachable('活行同名时还原应被拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
    db.close();
  });

  it('健康库（已为部分唯一索引）走快速路径：无重建、无中转表、数据与 schema 原样', () => {
    const db = openDatabase({ file: ':memory:' });
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    // v3 已随全量迁移在健康库上执行一次（无操作）；再显式重放一次 v3 验证幂等快速路径
    const before = indexShape(db);
    const v3 = ALL_MIGRATIONS[2];
    expect(v3).toBeDefined();
    if (v3 !== undefined) v3.up(db);
    expect(indexShape(db)).toEqual(before);
    expect(
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE name = 'node_v1_legacy'",
        )
        .all(),
    ).toHaveLength(0);
    expect(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node').get()?.c).toBe(1);
    db.close();
  });

  it('序列行缺失边界：sqlite_sequence 无 node 行时按 0 兜底，迁移照常完成且不劣化（新 id 续 max(id)+1）', () => {
    const db = openLegacyV2();
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, size, created_at, updated_at)
       VALUES (4, 1, 'dir', '既有目录', '/既有目录', 0, 'created-4', 'updated-4')`,
    ).run();
    // 手工整理过的库：AUTOINCREMENT 高水位行缺失（迁移须容错，不得因读不到高水位而中断）
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'node'").run();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    db.prepare(
      `INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at)
       VALUES (1, 'dir', '后建目录', '/后建目录', 0, 'now', 'now')`,
    ).run();
    expect(
      db.prepare<[string], { id: number }>('SELECT id FROM node WHERE name = ?').get('后建目录')
        ?.id,
    ).toBe(5);
    db.close();
  });
});
