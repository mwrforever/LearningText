// 导入服务集成测试（M5 批次⑥ Task 12，FR-IO-01）：真实临时源目录 + 真实文件库（WAL），
// 走真实 fs 适配器——源目录树导入后 VFS 结构/内容逐字节一致、skip 策略二次导入全跳过、
// 取消半途已写入节点全部保留且 FTS 一致、rename 策略端到端递增。单元层（fs 桩）行为
// 分支覆盖见 tests/unit/main/import-service.test.ts。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createImportService, nodeFs } from '../../../src/main/io/importService';
import type { ImportProgress } from '../../../src/shared/io-contract';

let root: string;
let sourceDir: string;
let db: Database.Database;
let progress: ImportProgress[];

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lt-import-itest-'));
  sourceDir = path.join(root, 'source');
  mkdirSync(sourceDir, { recursive: true });
  db = openDatabase({ file: path.join(root, 'learningtext.db') });
  runMigrations(db);
  progress = [];
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function makeService(): ReturnType<typeof createImportService> {
  return createImportService({ db, fs: nodeFs, onProgress: (p) => progress.push(p) });
}

function rowByPath(virtualPath: string):
  | {
      id: number;
      parent_id: number | null;
      node_type: 'dir' | 'file';
      mime_type: string | null;
      size: number;
      content: Buffer | null;
    }
  | undefined {
  return db
    .prepare<
      string,
      {
        id: number;
        parent_id: number | null;
        node_type: 'dir' | 'file';
        mime_type: string | null;
        size: number;
        content: Buffer | null;
      }
    >(
      `SELECT id, parent_id, node_type, mime_type, size, content
       FROM node WHERE virtual_path = ? AND deleted_at IS NULL`,
    )
    .get(virtualPath);
}

function liveRowCount(): number {
  const raw = db.prepare('SELECT COUNT(*) AS n FROM node WHERE deleted_at IS NULL').get() as {
    n: number;
  };
  return raw.n - 1; // 根种子恒占 1 行
}

