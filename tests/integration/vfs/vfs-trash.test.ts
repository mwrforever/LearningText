// 软删除域（FR-VFS-06）：软删让名、还原撞名、父链校验、彻底删除、FTS 不变式
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import { E_VFS_DUPLICATE_NAME, E_VFS_NOT_FOUND } from '../../../src/shared/errors';

let db: Database.Database;
let vfs: ReturnType<typeof createVfsService>;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
});

const ftsCount = (id: number): number =>
  db.prepare<number, { c: number }>('SELECT COUNT(*) AS c FROM node_fts WHERE rowid = ?').get(id)
    ?.c ?? 0;

function seedScenario(): { webId: number; indexId: number } {
  const webId = vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' }).id;
  const indexId = vfs.createNode({
    parentId: webId,
    name: 'index.html',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from('<p>i</p>')),
  }).id;
  return { webId, indexId };
}

describe('trashNode', () => {
  it('软删除子树：deleted_at 全置、FTS 行先删（不变式）、同名单秒级让名', () => {
    const { webId, indexId } = seedScenario();
    const result = vfs.trashNode({ nodeId: webId });
    expect(result.affectedCount).toBe(2);
    const deleted = db
      .prepare<number, { deleted_at: string | null }>('SELECT deleted_at FROM node WHERE id = ?')
      .get(indexId);
    expect(deleted?.deleted_at).not.toBeNull();
    expect(ftsCount(webId)).toBe(0);
    expect(ftsCount(indexId)).toBe(0);
    // partial unique 让名：可新建同名
    expect(() => vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' })).not.toThrow();
  });

  it('根不可删；不存在 → E_VFS_NOT_FOUND', () => {
    try {
      vfs.trashNode({ nodeId: 1 });
      expect.unreachable('根不可删');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
    expect(() => vfs.trashNode({ nodeId: 9999 })).toThrow(AppError);
  });
});

describe('restoreNode', () => {
  it('整棵子树还原：deleted_at 清空、FTS 行重建、路径不变', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    const restored = vfs.restoreNode({ nodeId: webId });
    expect(restored.virtualPath).toBe('/web');
    expect(
      db
        .prepare<number, { deleted_at: string | null }>('SELECT deleted_at FROM node WHERE id = ?')
        .get(indexId)?.deleted_at,
    ).toBeNull();
    expect(ftsCount(webId)).toBe(1);
    expect(ftsCount(indexId)).toBe(1);
    // 还原后可搜（M2 前置正确性）：body 保持原文
    expect(
      db.prepare<number, { body: string }>('SELECT body FROM node_fts WHERE rowid = ?').get(indexId)
        ?.body,
    ).toBe('<p>i</p>');
  });

  it('原位置被占用 → E_VFS_DUPLICATE_NAME（partial unique 约束映射）', () => {
    const { webId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' });
    try {
      vfs.restoreNode({ nodeId: webId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
  });

  it('父目录链仍在回收站 → E_VFS_NOT_FOUND（还原不可达，spec §7.5）', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    try {
      vfs.restoreNode({ nodeId: indexId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });

  it('未删除节点不可还原 → E_VFS_NOT_FOUND', () => {
    const { webId } = seedScenario();
    try {
      vfs.restoreNode({ nodeId: webId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});

describe('purgeNode', () => {
  it('物理移除子树且不再可解析；回收站与未删除节点均可彻底删除', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    const result = vfs.purgeNode({ nodeId: webId });
    expect(result.affectedCount).toBe(2);
    expect(
      db
        .prepare<[number, number], { c: number }>(
          'SELECT COUNT(*) AS c FROM node WHERE id IN (?, ?)',
        )
        .get(webId, indexId)?.c,
    ).toBe(0);
    expect(() => vfs.resolvePath({ virtualPath: '/web' })).toThrow(AppError);
  });

  it('直接彻底删除未删除文件：FTS 行一并清除（FR-VFS-06）', () => {
    // 回收站不变式只覆盖 trash 过的节点；对活节点直删同样必须先清 FTS（宪法 A.4-10），
    // 否则残留孤儿索引行 → M2 搜索出现幽灵命中
    const { indexId } = seedScenario();
    const result = vfs.purgeNode({ nodeId: indexId });
    expect(result.affectedCount).toBe(1);
    expect(ftsCount(indexId)).toBe(0);
    expect(
      db.prepare<number, { c: number }>('SELECT COUNT(*) AS c FROM node WHERE id = ?').get(indexId)
        ?.c,
    ).toBe(0);
  });

  it('根不可彻底删除', () => {
    try {
      vfs.purgeNode({ nodeId: 1 });
      expect.unreachable('根不可删');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});
