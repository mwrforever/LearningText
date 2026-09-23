// v2 迁移语义（spec §2.2）：trigram 换表、复制行级等价、漂移对账回滚、换名后功能可用
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { ALL_MIGRATIONS } from '../../../src/main/store/migrations';
import { initialMigration } from '../../../src/main/store/migrations/0001-initial';

/** 静音迁移 info 日志；断言日志的用例自行 spy（M1 先例：restore 会清空调用记录，断言放 try 内） */
function silence(): () => void {
  const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
  return () => spy.mockRestore();
}

/** 仅应用 v1 的库（v2 迁移前状态）；返回句柄由调用方 close */
function openAtV1(): ReturnType<typeof openDatabase> {
  const db = openDatabase({ file: ':memory:' });
  const restore = silence();
  try {
    runMigrations(db, [initialMigration]);
  } finally {
    restore();
  }
  expect(db.pragma('user_version', { simple: true })).toBe(1);
  return db;
}

describe('v2 trigram 迁移', () => {
  it('注册表含 v1+v2 且版本严格递增', () => {
    expect(ALL_MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3]);
  });

  it('迁移后 user_version 推进到最新（v3）、node_fts 声明为 trigram、父指针全量索引在场', () => {
    const db = openAtV1();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    const ftsSql = db
      .prepare<[], { sql: string }>(`SELECT sql FROM sqlite_master WHERE name = 'node_fts'`)
      .get()?.sql;
    expect(ftsSql).toContain('trigram');
    expect(
      db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE name = 'idx_node_parent_all'`,
        )
        .get(),
    ).toBeDefined();
    db.close();
  });

  it('复制行级等价：rowid/name/body 逐行保持，node_fts_new 与影子表不残留', () => {
    const db = openAtV1();
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, mime_type, size, created_at, updated_at)
       VALUES (2, 1, 'file', '笔记.html', '/笔记.html', 'text/html', 3, '2026-09-16T10:00:00.000+08:00', '2026-09-16T10:00:00.000+08:00')`,
    ).run();
    db.prepare(
      `INSERT INTO node_fts (rowid, name, body) VALUES (2, '笔记.html', '<p>二元指数分布</p>')`,
    ).run();
    const before = db
      .prepare<[], { rowid: number; name: string; body: string }>(
        `SELECT rowid, name, body FROM node_fts ORDER BY rowid`,
      )
      .all();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    expect(
      db
        .prepare<[], { rowid: number; name: string; body: string }>(
          `SELECT rowid, name, body FROM node_fts ORDER BY rowid`,
        )
        .all(),
    ).toEqual(before);
    // 换名残留防护：临时表与全部影子表名不得仍存在
    const leftovers = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE name LIKE 'node_fts_new%'`,
      )
      .all();
    expect(leftovers).toHaveLength(0);
    db.close();
  });

  it('漂移对账不平：迁移抛错回滚，user_version 保持 1、旧表行原样可查', () => {
    const db = openAtV1();
    // 直改库构造漂移：索引行多出一条幽灵记录（无对应活节点——正常写路径不可能，模拟旧索引损坏）
    db.prepare(`INSERT INTO node_fts (rowid, name, body) VALUES (999, 'ghost', '')`).run();
    const restore = silence();
    try {
      expect(() => runMigrations(db)).toThrow(/FTS 漂移对账失败/);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(
        db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM node_fts WHERE rowid = 999`).get()
          ?.c,
      ).toBe(1);
      // node_fts_new 不得残留（事务回滚）
      expect(
        db
          .prepare<[], { c: number }>(
            `SELECT COUNT(*) AS c FROM sqlite_master WHERE name LIKE 'node_fts_new%'`,
          )
          .get()?.c,
      ).toBe(0);
    } finally {
      restore();
    }
    db.close();
  });

  it('换名后 trigram 功能可用：中文 3 字子串 MATCH 命中（unicode61 不可能），2 字硬边界不命中', () => {
    const db = openAtV1();
    db.prepare(
      `INSERT INTO node (id, parent_id, node_type, name, virtual_path, mime_type, size, created_at, updated_at)
       VALUES (2, 1, 'file', '笔记.html', '/笔记.html', 'text/html', 3, '2026-09-16T10:00:00.000+08:00', '2026-09-16T10:00:00.000+08:00')`,
    ).run();
    db.prepare(
      `INSERT INTO node_fts (rowid, name, body) VALUES (2, '笔记.html', '二元指数分布')`,
    ).run();
    const restore = silence();
    try {
      runMigrations(db);
    } finally {
      restore();
    }
    // ≥3 码点：trigram 连续子串命中（'指数分' 三 gram 皆在）
    expect(
      db
        .prepare<string, { rowid: number }>(`SELECT rowid FROM node_fts WHERE node_fts MATCH ?`)
        .get('"指数分"')?.rowid,
    ).toBe(2);
    // <3 码点：trigram 无完整 gram，索引通道零命中（A.4-11 硬边界，LIKE 回退策略成立的前提）
    expect(
      db
        .prepare<string, { rowid: number }>(`SELECT rowid FROM node_fts WHERE node_fts MATCH ?`)
        .get('"指数"'),
    ).toBeUndefined();
    db.close();
  });

  it('重复执行幂等：已应用迁移不重跑（user_version 稳定、数据不受影响）', () => {
    const db = openAtV1();
    const restore = silence();
    try {
      runMigrations(db);
      runMigrations(db);
    } finally {
      restore();
    }
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM node`).get()?.c).toBe(1);
    db.close();
  });
});
