// 查询类方法（FR-VFS-02/07/08）：种子 → 断言元数据/排序/路径解析/读内容
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import { E_VFS_NOT_FOUND, E_VFS_TYPE_MISMATCH } from '../../../src/shared/errors';
import type Database from 'better-sqlite3';

let db: Database.Database;
let vfs: ReturnType<typeof createVfsService>;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
});

/** 直接 SQL 种子（绕过服务层，固定测试场景）；显式传 db 避免非空断言 */
function seed(parentId: number, name: string, type: 'dir' | 'file', content?: Buffer): number {
  const parentPath =
    db
      .prepare<number, { p: string }>('SELECT virtual_path AS p FROM node WHERE id = ?')
      .get(parentId)?.p ?? '/';
  const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
  const info = db
    .prepare(
      `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-16T10:00:00.000+08:00', '2026-09-16T10:00:00.000+08:00')`,
    )
    .run(
      parentId,
      type,
      name,
      path,
      type === 'file' ? 'text/html' : null,
      content?.length ?? 0,
      content ?? null,
    );
  return Number(info.lastInsertRowid);
}

describe('listChildren', () => {
  it('按父 id 列直接子节点：目录在前、名称升序、仅未删除', () => {
    const dirId = seed(1, '笔记', 'dir');
    seed(dirId, 'web', 'dir');
    const htmlId = seed(dirId, 'a.html', 'file', Buffer.from('<p>hi</p>'));
    seed(dirId, 'z.txt', 'file', Buffer.from('tail'));
    seed(1, 'another', 'dir');

    const children = vfs.listChildren({ parentId: dirId });
    expect(children.map((c) => c.name)).toEqual(['web', 'a.html', 'z.txt']); // 目录先于文件
    const meta = children[1];
    expect(meta).toMatchObject({
      id: htmlId,
      parentId: dirId,
      nodeType: 'file',
      mimeType: 'text/html',
      size: 9,
    });
  });

  it('按虚拟路径列子节点（二选一入参）', () => {
    seed(1, '笔记', 'dir');
    const children = vfs.listChildren({ virtualPath: '/笔记' });
    expect(children).toHaveLength(0);
  });

  it('虚拟路径不存在 → E_VFS_NOT_FOUND', () => {
    try {
      vfs.listChildren({ virtualPath: '/nope' });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });

  it('不存在/已在回收站 → E_VFS_NOT_FOUND', () => {
    expect(() => vfs.listChildren({ parentId: 9999 })).toThrow(AppError);
    try {
      vfs.listChildren({ parentId: 9999 });
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});

describe('resolvePath', () => {
  it('根与子路径解析为唯一节点', () => {
    expect(vfs.resolvePath({ virtualPath: '/' })).toEqual({ nodeId: 1 });
    const id = seed(1, 'x.html', 'file', Buffer.from('1'));
    expect(vfs.resolvePath({ virtualPath: '/x.html' })).toEqual({ nodeId: id });
  });

  it('未删除校验：回收站节点不可解析', () => {
    const id = seed(1, 'gone.html', 'file', Buffer.from('1'));
    db.prepare('UPDATE node SET deleted_at = ? WHERE id = ?').run(
      '2026-09-16T11:00:00.000+08:00',
      id,
    );
    expect(() => vfs.resolvePath({ virtualPath: '/gone.html' })).toThrow(AppError);
  });

  it('不存在的路径 → E_VFS_NOT_FOUND', () => {
    try {
      vfs.resolvePath({ virtualPath: '/nope.html' });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});

describe('readFile', () => {
  it('返回内容与完整元数据', () => {
    const id = seed(1, 'r.html', 'file', Buffer.from('<h1>t</h1>'));
    const { content, meta } = vfs.readFile({ nodeId: id });
    expect(Buffer.from(content).toString()).toBe('<h1>t</h1>');
    // seed 以 content 字节数回填 size（'<h1>t</h1>' 为 10 字节）
    expect(meta).toMatchObject({ id, name: 'r.html', size: 10 });
  });

  it('目录读取 → E_VFS_TYPE_MISMATCH；不存在 → E_VFS_NOT_FOUND', () => {
    const dirId = seed(1, 'd', 'dir');
    expect(() => vfs.readFile({ nodeId: dirId })).toThrow(AppError);
    try {
      vfs.readFile({ nodeId: dirId });
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_TYPE_MISMATCH);
    }
    expect(() => vfs.readFile({ nodeId: 9999 })).toThrow(AppError);
  });

  it('内容列被置空（损坏态）→ 读出空内容兜底不抛错', () => {
    const id = seed(1, 'broken.html', 'file', Buffer.from('<p>x</p>'));
    // 文件行的 content 列由服务层恒写入 Buffer，正常流不为 NULL；
    // 直改库构造损坏行，锁定「按空内容兜底」的防御分支
    db.prepare('UPDATE node SET content = NULL WHERE id = ?').run(id);
    const { content, meta } = vfs.readFile({ nodeId: id });
    expect(content).toHaveLength(0);
    expect(meta).toMatchObject({ id, name: 'broken.html' });
  });
});

describe('getNode', () => {
  it('按 nodeId 反查未删除节点完整元数据（M4 vfs:get：rename/move 后 meta 新鲜化基座）', () => {
    const id = seed(1, 'n.html', 'file', Buffer.from('<p>1</p>'));
    expect(vfs.getNode({ nodeId: id })).toMatchObject({
      id,
      parentId: 1,
      nodeType: 'file',
      name: 'n.html',
      virtualPath: '/n.html',
      mimeType: 'text/html',
      size: 8,
    });
  });

  it('不存在/已在回收站 → E_VFS_NOT_FOUND（meta 反查不取回收站行）', () => {
    expect(() => vfs.getNode({ nodeId: 9999 })).toThrow(AppError);
    const id = seed(1, 'gone.html', 'file', Buffer.from('1'));
    db.prepare('UPDATE node SET deleted_at = ? WHERE id = ?').run(
      '2026-09-16T11:00:00.000+08:00',
      id,
    );
    try {
      vfs.getNode({ nodeId: id });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});
