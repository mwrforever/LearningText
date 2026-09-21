// 导出服务单元测试（M5 批次⑥ Task 13，FR-IO-02）：注入 fs 抽象（内存记录桩，零真实磁盘 IO）
// + 真实 :memory: SQLite（迁移后经 vfsService 播种）。断言：子树收集与磁盘写序（父目录先建）、
// html 改写门控（仅 text/html 改写，越界 # 占位）、非法名防御跳过计数、单节点失败不拖垮整单
// （中途入回收站读取失败 / 写盘 IO 错误）、进度回调序列（collecting 先行、writing 随批推进、
// exportId 单调）、错误路径（根节点 / 已删除 / 目标预检不可写零写盘）。
// 真实磁盘行为由 tests/integration/io/export-service.test.ts 覆盖。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createExportService, type ExportFs } from '../../../src/main/io/exportService';
import { createVfsService, type VfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import { E_IO_TARGET_UNWRITABLE, E_VFS_NOT_FOUND } from '../../../src/shared/errors';
import type { ExportProgress } from '../../../src/shared/io-contract';

// —— fs 抽象的内存记录桩：维护已建目录集合，文件写入强校验父目录在场（父目录先建序
// 的严格断言面，模拟真实 ENOENT），支持按文件注入写盘失败 ——
interface FakeFsOptions {
  readonly probeError?: Error;
  /** 按文件注入写盘失败（返回 Error 或任意抛出值，后者覆盖异常兜底分支） */
  readonly writeFileError?: (file: string) => unknown;
}

interface ExportFsSpy extends ExportFs {
  readonly mkdirCalls: readonly string[];
  readonly probeCalls: readonly string[];
  readonly writeCalls: readonly { readonly file: string; readonly content: Buffer }[];
}

function makeFakeFs(targetDir: string, options: FakeFsOptions = {}): ExportFsSpy {
  const dirs = new Set<string>([targetDir]); // 目标目录由目录选择对话框保证存在
  const mkdirCalls: string[] = [];
  const probeCalls: string[] = [];
  const writeCalls: { file: string; content: Buffer }[] = [];
  return {
    mkdirCalls,
    probeCalls,
    writeCalls,
    async mkdir(dir: string): Promise<void> {
      dirs.add(dir);
      mkdirCalls.push(dir);
    },
    async writeFile(file: string, content: Buffer): Promise<void> {
      const injected = options.writeFileError?.(file);
      if (injected !== undefined) throw injected; // 父目录未创建 → 模拟真实 ENOENT（跳过的目录其子项连带失败的行为面）
      if (!dirs.has(path.dirname(file))) {
        throw new Error(`ENOENT：父目录不存在 ${path.dirname(file)}`);
      }
      writeCalls.push({ file, content });
    },
    async probeWrite(dir: string): Promise<void> {
      if (options.probeError !== undefined) throw options.probeError;
      probeCalls.push(dir);
    },
  };
}

// —— 断言辅助 ——

let db: Database.Database;
let vfs: VfsService;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
});

const TARGET = path.join('D:', 'export-target');

function makeService(
  fs: ExportFs,
  progress: ExportProgress[],
): ReturnType<typeof createExportService> {
  return createExportService({ db, vfs, fs, onProgress: (p) => progress.push(p) });
}

/** 直接 SQL 插入绕过节点名校验的行（构造「库内存在磁盘非法名」的防御面用例），返回新行 id */
function insertRawNode(
  parentId: number,
  name: string,
  virtualPath: string,
  isDir: boolean,
): number {
  const info = db
    .prepare(
      `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, '2026-09-21T00:00:00.000+08:00', '2026-09-21T00:00:00.000+08:00')`,
    )
    .run(parentId, isDir ? 'dir' : 'file', name, virtualPath, null);
  return Number(info.lastInsertRowid);
}

