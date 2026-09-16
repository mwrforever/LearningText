// 迁移执行器语义（spec §3.2）：版本判断幂等、单迁移单事务原子、user_version 同事务生效
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { ALL_MIGRATIONS } from '../../../src/main/store/migrations';

describe('runMigrations', () => {
  it('v1 迁移建全量表结构并种子根节点，user_version=1', () => {
    const db = openDatabase({ file: ':memory:' });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      runMigrations(db);
      // 迁移属数据库写操作（全局日志规范 §二）：执行时必须输出含版本号与迁移名的中文 info 日志
      // （断言须在 mockRestore 之前——restore 会连同调用记录一并重置）
      expect(infoSpy).toHaveBeenCalledWith('[store] 执行迁移 v1: initial-vfs-schema');
    } finally {
      infoSpy.mockRestore();
    }

    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const root = db
      .prepare<[number], { id: number; parent_id: number | null; virtual_path: string }>(
        'SELECT id, parent_id, virtual_path FROM node WHERE id = ?',
      )
      .get(1);
    expect(root).toEqual({ id: 1, parent_id: null, virtual_path: '/' });
    // FTS 表可查且为空
    expect(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node_fts').get()?.c).toBe(0);
    db.close();
  });

  it('重复执行幂等：同版本不重跑、数据不受影响', () => {
    const db = openDatabase({ file: ':memory:' });
    // 静音迁移 info 日志（日志内容已在首例断言），保持测试输出干净
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    runMigrations(db);
    db.prepare(
      "INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at) VALUES (1, 'dir', 'a', '/a', 0, 't', 't')",
    ).run();
    runMigrations(db);
    infoSpy.mockRestore();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node').get()?.c).toBe(2);
    db.close();
  });

  it('迁移失败整体回滚并向上抛错（user_version 不变、无残留表）', () => {
    const db = openDatabase({ file: ':memory:' });
    // 静音迁移 info 日志（日志内容已在首例断言），保持测试输出干净
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const broken = [
      {
        version: 1,
        name: 'broken-v1',
        up: (database: typeof db): void => {
          database.exec('CREATE TABLE should_rollback (id INTEGER)');
          throw new Error('迁移中途崩溃');
        },
      },
    ];
    expect(() => runMigrations(db, broken)).toThrow('迁移中途崩溃');
    infoSpy.mockRestore();
    expect(db.pragma('user_version', { simple: true })).toBe(0);
    // should_rollback 表必须不存在（事务整体回滚）
    const tables = db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .all('should_rollback');
    expect(tables).toHaveLength(0);
    db.close();
  });

  it('注册表版本严格递增（防止乱序注册）', () => {
    for (let i = 1; i < ALL_MIGRATIONS.length; i += 1) {
      expect(ALL_MIGRATIONS[i]?.version).toBe((ALL_MIGRATIONS[i - 1]?.version ?? 0) + 1);
    }
  });
});
