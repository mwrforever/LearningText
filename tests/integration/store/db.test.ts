// 连接初始化 PRAGMA 冒烟：验证 better-sqlite3 在本机 ABI 下可用且 WAL 生效（宪法 A.4-2）
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';

const created: { close(): void }[] = [];

function tmpDbFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'lt-db-')), 'test.db');
}

describe('数据库连接初始化', () => {
  afterEach(() => {
    for (const db of created) db.close();
    created.length = 0;
  });

  it('打开文件库后 WAL 生效且外键约束开启', () => {
    const db = openDatabase({ file: tmpDbFile() });
    created.push(db);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it(':memory: 库同样完成初始化 PRAGMA', () => {
    const db = openDatabase({ file: ':memory:' });
    created.push(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
