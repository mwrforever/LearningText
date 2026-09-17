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
  it('整棵子树还原：deleted_at 清空、FTS 行重建、路径不变', async () => {
    const { webId, indexId } = seedScenario();
    // trash 前 updated_at 快照（M2 spec §3.3 新鲜度基线）：时间戳为毫秒精度，内存库下
    // 创建/回收/还原可能落入同一毫秒，先记录再隔开时刻，「≠ 快照」断言才确定有区分力
    const updatedAtBeforeTrash = db
      .prepare<number, { updated_at: string }>('SELECT updated_at FROM node WHERE id = ?')
      .get(webId)?.updated_at;
    vfs.trashNode({ nodeId: webId });
    await new Promise((r) => setTimeout(r, 2)); // 保证还原时刻晚于创建/回收时刻（毫秒精度时间戳）
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
    // M2 spec §3.3：还原返回与广播携带还原时刻的 updatedAt（非回收站期旧值）
    const stored = db
      .prepare<number, { updated_at: string }>('SELECT updated_at FROM node WHERE id = ?')
      .get(webId);
    expect(restored.updatedAt).toBe(stored?.updated_at);
    expect(restored.updatedAt).not.toBe(updatedAtBeforeTrash); // ≠ trash 前记录的 updated_at
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

  it('回收站行父指针被置空（不变式破缺）→ 跳过父链校验整树还原', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    // partial unique 仅约束未删除行，软删行可被置空父指针，构造「在回收站但无父」的破缺行，
    // 锁定 restoreNode 跳过父链校验的防御路径（还原锚定仍按路径，子树完整性不受影响）
    db.prepare('UPDATE node SET parent_id = NULL WHERE id = ?').run(webId);
    const restored = vfs.restoreNode({ nodeId: webId });
    expect(restored.virtualPath).toBe('/web');
    expect(
      db
        .prepare<number, { deleted_at: string | null }>('SELECT deleted_at FROM node WHERE id = ?')
        .get(indexId)?.deleted_at,
    ).toBeNull();
  });

  it('还原时文本行内容列被置空（损坏态）→ FTS body 兜底空串不抛错', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    db.prepare('UPDATE node SET content = NULL WHERE id = ?').run(indexId);
    vfs.restoreNode({ nodeId: webId });
    // 重建 FTS 时内容缺失按空串兜底，不得让还原事务失败
    expect(
      db.prepare<number, { body: string }>('SELECT body FROM node_fts WHERE rowid = ?').get(indexId)
        ?.body,
    ).toBe('');
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

  it('purge 回收站旧树不误伤同路径存活树：仅旧树物理消失（孪生互斥）', () => {
    const { webId, indexId } = seedScenario();
    vfs.trashNode({ nodeId: webId });
    // partial unique 让名后同路径重建存活树（带内容文件），与回收站旧树构成同路径孪生
    const newWebId = vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' }).id;
    const newIndexId = vfs.createNode({
      parentId: newWebId,
      name: 'index.html',
      nodeType: 'file',
      content: new Uint8Array(Buffer.from('<p>new</p>')),
    }).id;
    const result = vfs.purgeNode({ nodeId: webId });
    // 计数只含回收站旧树（web + index），不得计入同路径存活树
    expect(result.affectedCount).toBe(2);
    expect(
      db
        .prepare<[number, number], { c: number }>(
          'SELECT COUNT(*) AS c FROM node WHERE id IN (?, ?)',
        )
        .get(webId, indexId)?.c,
    ).toBe(0);
    // 存活孪生树完好：可解析且 FTS 行在
    expect(vfs.resolvePath({ virtualPath: '/web' }).nodeId).toBe(newWebId);
    expect(vfs.resolvePath({ virtualPath: '/web/index.html' }).nodeId).toBe(newIndexId);
    expect(ftsCount(newWebId)).toBe(1);
    expect(ftsCount(newIndexId)).toBe(1);
  });

  it('双回收站树独立清除：同路径两棵回收站树 purge 一棵不沾染另一棵（M2 spec §3.2 根治）', () => {
    const { webId } = seedScenario(); // /web（含子节点 index.html，共 2 行）
    vfs.trashNode({ nodeId: webId });
    // 同路径重建再删：出现第二棵 /web 回收站树（M1 路径谓词下 purge 旧树会连带两棵）
    vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' });
    const second = vfs.resolvePath({ virtualPath: '/web' });
    vfs.createNode({
      parentId: second.nodeId,
      name: 'inner.html',
      nodeType: 'file',
      content: new Uint8Array(Buffer.from('<i>')),
    });
    vfs.trashNode({ nodeId: second.nodeId });
    // 两棵均不可解析
    expect(() => vfs.resolvePath({ virtualPath: '/web' })).toThrow(AppError);
    // 彻底删除第一棵（webId 子树 2 行）：计数 2，第二棵（含 inner）不受沾染
    const purged = vfs.purgeNode({ nodeId: webId });
    expect(purged.affectedCount).toBe(2);
    expect(
      db
        .prepare<[], { c: number }>(
          "SELECT COUNT(*) AS c FROM node WHERE name = 'inner.html' AND deleted_at IS NOT NULL",
        )
        .get()?.c,
    ).toBe(1);
    // 第二棵仍可还原且路径正确（身份独立）
    const restored = vfs.restoreNode({ nodeId: second.nodeId });
    expect(restored.virtualPath).toBe('/web');
    expect(vfs.resolvePath({ virtualPath: '/web' }).nodeId).toBe(second.nodeId);
  });

  it('根不可彻底删除', () => {
    try {
      vfs.purgeNode({ nodeId: 1 });
      expect.unreachable('根不可删');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });

  it('彻底删除不存在的节点 → E_VFS_NOT_FOUND', () => {
    try {
      vfs.purgeNode({ nodeId: 9999 });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});