describe('导入服务集成（真实临时目录）', () => {
  it('源目录树导入后 VFS 结构与内容逐字节一致（层级/html/二进制图片/FTS 行齐全）', async () => {
    // 源树：a.txt + sub/{b.html, deep/c.md} + pic.png（二进制）
    writeFileSync(path.join(sourceDir, 'a.txt'), 'hello', 'utf8');
    mkdirSync(path.join(sourceDir, 'sub', 'deep'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'sub', 'b.html'), '<p>hi</p>', 'utf8');
    writeFileSync(path.join(sourceDir, 'sub', 'deep', 'c.md'), '# 标题', 'utf8');
    writeFileSync(path.join(sourceDir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await makeService().importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'skip',
    });

    expect(result).toMatchObject({ imported: 6, skipped: 0, failed: 0 });
    const a = rowByPath('/a.txt');
    expect(a).toMatchObject({ parent_id: 1, node_type: 'file', mime_type: 'text/plain', size: 5 });
    expect(a?.content?.toString('utf8')).toBe('hello');
    const sub = rowByPath('/sub');
    expect(sub).toMatchObject({ node_type: 'dir', mime_type: null });
    const b = rowByPath('/sub/b.html');
    expect(b?.parent_id).toBe(sub?.id);
    expect(b?.content?.toString('utf8')).toBe('<p>hi</p>');
    const deep = rowByPath('/sub/deep');
    const c = rowByPath('/sub/deep/c.md');
    expect(c?.parent_id).toBe(deep?.id);
    expect(c?.content?.toString('utf8')).toBe('# 标题');
    const png = rowByPath('/pic.png');
    expect(png?.mime_type).toBe('image/png');
    expect([...(png?.content ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // FTS 契约（宪法 A.4-10）：每业务节点一行索引
    expect((db.prepare('SELECT COUNT(*) AS n FROM node_fts').get() as { n: number }).n).toBe(6);
  });

  it('skip 策略二次导入：全部条目跳过（目录合并在内），库零变化', async () => {
    writeFileSync(path.join(sourceDir, 'a.txt'), 'hello', 'utf8');
    mkdirSync(path.join(sourceDir, 'sub'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'sub', 'b.html'), '<p>hi</p>', 'utf8');
    const service = makeService();

    const first = await service.importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'skip',
    });
    expect(first).toMatchObject({ imported: 3, skipped: 0, failed: 0 });

    const second = await service.importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'skip',
    });
    expect(second).toMatchObject({ imported: 0, skipped: 3, failed: 0 });
    expect(liveRowCount()).toBe(3);
    expect((db.prepare('SELECT COUNT(*) AS n FROM node_fts').get() as { n: number }).n).toBe(3);
  });

  it('取消半途：当前批已写入节点全部保留（结构/FTS 完整），未开工节点零写入', async () => {
    // 250 个小文件 → 首批 200 节点提交后经 writing 进度触发取消
    for (let i = 1; i <= 250; i += 1) {
      writeFileSync(
        path.join(sourceDir, `f${String(i).padStart(3, '0')}.txt`),
        `内容-${i}`,
        'utf8',
      );
    }
    const service = createImportService({
      db,
      fs: nodeFs,
      onProgress: (p) => {
        progress.push(p);
        if (p.phase === 'writing' && p.done >= 200) service.cancel(p.importId);
      },
    });

    const result = await service.importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'skip',
    });

    expect(result).toMatchObject({ imported: 200, skipped: 0, failed: 0 });
    expect(liveRowCount()).toBe(200);
    // 已写入子树结构完整：每个活节点都有 FTS 行（无半写状态）
    expect((db.prepare('SELECT COUNT(*) AS n FROM node_fts').get() as { n: number }).n).toBe(200);
  });

  it('rename 策略端到端：二次导入同名递增 a (2).txt，内容为二次源文件', async () => {
    writeFileSync(path.join(sourceDir, 'a.txt'), 'v1', 'utf8');
    const service = makeService();
    await service.importNodes({ sourcePaths: [sourceDir], targetParentId: 1, conflict: 'skip' });

    writeFileSync(path.join(sourceDir, 'a.txt'), 'v2', 'utf8');
    const result = await service.importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'rename',
    });

    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(rowByPath('/a.txt')?.content?.toString('utf8')).toBe('v1');
    expect(rowByPath('/a (2).txt')?.content?.toString('utf8')).toBe('v2');
  });

  it('progress 广播覆盖扫描与写入两阶段（多批推进 done 单调到总数）', async () => {
    for (let i = 1; i <= 250; i += 1) {
      writeFileSync(
        path.join(sourceDir, `f${String(i).padStart(3, '0')}.txt`),
        `内容-${i}`,
        'utf8',
      );
    }
    await makeService().importNodes({
      sourcePaths: [sourceDir],
      targetParentId: 1,
      conflict: 'skip',
    });

    expect(progress[0]?.phase).toBe('scanning');
    expect(progress[0]?.currentPath).toBe(sourceDir);
    const writing = progress.filter((p) => p.phase === 'writing');
    expect(writing.map((p) => p.done)).toEqual([200, 250]);
    expect(writing.map((p) => p.total)).toEqual([250, 250]);
  });

  // —— 文件源（M7，FR-IO-01 文件形态）：真实磁盘单文件导入链（fixture = 用户实测示例文档）——

  it('文件源导入：HTML 单文件物化为目标父直接子项，内容逐字节一致、importedNodeIds 可寻址', async () => {
    const fixture = path.join(__dirname, '../../fixtures/code.html');
    const service = makeService();

    const result = await service.importNodes({
      sourcePaths: [fixture],
      targetParentId: 1,
      conflict: 'rename',
    });

    expect(result).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    // 「导入后即打开」的寻址依据：importedNodeIds[0] = 新节点 id
    const node = rowByPath('/code.html');
    expect(node).toMatchObject({
      parent_id: 1,
      node_type: 'file',
      mime_type: 'text/html',
      size: 76167,
    });
    expect(node?.id).toBe(result.importedNodeIds[0]);
    expect(node?.content?.length).toBe(76167);
    // HTML 内容入 FTS（文本 MIME body 提取，spec §7.7）
    const ftsRow = db.prepare('SELECT body FROM node_fts WHERE rowid = ?').get(node?.id) as
      { body: string } | undefined;
    expect(ftsRow?.body).toContain('Spring');
  });

  it('文件源 sourceName 端到端：导入即重命名（落名生效、FTS 同步）', async () => {
    const fixture = path.join(__dirname, '../../fixtures/code.html');
    const service = makeService();

    await service.importNodes({
      sourcePaths: [fixture],
      targetParentId: 1,
      conflict: 'rename',
      sourceName: 'Spring 解析.html',
    });

    expect(rowByPath('/Spring 解析.html')).toMatchObject({ mime_type: 'text/html' });
    expect(rowByPath('/code.html')).toBeUndefined();
  });
});