describe('exportService 注入 fs 抽象（单元）', () => {
  it('子树写盘：目标预检先行、目录父先于子创建、文件内容逐字节一致、计数全量', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    const web = vfs.createNode({ parentId: notes.id, name: 'web', nodeType: 'dir' });
    vfs.createNode({
      parentId: web.id,
      name: 'index.html',
      nodeType: 'file',
      content: new TextEncoder().encode('<p>无引用</p>'),
    });
    const assets = vfs.createNode({ parentId: notes.id, name: 'assets', nodeType: 'dir' });
    vfs.createNode({
      parentId: assets.id,
      name: 'a.css',
      nodeType: 'file',
      content: new TextEncoder().encode('body{}'),
    });
    vfs.createNode({
      parentId: notes.id,
      name: 'pic.png',
      nodeType: 'file',
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    const fs = makeFakeFs(TARGET);
    const progress: ExportProgress[] = [];
    const service = makeService(fs, progress);

    const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

    expect(result).toEqual({ exported: 6, rewritten: 0, missing: 0, skipped: 0, failed: 0 });
    // 预检探针写在目标目录上，先于一切建目录动作
    expect(fs.probeCalls).toEqual([TARGET]);
    // 目录创建序 = CTE 父先于子（真实 fs 非递归 mkdir 依赖该序）
    expect(fs.mkdirCalls).toEqual([
      path.join(TARGET, 'notes'),
      path.join(TARGET, 'notes', 'web'),
      path.join(TARGET, 'notes', 'assets'),
    ]);
    const written = new Map(fs.writeCalls.map((w) => [w.file, w.content]));
    expect(written.get(path.join(TARGET, 'notes', 'web', 'index.html'))?.toString('utf8')).toBe(
      '<p>无引用</p>',
    );
    expect(written.get(path.join(TARGET, 'notes', 'assets', 'a.css'))?.toString('utf8')).toBe(
      'body{}',
    );
    expect([...(written.get(path.join(TARGET, 'notes', 'pic.png')) ?? [])]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it('html 改写门控：text/html 读出改写（越界 # 占位计入 missing），text/css 内 vfs:// 串原样写盘', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    const web = vfs.createNode({ parentId: notes.id, name: 'web', nodeType: 'dir' });
    vfs.createNode({
      parentId: web.id,
      name: 'index.html',
      nodeType: 'file',
      content: new TextEncoder().encode(
        '<link href="vfs://local/notes/a.css"><a href="vfs://local/outside/x.html">外</a>',
      ),
    });
    vfs.createNode({
      parentId: notes.id,
      name: 'a.css',
      nodeType: 'file',
      content: new TextEncoder().encode('/* vfs://local/notes/keep.png */'),
    });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

    // html 内 1 处改写（/notes/web/ → 同级 a.css 退一级）+ 1 处越界占位；css 非 html 由调用方门控不改写
    expect(result).toEqual({ exported: 4, rewritten: 1, missing: 1, skipped: 0, failed: 0 });
    const written = new Map(fs.writeCalls.map((w) => [w.file, w.content]));
    expect(written.get(path.join(TARGET, 'notes', 'web', 'index.html'))?.toString('utf8')).toBe(
      '<link href="../a.css"><a href="#">外</a>',
    );
    expect(written.get(path.join(TARGET, 'notes', 'a.css'))?.toString('utf8')).toBe(
      '/* vfs://local/notes/keep.png */',
    );
  });

  it('非法名防御：SQL 直插磁盘非法名文件计 skipped 不写盘；非法名目录连带子项失败', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    insertRawNode(notes.id, 'a<b.txt', '/notes/a<b.txt', false);
    const badDir = insertRawNode(notes.id, 'bad<dir', '/notes/bad<dir', true);
    insertRawNode(badDir, 'inner.txt', '/notes/bad<dir/inner.txt', false);
    vfs.createNode({
      parentId: notes.id,
      name: 'ok.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('ok'),
    });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

    expect(result).toEqual({ exported: 2, rewritten: 0, missing: 0, skipped: 2, failed: 1 });
    const files = fs.writeCalls.map((w) => w.file);
    expect(files).toContain(path.join(TARGET, 'notes', 'ok.txt'));
    expect(files).not.toContain(path.join(TARGET, 'notes', 'a<b.txt'));
    expect(files).not.toContain(path.join(TARGET, 'notes', 'bad<dir', 'inner.txt'));
  });

  it('单节点失败不拖垮整单：子树内节点中途入回收站（读取拒判）与写盘 IO 错误各计 failed', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    const trashed = vfs.createNode({
      parentId: notes.id,
      name: 'gone.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    vfs.trashNode({ nodeId: trashed.id }); // CTE 圈定整树（无删除态过滤），读取路径按未删除拒判
    vfs.createNode({
      parentId: notes.id,
      name: 'io-fail.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('y'),
    });
    vfs.createNode({
      parentId: notes.id,
      name: 'ok.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('z'),
    });
    const fs = makeFakeFs(TARGET, {
      writeFileError: (file) =>
        file.endsWith('io-fail.txt') ? new Error('EACCES：模拟写盘拒绝') : undefined,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const service = makeService(fs, []);
      const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

      // notes 目录 + ok.txt 写出；gone.txt 读取拒判、io-fail.txt 写盘失败
      expect(result).toEqual({ exported: 2, rewritten: 0, missing: 0, skipped: 0, failed: 2 });
      expect(fs.writeCalls.map((w) => w.file)).toContain(path.join(TARGET, 'notes', 'ok.txt'));
      // 失败明细归集单条 error 上报（全局 §二：禁循环内逐节点日志）
      expect(errorSpy.mock.calls[0]?.[0]).toContain('共 2：');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('非 Error 抛出值计入 failed 且明细保留原始归因（异常兜底分支）', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    vfs.createNode({
      parentId: notes.id,
      name: 'raw.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    const fs = makeFakeFs(TARGET, {
      writeFileError: (file) => (file.endsWith('raw.txt') ? '字符串异常' : undefined),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const service = makeService(fs, []);
      const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

      expect(result).toEqual({ exported: 1, rewritten: 0, missing: 0, skipped: 0, failed: 1 });
      expect(errorSpy.mock.calls[0]?.[0]).toContain('raw.txt（字符串异常）');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('条目恰为 200 整批：批边界广播收口后不再发末批广播（整除分支）', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    for (let i = 1; i <= 199; i += 1) {
      vfs.createNode({
        parentId: notes.id,
        name: `f${String(i).padStart(3, '0')}.txt`,
        nodeType: 'file',
        content: new TextEncoder().encode(`c${String(i)}`),
      });
    }
    const progress: ExportProgress[] = [];
    const service = makeService(makeFakeFs(TARGET), progress);

    const result = await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });

    // 200 条目恰在批边界收口（notes 目录 + 199 文件），无额外末批广播
    expect(result).toEqual({ exported: 200, rewritten: 0, missing: 0, skipped: 0, failed: 0 });
    expect(progress.filter((p) => p.phase === 'writing')).toHaveLength(1);
    expect(progress.at(-1)).toMatchObject({ done: 200, total: 200 });
  });

  it('move 过的子树（子行 rowid 先于父行）：结构深度排序保父目录先建，导出结构完整', async () => {
    // 构造评审实验形态：a(id=2) 及其子先于 b(id=4) 创建，move 后结构为 b/a/inner——
    // CTE IN 扫描实测按 id 升序（创建序）输出 [a, inner, b]，导出根 b 排末位，
    // 「行序父先于子」假设被证伪：非递归 mkdir 依赖结构深度序而非 CTE 行序
    const a = vfs.createNode({ parentId: 1, name: 'a', nodeType: 'dir' });
    vfs.createNode({
      parentId: a.id,
      name: 'inner.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    const b = vfs.createNode({ parentId: 1, name: 'b', nodeType: 'dir' });
    vfs.moveNode({ nodeId: a.id, targetDirId: b.id });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    const result = await service.exportNodes({ nodeId: b.id, targetDir: TARGET });

    // 修复前：mkdir(target/b/a) 先于 mkdir(target/b) 触发 ENOENT → 只落空壳 b（exported=1/failed=2）
    expect(result).toEqual({ exported: 3, rewritten: 0, missing: 0, skipped: 0, failed: 0 });
    expect(fs.mkdirCalls).toEqual([path.join(TARGET, 'b'), path.join(TARGET, 'b', 'a')]);
    expect(fs.writeCalls.map((w) => w.file)).toContain(path.join(TARGET, 'b', 'a', 'inner.txt'));
  });

  it('进度回调序列：collecting 先行（total=计划数）、writing 随 200 节点批推进、exportId 单调', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    for (let i = 1; i <= 250; i += 1) {
      vfs.createNode({
        parentId: notes.id,
        name: `f${String(i).padStart(3, '0')}.txt`,
        nodeType: 'file',
        content: new TextEncoder().encode(`c${String(i)}`),
      });
    }
    const progress: ExportProgress[] = [];
    const service = makeService(makeFakeFs(TARGET), progress);

    await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });
    expect(progress[0]).toMatchObject({
      exportId: 1,
      phase: 'collecting',
      done: 0,
      total: 251,
      currentPath: '/notes',
    });
    // 批间让出事件循环（写盘非事务，批次粒度与导入对称）；251 条目切 [200, 251] 两批
    const writing = progress.filter((p) => p.phase === 'writing');
    expect(writing.map((p) => p.done)).toEqual([200, 251]);
    expect(writing[0]?.total).toBe(251);
    expect(writing[0]?.currentPath).toContain('.txt');

    // 同一服务实例第二单 exportId 单调递增
    const before = progress.length;
    await service.exportNodes({ nodeId: notes.id, targetDir: TARGET });
    expect(progress.slice(before).every((p) => p.exportId === 2)).toBe(true);
  });

  it('目标预检不可写 → E_IO_TARGET_UNWRITABLE 整单失败且零建目录零写盘（含 error 日志）', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    vfs.createNode({
      parentId: notes.id,
      name: 'a.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    const fs = makeFakeFs(TARGET, { probeError: new Error('EACCES：模拟目标只读') });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const service = makeService(fs, []);
      await expect(
        service.exportNodes({ nodeId: notes.id, targetDir: TARGET }),
      ).rejects.toMatchObject({ code: E_IO_TARGET_UNWRITABLE } satisfies Partial<AppError>);
      expect(fs.mkdirCalls).toHaveLength(0);
      expect(fs.writeCalls).toHaveLength(0);
      // error 日志含业务错误码与业务标识（全局 §二）；第二个实参为原始异常随行
      expect(errorSpy.mock.calls[0]?.[0]).toContain(E_IO_TARGET_UNWRITABLE);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('导出目标非法：根节点 / 节点不存在 / 已在回收站 均 E_VFS_NOT_FOUND 且零写盘副作用', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    vfs.trashNode({ nodeId: notes.id });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    await expect(service.exportNodes({ nodeId: 1, targetDir: TARGET })).rejects.toMatchObject({
      code: E_VFS_NOT_FOUND,
    });
    await expect(service.exportNodes({ nodeId: 999, targetDir: TARGET })).rejects.toMatchObject({
      code: E_VFS_NOT_FOUND,
    });
    await expect(
      service.exportNodes({ nodeId: notes.id, targetDir: TARGET }),
    ).rejects.toMatchObject({ code: E_VFS_NOT_FOUND });
    // 失败路径零副作用：不预检、不建目录、不写文件
    expect(fs.probeCalls).toHaveLength(0);
    expect(fs.mkdirCalls).toHaveLength(0);
    expect(fs.writeCalls).toHaveLength(0);
  });

  it('文件型根导出：单文件直接落目标目录，自引用改写为本名、越界引用 # 占位', async () => {
    vfs.createNode({
      parentId: 1,
      name: 'single.html',
      nodeType: 'file',
      content: new TextEncoder().encode(
        '<a href="vfs://local/single.html">自身</a><img src="vfs://local/missing.png">',
      ),
    });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    const result = await service.exportNodes({
      nodeId: vfs.resolvePath({ virtualPath: '/single.html' }).nodeId,
      targetDir: TARGET,
    });

    expect(result).toEqual({ exported: 1, rewritten: 1, missing: 1, skipped: 0, failed: 0 });
    expect(fs.mkdirCalls).toHaveLength(0); // 文件型根无目录条目
    expect(fs.writeCalls).toHaveLength(1);
    expect(fs.writeCalls[0]?.file).toBe(path.join(TARGET, 'single.html'));
    expect(fs.writeCalls[0]?.content.toString('utf8')).toBe(
      '<a href="single.html">自身</a><img src="#">',
    );
  });

  it('嵌套根导出：容器为父目录（非顶层），相对引用按容器正确回退、层级落盘一致', async () => {
    const notes = vfs.createNode({ parentId: 1, name: 'notes', nodeType: 'dir' });
    const web = vfs.createNode({ parentId: notes.id, name: 'web', nodeType: 'dir' });
    vfs.createNode({
      parentId: web.id,
      name: 'index.html',
      nodeType: 'file',
      content: new TextEncoder().encode('<link href="vfs://local/notes/web/a.css">'),
    });
    vfs.createNode({
      parentId: web.id,
      name: 'a.css',
      nodeType: 'file',
      content: new TextEncoder().encode('p{}'),
    });
    const fs = makeFakeFs(TARGET);
    const service = makeService(fs, []);

    const result = await service.exportNodes({ nodeId: web.id, targetDir: TARGET });

    // 容器 = /notes（web 的父）：容器相对路径以 notes 为基，写出 web/a.css 层级
    expect(result).toEqual({ exported: 3, rewritten: 1, missing: 0, skipped: 0, failed: 0 });
    expect(fs.mkdirCalls).toEqual([path.join(TARGET, 'web')]);
    const written = new Map(fs.writeCalls.map((w) => [w.file, w.content]));
    expect(written.get(path.join(TARGET, 'web', 'index.html'))?.toString('utf8')).toBe(
      '<link href="a.css">',
    );
    expect(written.get(path.join(TARGET, 'web', 'a.css'))?.toString('utf8')).toBe('p{}');
  });
});
