// 事务封装（spec §4）：IMMEDIATE 写事务、异常回滚、SQLite 错误码映射（spec §5 表）
import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { runWriteTransaction } from '../../../src/main/store/transaction';
import {
  E_VFS_DUPLICATE_NAME,
  E_STORE_BUSY,
  E_STORE_DB_DAMAGED,
  E_STORE_DISK_FULL,
  E_STORE_INTERNAL,
} from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';
import { mapSqliteError } from '../../../src/main/store/errorMapping';

describe('runWriteTransaction', () => {
  it('正常路径提交变更，fn 返回值透传', () => {
    const db = openDatabase({ file: ':memory:' });
    runMigrations(db);
    const result = runWriteTransaction(db, () => {
      db.prepare(
        "INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at) VALUES (1, 'dir', 'x', '/x', 0, 't', 't')",
      ).run();
      return 'done';
    });
    expect(result).toBe('done');
    expect(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node').get()?.c).toBe(2);
    db.close();
  });

  it('业务异常整体回滚且异常继续向上抛', () => {
    const db = openDatabase({ file: ':memory:' });
    runMigrations(db);
    expect(() =>
      runWriteTransaction(db, () => {
        db.prepare(
          "INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at) VALUES (1, 'dir', 'x', '/x', 0, 't', 't')",
        ).run();
        throw new AppError(E_VFS_DUPLICATE_NAME, '同名');
      }),
    ).toThrow(AppError);
    expect(db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node').get()?.c).toBe(1);
    db.close();
  });

  it('同目录重名触发 UNIQUE 约束，自动映射 E_VFS_DUPLICATE_NAME', () => {
    const db = openDatabase({ file: ':memory:' });
    runMigrations(db);
    const insert = (): void =>
      runWriteTransaction(db, () => {
        db.prepare(
          "INSERT INTO node (parent_id, node_type, name, virtual_path, size, created_at, updated_at) VALUES (1, 'dir', 'same', @p, 0, 't', 't')",
        ).run({ p: Math.random().toString() });
      });
    insert();
    expect(insert).toThrow(AppError);
    try {
      insert();
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
    db.close();
  });

  it('未知异常（非 AppError 且无 SQLite code）原样上抛，不被错误映射改写', () => {
    // 以桩库句柄注入普通 TypeError：既非业务 AppError 也非 SqliteError，
    // 必须走「原样上抛」兜底分支，保留原始异常供上层日志定位
    const original = new TypeError('非数据库异常');
    const fakeDb = {
      transaction: () => ({
        immediate: () => {
          throw original;
        },
      }),
    } as unknown as Database.Database;
    expect(() => runWriteTransaction(fakeDb, () => 'x')).toThrow(original);
  });
});

describe('mapSqliteError', () => {
  it('非 SqliteError 归一为 E_STORE_INTERNAL', () => {
    const mapped = mapSqliteError(new Error('普通错误'));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe(E_STORE_INTERNAL);
  });

  it('SQLITE_CORRUPT 映射 E_STORE_DB_DAMAGED', () => {
    const sqliteLike = Object.assign(new Error('database disk image is malformed'), {
      code: 'SQLITE_CORRUPT',
    });
    expect(mapSqliteError(sqliteLike).code).toBe('E_STORE_DB_DAMAGED');
  });

  it('SQLITE_NOTADB 同归 E_STORE_DB_DAMAGED（损坏类双码）', () => {
    const notadb = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    expect(mapSqliteError(notadb).code).toBe(E_STORE_DB_DAMAGED);
  });

  it('SQLITE_BUSY 映射 E_STORE_BUSY（WAL 边缘事件走用户提示路径）', () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    expect(mapSqliteError(busy).code).toBe(E_STORE_BUSY);
  });

  it('SQLITE_FULL 映射 E_STORE_DISK_FULL', () => {
    const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    expect(mapSqliteError(full).code).toBe(E_STORE_DISK_FULL);
  });

  it('SQLITE_CONSTRAINT_UNIQUE 映射 E_VFS_DUPLICATE_NAME', () => {
    const dup = Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(mapSqliteError(dup).code).toBe(E_VFS_DUPLICATE_NAME);
  });

  it('未识别 SQLite 码兜底 E_STORE_INTERNAL', () => {
    const unknownCode = Object.assign(new Error('未知 SQLite 错误'), { code: 'SQLITE_WEIRD' });
    expect(mapSqliteError(unknownCode).code).toBe(E_STORE_INTERNAL);
  });
});
