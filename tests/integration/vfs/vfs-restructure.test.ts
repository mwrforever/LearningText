// 重构类操作（FR-VFS-04/05）：级联路径、环检测、重名拒绝、FTS 不受路径级联影响
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import {
  E_VFS_DUPLICATE_NAME,
  E_VFS_INVALID_MOVE,
  E_VFS_INVALID_NAME,
  E_VFS_NOT_FOUND,
} from '../../../src/shared/errors';

let db: Database.Database;
let vfs: ReturnType<typeof createVfsService>;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
});

/** 场景树：/web/{index.html, css/{main.css}} 与 /docs */
function seedTree(): {
  webId: number;
  indexId: number;
  cssId: number;
  mainId: number;
  docsId: number;
} {
  const webId = vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' }).id;
  const indexId = vfs.createNode({
    parentId: webId,
    name: 'index.html',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from('<p>i</p>')),
  }).id;
  const cssId = vfs.createNode({ parentId: webId, name: 'css', nodeType: 'dir' }).id;
  const mainId = vfs.createNode({
    parentId: cssId,
    name: 'main.css',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from('body{}')),
  }).id;
  const docsId = vfs.createNode({ parentId: 1, name: 'docs', nodeType: 'dir' }).id;
  return { webId, indexId, cssId, mainId, docsId };
}

const pathOf = (id: number): string =>
  db.prepare<number, { p: string }>('SELECT virtual_path AS p FROM node WHERE id = ?').get(id)?.p ??
  '';

describe('renameNode', () => {
  it('重命名目录：自身与子树路径级联、affectedCount 正确、FTS 列联动 name', () => {
    const { webId, indexId, mainId } = seedTree();
    const result = vfs.renameNode({ nodeId: webId, newName: 'site' });
    expect(result.affectedCount).toBe(4); // web + index + css + main
    expect(pathOf(webId)).toBe('/site');
    expect(pathOf(indexId)).toBe('/site/index.html');
    expect(pathOf(mainId)).toBe('/site/css/main.css');
    const ftsName = (id: number): string =>
      db.prepare<number, { name: string }>('SELECT name FROM node_fts WHERE rowid = ?').get(id)
        ?.name ?? '';
    expect(ftsName(webId)).toBe('site');
    expect(ftsName(indexId)).toBe('index.html'); // 子树节点 name 不变，FTS 不动 body
  });

  it('重命名文件：仅本级，路径更新', () => {
    const { indexId } = seedTree();
    vfs.renameNode({ nodeId: indexId, newName: 'home.html' });
    expect(pathOf(indexId)).toBe('/web/home.html');
  });

  it('重命名同名短路为无操作：affectedCount 为 0 且不误报重名', () => {
    const { indexId } = seedTree();
    // 无短路时重名预查会命中自身而误抛 E_VFS_DUPLICATE_NAME，此处同时验证不抛错
    const result = vfs.renameNode({ nodeId: indexId, newName: 'index.html' });
    expect(result.affectedCount).toBe(0);
    expect(pathOf(indexId)).toBe('/web/index.html');
  });

  it('重名拒绝（目录名与文件名互撞）与非法名称、根不可改', () => {
    const { webId } = seedTree();
    expect(() => vfs.renameNode({ nodeId: webId, newName: 'docs' })).toThrow(AppError);
    try {
      vfs.renameNode({ nodeId: webId, newName: 'docs' });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
    try {
      vfs.renameNode({ nodeId: webId, newName: 'a/b' });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_INVALID_NAME);
    }
    try {
      // 根节点为迁移种子固定 id=1（seedTree 的 docsId 是普通目录 /docs，不可混用作根）
      vfs.renameNode({ nodeId: 1, newName: 'x' });
      expect.unreachable('根不可改');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});

describe('moveNode', () => {
  it('移动目录到目标目录：子树整体迁移', () => {
    const { webId, indexId, mainId, docsId } = seedTree();
    const result = vfs.moveNode({ nodeId: webId, targetDirId: docsId });
    expect(result.affectedCount).toBe(4);
    expect(pathOf(webId)).toBe('/docs/web');
    expect(pathOf(mainId)).toBe('/docs/web/css/main.css');
    expect(pathOf(indexId)).toBe('/docs/web/index.html');
  });

  it('移入自身/自身后代 → E_VFS_INVALID_MOVE（含移到自身）', () => {
    const { webId, cssId } = seedTree();
    try {
      vfs.moveNode({ nodeId: webId, targetDirId: cssId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_INVALID_MOVE);
    }
    try {
      vfs.moveNode({ nodeId: webId, targetDirId: webId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_INVALID_MOVE);
    }
  });

  it('目标为文件节点 → E_VFS_INVALID_MOVE', () => {
    const { webId } = seedTree();
    const fileId = vfs.createNode({ parentId: 1, name: 'note.html', nodeType: 'file' }).id;
    try {
      vfs.moveNode({ nodeId: webId, targetDirId: fileId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_INVALID_MOVE);
    }
  });

  it('移动后父指针同步更新为目标目录 id（防仅改路径不改归属的回归）', () => {
    const { webId, docsId } = seedTree();
    vfs.moveNode({ nodeId: webId, targetDirId: docsId });
    // 仅断言 virtual_path 不足以锁定树结构归属：parent_id 必须与级联路径同事务落库
    const parentId = db
      .prepare<number, { parent_id: number }>('SELECT parent_id FROM node WHERE id = ?')
      .get(webId)?.parent_id;
    expect(parentId).toBe(docsId);
  });

  it('目标目录已有同名 → E_VFS_DUPLICATE_NAME；目标不存在 → E_VFS_NOT_FOUND', () => {
    const { webId } = seedTree();
    // 目标目录名不可与场景树既有顶级目录（web/docs）重名，否则建目录阶段即被重名拒绝
    const archiveId = vfs.createNode({ parentId: 1, name: 'archive', nodeType: 'dir' }).id;
    vfs.createNode({ parentId: archiveId, name: 'web', nodeType: 'dir' });
    try {
      vfs.moveNode({ nodeId: webId, targetDirId: archiveId });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_DUPLICATE_NAME);
    }
    expect(() => vfs.moveNode({ nodeId: webId, targetDirId: 9999 })).toThrow(AppError);
  });
});

describe('同路径回收站孪生树隔离', () => {
  // 孪生场景：trash /web 后 partial unique 允许同路径重建；级联谓词按删除状态锚定，
  // 活树 rename/move 不得改写回收站孪生行的 virtual_path（其为还原定位的唯一凭据）
  it('rename/move 活子树时级联只作用于活树：孪生行路径保持原样、计数不被污染', () => {
    const { webId, indexId, mainId, docsId } = seedTree();
    vfs.trashNode({ nodeId: webId });
    const newWebId = vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' }).id;
    const renamed = vfs.renameNode({ nodeId: newWebId, newName: 'site' });
    expect(renamed.affectedCount).toBe(1); // 只计活树自身，孪生行不污染计数
    expect(pathOf(indexId)).toBe('/web/index.html');
    expect(pathOf(mainId)).toBe('/web/css/main.css');
    expect(pathOf(webId)).toBe('/web');
    // 再建 /web 并移动到 /docs：move 级联同样不得触碰孪生行
    const web2Id = vfs.createNode({ parentId: 1, name: 'web', nodeType: 'dir' }).id;
    const moved = vfs.moveNode({ nodeId: web2Id, targetDirId: docsId });
    expect(moved.affectedCount).toBe(1);
    expect(pathOf(indexId)).toBe('/web/index.html');
  });
});
