// 导出服务集成测试（M5 批次⑥ Task 13，FR-IO-02）：真实临时目标目录 + 真实文件库（WAL），
// 走真实 fs 适配器——导出目录结构与 VFS 子树一致、html 内相对引用按路径拼接真实可达
//（fs.existsSync 断言，等价浏览器相对解析）、越界引用落 # 占位、目标不可写（E_IO_TARGET_
// UNWRITABLE）零写入、Windows 非法名（SQL 直插构造）跳过计数、进度广播序列完整。
// 单元层（fs 桩）行为分支覆盖见 tests/unit/main/export-service.test.ts。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createExportService, nodeExportFs } from '../../../src/main/io/exportService';
import { createVfsService, type VfsService } from '../../../src/main/vfs/vfsService';
import { E_IO_TARGET_UNWRITABLE } from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';
import type { ExportProgress } from '../../../src/shared/io-contract';

let root: string;
let targetDir: string;
let db: Database.Database;
let vfs: VfsService;
let progress: ExportProgress[];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lt-export-itest-'));
  targetDir = path.join(root, 'target');
  mkdirSync(targetDir, { recursive: true });
  db = openDatabase({ file: path.join(root, 'learningtext.db') });
  runMigrations(db);
  vfs = createVfsService(db);
  progress = [];
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function makeService(): ReturnType<typeof createExportService> {
  return createExportService({
    db,
    vfs,
    fs: nodeExportFs,
    onProgress: (p) => progress.push(p),
  });
}

/** SQL 直插绕过节点名校验的行（构造库内磁盘非法名，Windows 实测不可创建形态） */
function insertRawNode(parentId: number, name: string, virtualPath: string): void {
  db.prepare(
    `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
     VALUES (?, 'file', ?, ?, 'text/plain', 0, NULL, NULL, '2026-09-21T00:00:00.000+08:00', '2026-09-21T00:00:00.000+08:00')`,
  ).run(parentId, name, virtualPath);
}

describe('导出服务集成（真实临时目录）', () => {
  it('导出目录结构与 VFS 子树一致；html 相对引用按路径拼接真实可达；越界引用落 #', async () => {
    // VFS 树：notes/{web/index.html, assets/a.css, pic.png} + 子树外 outside/x.css
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    const web = vfs.createNode({ parentId: notes.id, name: 'web', nodeType: 'dir' });
    vfs.createNode({
      parentId: web.id,
      name: 'index.html',
      nodeType: 'file',
      content: new TextEncoder().encode(
        '<link rel="stylesheet" href="vfs://local/notes/assets/a.css">' +
          '<img src="vfs://local/notes/pic.png">' +
          '<a href="vfs://local/outside/x.css">越界</a>',
      ),
    });
    const assets = vfs.createNode({ parentId: notes.id, name: 'assets', nodeType: 'dir' });
    vfs.createNode({
      parentId: assets.id,
      name: 'a.css',
      nodeType: 'file',
      content: new TextEncoder().encode('body { color: red; }'),
    });
    vfs.createNode({
      parentId: notes.id,
      name: 'pic.png',
      nodeType: 'file',
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    const outside = vfs.createNode({ parentId: 1, name: 'outside', nodeType: 'dir' });
    vfs.createNode({
      parentId: outside.id,
      name: 'x.css',
      nodeType: 'file',
      content: new TextEncoder().encode('/* 子树外 */'),
    });

    const result = await makeService().exportNodes({ nodeId: notes.id, targetDir });

    expect(result).toEqual({ exported: 6, rewritten: 2, missing: 1, skipped: 0, failed: 0 });

    // 目录结构逐项一致：导出根名在内、层级保持
    expect(existsSync(path.join(targetDir, 'notes'))).toBe(true);
    expect(existsSync(path.join(targetDir, 'notes', 'web'))).toBe(true);
    expect(existsSync(path.join(targetDir, 'notes', 'assets'))).toBe(true);
    // 二进制逐字节一致
    expect(readFileSync(path.join(targetDir, 'notes', 'pic.png'))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    // html 相对引用改写正确（notes 子树内：web/ → assets/ 退一级）
    const exportedHtml = readFileSync(path.join(targetDir, 'notes', 'web', 'index.html'), 'utf8');
    expect(exportedHtml).toContain('href="../assets/a.css"');
    expect(exportedHtml).toContain('src="../pic.png"');
    expect(exportedHtml).toContain('href="#"');
    // 浏览器可达断言（等价语义）：以 index.html 所在目录解析相对引用，路径拼接真实存在
    const htmlDir = path.join(targetDir, 'notes', 'web');
    expect(existsSync(path.resolve(htmlDir, '../assets/a.css'))).toBe(true);
    expect(existsSync(path.resolve(htmlDir, '../pic.png'))).toBe(true);
    // css 内容逐字节一致（非 html 不改写，内含 vfs:// 字样也不动）
    expect(readFileSync(path.join(targetDir, 'notes', 'assets', 'a.css'), 'utf8')).toBe(
      'body { color: red; }',
    );
  });

  it('目标目录不可写（目标为既有文件）→ E_IO_TARGET_UNWRITABLE 且目标处零写入', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    vfs.createNode({
      parentId: notes.id,
      name: 'a.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    const occupied = path.join(root, 'occupied.txt');
    writeFileSync(occupied, '占位', 'utf8');

    await expect(
      makeService().exportNodes({ nodeId: notes.id, targetDir: occupied }),
    ).rejects.toMatchObject({ code: E_IO_TARGET_UNWRITABLE } satisfies Partial<AppError>);
    // 目标处零写入：占位文件内容未被触碰，也未产生探针残留
    expect(readFileSync(occupied, 'utf8')).toBe('占位');
    expect(existsSync(path.join(occupied, '.lt-export-probe'))).toBe(false);
  });

  it('Windows 非法名（SQL 直插）跳过计数且不落盘，合法项照常导出', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    insertRawNode(notes.id, 'aux.txt', '/notes/aux.txt'); // Windows 保留设备名（含扩展名形态）
    insertRawNode(notes.id, 'a<b.txt', '/notes/a<b.txt'); // Windows 非法字符
    vfs.createNode({
      parentId: notes.id,
      name: 'ok.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('ok'),
    });

    const result = await makeService().exportNodes({ nodeId: notes.id, targetDir });

    expect(result).toEqual({ exported: 2, rewritten: 0, missing: 0, skipped: 2, failed: 0 });
    expect(existsSync(path.join(targetDir, 'notes', 'aux.txt'))).toBe(false);
    expect(existsSync(path.join(targetDir, 'notes', 'a<b.txt'))).toBe(false);
    expect(readFileSync(path.join(targetDir, 'notes', 'ok.txt'), 'utf8')).toBe('ok');
  });

  it('进度广播序列完整：collecting 先行、writing 随批推进到全量、exportId 单调', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    vfs.createNode({
      parentId: notes.id,
      name: 'a.html',
      nodeType: 'file',
      content: new TextEncoder().encode('<p>1</p>'),
    });

    await makeService().exportNodes({ nodeId: notes.id, targetDir });

    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[0]).toMatchObject({
      exportId: 1,
      phase: 'collecting',
      total: 2,
      currentPath: '/notes',
    });
    const writing = progress.filter((p) => p.phase === 'writing');
    expect(writing.at(-1)).toMatchObject({ done: 2, total: 2 });
    expect(progress.every((p) => p.exportId === 1)).toBe(true);
  });
});
