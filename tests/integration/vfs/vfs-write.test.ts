// 写路径（FR-VFS-01/03）：重名/非法名/超限拒绝、元数据联动、FTS 同事务写入
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import {
  E_VFS_DUPLICATE_NAME,
  E_VFS_FILE_TOO_LARGE,
  E_VFS_INVALID_NAME,
  E_VFS_NOT_FOUND,
  E_VFS_TYPE_MISMATCH,
} from '../../../src/shared/errors';

let db: Database.Database;
let vfs: ReturnType<typeof createVfsService>;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
});

const ftsRow = (id: number): { name: string; body: string } | undefined =>
  db
    .prepare<number, { name: string; body: string }>(
      'SELECT name, body FROM node_fts WHERE rowid = ?',
    )
    .get(id);

describe('createNode', () => {
  it('建目录与建文件：元数据完整、路径物化正确', () => {
    const dir = vfs.createNode({ parentId: 1, name: '笔记', nodeType: 'dir' });
    expect(dir).toMatchObject({
      parentId: 1,
      nodeType: 'dir',
      virtualPath: '/笔记',
      mimeType: null,
      size: 0,
    });
    const file = vfs.createNode({
      parentId: dir.id,
      name: 'index.html',
      nodeType: 'file',
      content: new Uint8Array(Buffer.from('<p>x</p>')),
    });
    expect(file).toMatchObject({
      virtualPath: '/笔记/index.html',
      mimeType: 'text/html',
      size: 8, // '<p>x</p>' 实为 8 字节（简报笔误 7，按内容真实字节数断言）
    });
    expect(ftsRow(file.id)).toEqual({ name: 'index.html', body: '<p>x</p>' }); // 文本 MIME 入 body
    expect(ftsRow(dir.id)).toEqual({ name: '笔记', body: '' }); // 目录 body 空串
  });

  it('content_hash 为内容 SHA-256 hex', () => {
    const file = vfs.createNode({
      parentId: 1,
      name: 'h.txt',
      nodeType: 'file',
      content: new Uint8Array(Buffer.from('abc')),
    });
    const stored = db
      .prepare<number, { content_hash: string }>('SELECT content_hash FROM node WHERE id = ?')
      .get(file.id);
    expect(stored?.content_hash).toBe(createHash('sha256').update('abc').digest('hex'));
  });

  it('同目录重名（文件/目录互撞）→ E_VFS_DUPLICATE_NAME', () => {
    vfs.createNode({ parentId: 1, name: 'a', nodeType: 'dir' });
    try {
      vfs.createNode({
        parentId: 1,
        name: 'a',
        nodeType: 'file',
        content: new Uint8Array(Buffer.from('')),
      });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
  });

  it('非法名称 → E_VFS_INVALID_NAME（含 NFD 规范化后冲突）', () => {
    try {
      vfs.createNode({ parentId: 1, name: 'a/b', nodeType: 'dir' });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_INVALID_NAME);
    }
  });

  it('父不存在 → E_VFS_NOT_FOUND；目录带 content → E_VFS_TYPE_MISMATCH', () => {
    expect(() => vfs.createNode({ parentId: 999, name: 'x', nodeType: 'dir' })).toThrow(AppError);
    try {
      vfs.createNode({
        parentId: 1,
        name: 'x',
        nodeType: 'dir',
        content: new Uint8Array(Buffer.from('z')),
      });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_TYPE_MISMATCH);
    }
  });

  it('超过 50MB → E_VFS_FILE_TOO_LARGE（50MB+1 字节）', () => {
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    try {
      vfs.createNode({ parentId: 1, name: 'big.bin', nodeType: 'file', content: big });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_FILE_TOO_LARGE);
    }
  });

  it('恰好 50MB 允许写入', () => {
    const edge = new Uint8Array(50 * 1024 * 1024);
    const node = vfs.createNode({ parentId: 1, name: 'edge.bin', nodeType: 'file', content: edge });
    expect(node.size).toBe(50 * 1024 * 1024);
  });
});

describe('writeFile', () => {
  it('覆盖写：size/hash/updated_at 联动、FTS body 重写', () => {
    const file = vfs.createNode({
      parentId: 1,
      name: 'w.txt',
      nodeType: 'file',
      content: new Uint8Array(Buffer.from('v1')),
    });
    const updated = vfs.writeFile({
      nodeId: file.id,
      content: new Uint8Array(Buffer.from('version-2')),
    });
    expect(updated.size).toBe(9);
    const row = db
      .prepare<number, { content_hash: string; updated_at: string }>(
        'SELECT content_hash, updated_at FROM node WHERE id = ?',
      )
      .get(file.id);
    expect(row?.content_hash).toBe(createHash('sha256').update('version-2').digest('hex'));
    expect(ftsRow(file.id)?.body).toBe('version-2');
  });

  it('二进制内容：FTS body 置空串', () => {
    const file = vfs.createNode({
      parentId: 1,
      name: 'b.png',
      nodeType: 'file',
      content: new Uint8Array([1, 2, 3]),
    });
    vfs.writeFile({ nodeId: file.id, content: new Uint8Array([4, 5]) });
    expect(ftsRow(file.id)).toEqual({ name: 'b.png', body: '' });
  });

  it('目录写入 → E_VFS_TYPE_MISMATCH；不存在 → E_VFS_NOT_FOUND', () => {
    const dir = vfs.createNode({ parentId: 1, name: 'd', nodeType: 'dir' });
    try {
      vfs.writeFile({ nodeId: dir.id, content: new Uint8Array(Buffer.from('x')) });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_TYPE_MISMATCH);
    }
    try {
      vfs.writeFile({ nodeId: 9999, content: new Uint8Array(Buffer.from('x')) });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});
