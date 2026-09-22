// 导入服务单元测试（M5 批次⑥ Task 12，FR-IO-01）：注入 fs 抽象（内存树桩，零真实磁盘 IO）
// + 真实 :memory: SQLite（迁移后），断言层级映射 parent 链、50MB 跳过计数、重命名/覆盖/跳过
// 三策略、目录合并、取消标志当前批后停、批次 ≤200 节点与 ≤16MB 字节双闸切分、progress 回调
// 序列（scanning 先行、writing 随批且事务提交后发）、异常路径（源缺失/目标非法/读取失败）。
// 真实磁盘行为由 tests/integration/io/import-service.test.ts 覆盖。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createImportService, type ImportFs } from '../../../src/main/io/importService';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { AppError } from '../../../src/shared/result';
import {
  E_IO_SOURCE_NOT_FOUND,
  E_VFS_NOT_FOUND,
  E_VFS_TYPE_MISMATCH,
} from '../../../src/shared/errors';
import { MAX_FILE_BYTES } from '../../../src/shared/vfs-contract';
import type { ImportProgress } from '../../../src/shared/io-contract';

// —— fs 抽象的内存树桩：以 '/' 分段虚拟路径寻址（服务用 path.join 拼接，win32 为反斜杠，
// 桩统一归一后寻址，两种分隔符等价）——

type FakeEntry =
  | {
      readonly kind: 'file';
      readonly content: Buffer;
      /** statSize 兜底改报（50MB 边界用例免真分配 50MB 缓冲） */
      readonly sizeOverride?: number;
      /** readFile 必失败（写入期单节点失败分支）；'raw' 抛非 Error 值（异常兜底分支） */
      readonly readError?: boolean | 'raw';
      /** statSize 必失败（扫描期容错分支：降级 0 字节计划） */
      readonly statError?: boolean;
    }
  | {
      readonly kind: 'dir';
      readonly children: Readonly<Record<string, FakeEntry>>;
      /** readDir 必失败（子目录不可读降级） */ readonly unreadable?: boolean;
    };

function f(
  content: string | Buffer,
  overrides: Partial<Extract<FakeEntry, { kind: 'file' }>> = {},
): FakeEntry {
  return {
    kind: 'file',
    content: Buffer.isBuffer(content) ? content : Buffer.from(content),
    ...overrides,
  };
}

function d(children: Record<string, FakeEntry>, unreadable = false): FakeEntry {
  return { kind: 'dir', children, unreadable };
}

function makeFakeFs(
  root: Readonly<Record<string, FakeEntry>>,
): ImportFs & { readFileCalls: string[] } {
  const readFileCalls: string[] = [];
  const segments = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s !== '');
  const lookup = (p: string): FakeEntry | undefined => {
    const segs = segments(p);
    const walk = (level: Readonly<Record<string, FakeEntry>>, i: number): FakeEntry | undefined => {
      // noUncheckedIndexedAccess（A.1-1）：下标先取键判空再索引
      const key = segs[i];
      if (key === undefined) return undefined;
      const entry = level[key];
      if (entry === undefined) return undefined;
      if (i === segs.length - 1) return entry;
      return entry.kind === 'dir' ? walk(entry.children, i + 1) : undefined;
    };
    return segs.length === 0 ? undefined : walk(root, 0);
  };
  return {
    readFileCalls,
    readDir(dirPath: string): readonly { name: string; isDir: boolean }[] {
      const node = lookup(dirPath);
      if (node === undefined || node.kind !== 'dir' || node.unreadable === true) {
        throw new Error(`模拟目录不可读：${dirPath}`);
      }
      return Object.entries(node.children).map(([name, child]) => ({
        name,
        isDir: child.kind === 'dir',
      }));
    },
    isDirectory(p: string): boolean {
      // 贴近真实 statSync 语义：路径不存在即抛（服务侧转 E_IO_SOURCE_NOT_FOUND 整单失败）
      const node = lookup(p);
      if (node === undefined) throw new Error(`模拟路径不存在：${p}`);
      return node.kind === 'dir';
    },
    statSize(filePath: string): number {
      const node = lookup(filePath);
      if (node === undefined || node.kind !== 'file') {
        throw new Error(`模拟文件不存在：${filePath}`);
      }
      if (node.statError === true) throw new Error(`模拟 stat 失败：${filePath}`);
      return node.sizeOverride ?? node.content.byteLength;
    },
    readFile(filePath: string): Buffer {
      readFileCalls.push(filePath);
      const node = lookup(filePath);
      if (node === undefined || node.kind !== 'file') {
        throw new Error(`模拟文件不存在：${filePath}`);
      }
      // 'raw' 形态抛非 Error 值：模拟历史残留的异常兜底分支（服务不得因此崩溃）
      if (node.readError === 'raw') throw '字符串异常';
      if (node.readError === true) throw new Error(`模拟读取失败：${filePath}`);
      return node.content;
    },
  };
}

// —— 断言辅助 ——

interface NodeRowLite {
  readonly id: number;
  readonly parent_id: number | null;
  readonly node_type: 'dir' | 'file';
  readonly name: string;
  readonly mime_type: string | null;
  readonly size: number;
  readonly content: Buffer | null;
  readonly deleted_at: string | null;
}

function rowByPath(db: Database.Database, virtualPath: string): NodeRowLite | undefined {
  return db
    .prepare<string, NodeRowLite>(
      `SELECT id, parent_id, node_type, name, mime_type, size, content, deleted_at
       FROM node WHERE virtual_path = ? AND deleted_at IS NULL`,
    )
    .get(virtualPath);
}

function liveRowCount(db: Database.Database): number {
  // 根节点种子恒占 1 行：业务节点数 = 活行数 - 1
  return (
    (db.prepare('SELECT COUNT(*) AS n FROM node WHERE deleted_at IS NULL').get() as { n: number })
      .n - 1
  );
}

/** 计数断言辅助：ImportResult.importedNodeIds 为 M7 增量字段，逐用例值枚举无业务价值——
 * 计数主断言在此收口，importedNodeIds 的精确值由文件源专项用例断言 */
function expectCounts(
  result: { imported: number; skipped: number; failed: number },
  imported: number,
  skipped: number,
  failed: number,
): void {
  expect(result.imported).toBe(imported);
  expect(result.skipped).toBe(skipped);
  expect(result.failed).toBe(failed);
}

// —— 用例 ——

let db: Database.Database;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
});

function makeService(
  fakeFsRoot: Readonly<Record<string, Record<string, FakeEntry>>>,
  progress: ImportProgress[],
): ReturnType<typeof createImportService> {
  // 测试树字面量约定：顶层键为源根名、值为子项清单——此处统一包 d() 适配 fs 桩的 dir 形态
  const wrapped = Object.fromEntries(
    Object.entries(fakeFsRoot).map(([name, children]) => [name, d(children)]),
  );
  return createImportService({
    db,
    fs: makeFakeFs(wrapped),
    onProgress: (p) => progress.push(p),
  });
}

function importRequest(conflict: 'skip' | 'rename' | 'overwrite' = 'skip', targetParentId = 1) {
  return { sourcePaths: ['src'], targetParentId, conflict };
}

describe('importService 注入 fs 抽象（单元）', () => {
  it('层级映射：源树导入后 parent 链/虚拟路径/内容/mime/FTS 行全部一致', async () => {
    const progress: ImportProgress[] = [];
    const service = makeService(
      {
        src: {
          'a.txt': f('hello'),
          sub: d({ 'b.html': f('<p>hi</p>'), deep: d({ 'c.md': f('# t') }) }),
          'pic.png': f(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
        },
      },
      progress,
    );

    const result = await service.importNodes(importRequest('skip'));
    expectCounts(result, 6, 0, 0);

    const a = rowByPath(db, '/a.txt');
    expect(a).toMatchObject({
      parent_id: 1,
      node_type: 'file',
      name: 'a.txt',
      mime_type: 'text/plain',
      size: 5,
    });
    expect(a?.content?.toString('utf8')).toBe('hello');
    const sub = rowByPath(db, '/sub');
    expect(sub).toMatchObject({ parent_id: 1, node_type: 'dir', mime_type: null, size: 0 });
    const b = rowByPath(db, '/sub/b.html');
    expect(b).toMatchObject({ parent_id: sub?.id, mime_type: 'text/html', size: 9 });
    expect(b?.content?.toString('utf8')).toBe('<p>hi</p>');
    const deep = rowByPath(db, '/sub/deep');
    expect(deep).toMatchObject({ parent_id: sub?.id, node_type: 'dir' });
    const c = rowByPath(db, '/sub/deep/c.md');
    expect(c).toMatchObject({ parent_id: deep?.id, mime_type: 'text/markdown' });
    const png = rowByPath(db, '/pic.png');
    expect(png).toMatchObject({ parent_id: 1, mime_type: 'image/png', size: 4 });
    expect([...(png?.content ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // FTS 契约（A.4-4 同事务写入）：每业务节点一行；文本 MIME body 为内容、二进制为空串
    const ftsRows = db.prepare('SELECT rowid, name, body FROM node_fts').all() as Array<{
      rowid: number;
      name: string;
      body: string;
    }>;
    expect(ftsRows).toHaveLength(6);
    expect(ftsRows.find((r) => r.name === 'b.html')?.body).toBe('<p>hi</p>');
    expect(ftsRows.find((r) => r.name === 'pic.png')?.body).toBe('');
    expect(ftsRows.find((r) => r.name === 'sub')?.body).toBe('');
    expect(progress.filter((p) => p.phase === 'writing')).toHaveLength(1);
  });

  it('50MB 上限：超限单文件跳过计数、不发起读取也不落库；恰在上限内的文件正常导入', async () => {
    const fakeFs = makeFakeFs({
      src: d({
        // sizeOverride 免真分配 50MB：超上限一个字节
        'big.bin': f('stub', { sizeOverride: MAX_FILE_BYTES + 1 }),
        'edge.bin': f('edge', { sizeOverride: MAX_FILE_BYTES }),
        'ok.txt': f('ok'),
      }),
    });
    const service = createImportService({ db, fs: fakeFs, onProgress: vi.fn() });

    const result = await service.importNodes(importRequest('skip'));

    // E_VFS_FILE_TOO_LARGE 语义一致（写侧同上限）：超限计 skipped，非 failed
    expectCounts(result, 2, 1, 0);
    expect(fakeFs.readFileCalls).not.toContain(path.join('src', 'big.bin'));
    expect(rowByPath(db, '/big.bin')).toBeUndefined();
    expect(rowByPath(db, '/edge.bin')).toBeDefined();
    expect(rowByPath(db, '/ok.txt')).toBeDefined();
  });

  it('重命名策略：同名递增 a (2).txt，(2) 亦被占续递增 a (3).txt', async () => {
    const vfs = createVfsService(db);
    vfs.createNode({
      parentId: 1,
      name: 'a.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('old'),
    });
    vfs.createNode({
      parentId: 1,
      name: 'a (2).txt',
      nodeType: 'file',
      content: new TextEncoder().encode('two'),
    });
    const service = makeService({ src: { 'a.txt': f('new') } }, []);

    const result = await service.importNodes(importRequest('rename'));

    expectCounts(result, 1, 0, 0);
    expect(rowByPath(db, '/a (3).txt')?.content?.toString('utf8')).toBe('new');
    // 既有两节点原样保留（rename 不触碰既有行）
    expect(rowByPath(db, '/a.txt')?.content?.toString('utf8')).toBe('old');
    expect(rowByPath(db, '/a (2).txt')?.content?.toString('utf8')).toBe('two');
  });

  it('overwrite：trash 既有同名文件后原位写入，旧行入回收站、FTS 一换一', async () => {
    const vfs = createVfsService(db);
    const oldNode = vfs.createNode({
      parentId: 1,
      name: 'a.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('old'),
    });
    const service = makeService({ src: { 'a.txt': f('new') } }, []);

    const result = await service.importNodes(importRequest('overwrite'));

    expectCounts(result, 1, 0, 0);
    const fresh = rowByPath(db, '/a.txt');
    expect(fresh?.content?.toString('utf8')).toBe('new');
    expect(fresh?.id).not.toBe(oldNode.id);
    // 旧行软删除（回收站可找回，spec D15 覆盖语义），FTS 旧行已清
    const oldRow = db.prepare('SELECT deleted_at FROM node WHERE id = ?').get(oldNode.id) as {
      deleted_at: string | null;
    };
    expect(oldRow.deleted_at).not.toBeNull();
    const ftsRowids = (
      db.prepare('SELECT rowid FROM node_fts').all() as Array<{ rowid: number }>
    ).map((r) => r.rowid);
    expect(ftsRowids).toEqual([fresh?.id]);
  });

  it('skip：目录撞名合并（三策略一致），合并目录计入 skipped，子级按策略逐个判定', async () => {
    const vfs = createVfsService(db);
    const seededSub = vfs.createNode({ parentId: 1, name: 'sub', nodeType: 'dir' });
    vfs.createNode({
      parentId: seededSub.id,
      name: 'old.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('keep'),
    });
    const service = makeService({ src: { sub: d({ 'old.txt': f('x'), 'new.txt': f('y') }) } }, []);

    const result = await service.importNodes(importRequest('skip'));

    // sub 合并 skipped、old.txt 同名跳过、new.txt 新增 imported
    expectCounts(result, 1, 2, 0);
    const fresh = rowByPath(db, '/sub/new.txt');
    expect(fresh?.parent_id).toBe(seededSub.id);
    expect(fresh?.content?.toString('utf8')).toBe('y');
    expect(rowByPath(db, '/sub/old.txt')?.content?.toString('utf8')).toBe('keep');
  });

  it('取消标志当前批完成后停：第一批 200 节点保留，未开工节点不计入任何计数', async () => {
    const files: Record<string, FakeEntry> = {};
    for (let i = 1; i <= 250; i += 1) {
      files[`f${String(i).padStart(3, '0')}.txt`] = f(`content-${i}`);
    }
    const progress: ImportProgress[] = [];
    // 首个 writing 进度到达 = 第一批已提交（B.3-4 时序），此刻取消 → 第二批不再开工
    const spy = vi.fn((p: ImportProgress) => {
      progress.push(p);
      if (p.phase === 'writing' && p.done >= 200) service.cancel(p.importId);
    });
    const service = createImportService({ db, fs: makeFakeFs({ src: d(files) }), onProgress: spy });
    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 200, 0, 0);
    expect(liveRowCount(db)).toBe(200);
    expect(progress.filter((p) => p.phase === 'writing')).toHaveLength(1);
  });

  it('取消开工前置零写入：预置取消标志后整单零计数零落库', async () => {
    const service = makeService({ src: { 'a.txt': f('x') } }, []);
    service.cancel(1); // 服务内 importId 自 1 单调递增，首单必为 1

    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 0, 0, 0);
    expect(liveRowCount(db)).toBe(0);
  });

  it('cancel 未知/已完成 id 为无操作，不阻碍后续导入', async () => {
    const service = makeService({ src: { 'a.txt': f('x') } }, []);
    expect(() => service.cancel(999)).not.toThrow();

    const result = await service.importNodes(importRequest('skip'));
    expectCounts(result, 1, 0, 0);
  });

  it('批次 ≤200 节点切分：250 节点产出两写批，progress done 序列 [200, 250]', async () => {
    const files: Record<string, FakeEntry> = {};
    for (let i = 1; i <= 250; i += 1) {
      files[`f${String(i).padStart(3, '0')}.txt`] = f(`content-${i}`);
    }
    const progress: ImportProgress[] = [];
    const service = makeService({ src: files }, progress);

    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 250, 0, 0);
    const writing = progress.filter((p) => p.phase === 'writing');
    expect(writing.map((p) => p.done)).toEqual([200, 250]);
  });

  it('批次 ≤16MB 字节闸：8MB×3 切为 [2,1] 两批（16MB 恰满不切）', async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const progress: ImportProgress[] = [];
    const service = makeService(
      { src: { 'one.bin': f(big), 'two.bin': f(big), 'three.bin': f(big) } },
      progress,
    );

    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 3, 0, 0);
    const writing = progress.filter((p) => p.phase === 'writing');
    expect(writing.map((p) => p.done)).toEqual([2, 3]);
  });

  it('progress 回调序列：scanning 先行（按源根推进）、writing 随批且到达时数据已提交；importId 单调', async () => {
    const progress: ImportProgress[] = [];
    const service = makeService({ src: { 'a.txt': f('1') }, src2: { 'b.txt': f('2') } }, progress);

    // 多源根：scanning done 1→2、total=根数
    await service.importNodes({
      sourcePaths: ['src', 'src2'],
      targetParentId: 1,
      conflict: 'skip',
    });
    expect(progress[0]).toMatchObject({
      importId: 1,
      phase: 'scanning',
      done: 1,
      total: 2,
      currentPath: 'src',
    });
    expect(progress[1]).toMatchObject({ importId: 1, phase: 'scanning', done: 2, total: 2 });

    // writing 进度到达时第一批数据必须已提交（B.3-4：事务提交后才发）
    const firstWritingIndex = progress.findIndex((p) => p.phase === 'writing');
    expect(progress.slice(0, firstWritingIndex).every((p) => p.phase === 'scanning')).toBe(true);
    expect(liveRowCount(db)).toBe(2);
    expect(progress.every((p) => p.importId === 1)).toBe(true);

    // 同一服务实例第二单 importId 单调递增（进程内单例语义，取消寻址的唯一身份）
    const beforeSecond = progress.length;
    await service.importNodes({
      sourcePaths: ['src2'],
      targetParentId: 1,
      conflict: 'skip',
    });
    expect(progress.slice(beforeSecond).every((p) => p.importId === 2)).toBe(true);
  });

  it('源路径不存在 → E_IO_SOURCE_NOT_FOUND，整单失败零写入', async () => {
    const service = makeService({ src: { 'a.txt': f('x') } }, []);

    await expect(
      service.importNodes({ sourcePaths: ['nope'], targetParentId: 1, conflict: 'skip' }),
    ).rejects.toMatchObject({ code: E_IO_SOURCE_NOT_FOUND } satisfies Partial<AppError>);
    expect(liveRowCount(db)).toBe(0);
  });

  it('目录源 isDirectory 判定后 readDir 失败（源根竞态失效）→ E_IO_SOURCE_NOT_FOUND 整单失败零写入（M7 catch 分支）', async () => {
    // 不经 makeService（其会把顶层键统一包成普通目录）：直接以「根即 unreadable 目录」
    // 构桩——isDirectory=true 判别过、readDir 抛，精确命中「判别后、读取前源失效」的
    // 防御分支（真实世界对应 stat 通过后目录被删/权限收紧的竞态窗口）
    const progress: ImportProgress[] = [];
    const service = createImportService({
      db,
      fs: makeFakeFs({ 挂了: d({}, true) }),
      onProgress: (p) => progress.push(p),
    });

    await expect(
      service.importNodes({ sourcePaths: ['挂了'], targetParentId: 1, conflict: 'skip' }),
    ).rejects.toMatchObject({ code: E_IO_SOURCE_NOT_FOUND } satisfies Partial<AppError>);
    expect(liveRowCount(db)).toBe(0);
  });

  it('目标非法：不存在 E_VFS_NOT_FOUND、文件目标 E_VFS_TYPE_MISMATCH', async () => {
    const vfs = createVfsService(db);
    const fileNode = vfs.createNode({
      parentId: 1,
      name: 'x.txt',
      nodeType: 'file',
      content: new TextEncoder().encode('x'),
    });
    const service = makeService({ src: { 'a.txt': f('x') } }, []);

    await expect(service.importNodes(importRequest('skip', 999))).rejects.toMatchObject({
      code: E_VFS_NOT_FOUND,
    });
    await expect(service.importNodes(importRequest('skip', fileNode.id))).rejects.toMatchObject({
      code: E_VFS_TYPE_MISMATCH,
    });
    expect(liveRowCount(db)).toBe(1);
  });

  it('子目录不可读：warn 降级为空目录导入，不中断整单', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const service = makeService({ src: { locked: d({}, true), 'ok.txt': f('x') } }, []);
      const result = await service.importNodes(importRequest('skip'));
      expectCounts(result, 2, 0, 0);
      expect(rowByPath(db, '/locked')?.node_type).toBe('dir');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不可读'), expect.anything());
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('单文件读取失败计 failed 不拖垮整批（含非 Error 异常兜底）；stat 失败扫描期降级 0 字节计划同归 failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const service = makeService(
        {
          src: {
            'bad.txt': f('x', { readError: true }),
            'raw.txt': f('w', { readError: 'raw' }),
            // stat 失败在真实 fs 意味着文件不可得：读取同样失败，故同时置 readError
            'stat-bad.txt': f('y', { statError: true, readError: true }),
            'ok.txt': f('z'),
          },
        },
        [],
      );

      const result = await service.importNodes(importRequest('skip'));

      expectCounts(result, 1, 0, 3);
      expect(rowByPath(db, '/ok.txt')).toBeDefined();
      expect(rowByPath(db, '/bad.txt')).toBeUndefined();
      expect(rowByPath(db, '/raw.txt')).toBeUndefined();
      expect(rowByPath(db, '/stat-bad.txt')).toBeUndefined();
      // D17 控制台明细：失败项单条 error 上报，非 Error 异常不致崩溃且保留归因
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('raw.txt（字符串异常）'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('取消恰好卡在下一批开工点：待写批弃置（450 节点、首批后取消，只写 200）', async () => {
    const files: Record<string, FakeEntry> = {};
    for (let i = 1; i <= 450; i += 1) {
      files[`f${String(i).padStart(3, '0')}.txt`] = f(`content-${i}`);
    }
    const progress: ImportProgress[] = [];
    const service = createImportService({
      db,
      fs: makeFakeFs({ src: d(files) }),
      onProgress: (p) => {
        progress.push(p);
        if (p.phase === 'writing' && p.done >= 200) service.cancel(p.importId);
      },
    });

    const result = await service.importNodes(importRequest('skip'));

    // 首批 200 提交并广播后取消：第二批在开工点（needFlush）被弃置，450-200=250 未开工
    expectCounts(result, 200, 0, 0);
    expect(liveRowCount(db)).toBe(200);
    expect(progress.filter((p) => p.phase === 'writing')).toHaveLength(1);
  });

  it('空源目录：零计划零写入，仅扫描进度、无写批进度', async () => {
    const progress: ImportProgress[] = [];
    const service = makeService({ src: {} }, progress);

    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 0, 0, 0);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.phase).toBe('scanning');
    expect(liveRowCount(db)).toBe(0);
  });

  it('目录名非法：目录计 failed，其子节点因父链缺失连带 failed（parent 链映射防御）', async () => {
    const service = makeService(
      { src: { 'bad<name': d({ 'inner.txt': f('x') }), 'ok.txt': f('y') } },
      [],
    );

    const result = await service.importNodes(importRequest('skip'));

    expectCounts(result, 1, 0, 2);
    expect(rowByPath(db, '/ok.txt')).toBeDefined();
    expect(rowByPath(db, '/bad<name')).toBeUndefined();
    expect(rowByPath(db, '/bad<name/inner.txt')).toBeUndefined();
  });

  it('多源根合并导入：同名条目落入同一目标目录并经策略判定', async () => {
    const progress: ImportProgress[] = [];
    const service = makeService(
      { src: { 'x.txt': f('first') }, src2: { 'x.txt': f('second') } },
      progress,
    );

    const result = await service.importNodes({
      sourcePaths: ['src', 'src2'],
      targetParentId: 1,
      conflict: 'skip',
    });

    expectCounts(result, 1, 1, 0);
    expect(rowByPath(db, '/x.txt')?.content?.toString('utf8')).toBe('first');
  });

  it('文件源导入：单节点物化为目标父直接子项，importedNodeIds 携带新节点 id（M7）', async () => {
    const progress: ImportProgress[] = [];
    const service = createImportService({
      db,
      fs: makeFakeFs({ 'hello.html': f('<p>page</p>') }),
      onProgress: (p) => progress.push(p),
    });

    const result = await service.importNodes({
      sourcePaths: ['hello.html'],
      targetParentId: 1,
      conflict: 'rename',
    });

    expectCounts(result, 1, 0, 0);
    // 单文件导入「导入后即打开」的寻址依据：importedNodeIds[0] = 新节点 id
    expect(result.importedNodeIds).toHaveLength(1);
    const node = rowByPath(db, '/hello.html');
    expect(node).toMatchObject({
      parent_id: 1,
      node_type: 'file',
      name: 'hello.html',
      mime_type: 'text/html',
    });
    expect(node?.id).toBe(result.importedNodeIds[0]);
    expect(node?.content?.toString('utf8')).toBe('<p>page</p>');
    // 源根判别走 isDirectory 分支：文件源不发起 readDir（progress 仅 scanning 一条）
    expect(progress.filter((p) => p.phase === 'scanning')).toHaveLength(1);
  });

  it('文件源 sourceName：导入即重命名生效；空白值回退磁盘 basename（M7 确认浮层链）', async () => {
    const service = createImportService({
      db,
      fs: makeFakeFs({ 'raw-name.html': f('a'), 'other.html': f('b') }),
      onProgress: vi.fn(),
    });

    await service.importNodes({
      sourcePaths: ['raw-name.html'],
      targetParentId: 1,
      conflict: 'rename',
      sourceName: '自定义名.html',
    });
    expect(rowByPath(db, '/自定义名.html')).toBeDefined();
    expect(rowByPath(db, '/raw-name.html')).toBeUndefined();

    // 空白 sourceName 回退磁盘 basename（zod min(1) 拦截空串，防御性再兜一层 trim）
    await service.importNodes({
      sourcePaths: ['other.html'],
      targetParentId: 1,
      conflict: 'rename',
      sourceName: '   ',
    });
    expect(rowByPath(db, '/other.html')).toBeDefined();
  });

  it('文件源与目录源混选：文件单节点入目标父、目录递归展开，互不干扰', async () => {
    const service = createImportService({
      db,
      fs: makeFakeFs({ 'solo.txt': f('one'), src: d({ 'inner.txt': f('two') }) }),
      onProgress: vi.fn(),
    });

    const result = await service.importNodes({
      sourcePaths: ['solo.txt', 'src'],
      targetParentId: 1,
      conflict: 'skip',
    });

    expectCounts(result, 2, 0, 0);
    expect(rowByPath(db, '/solo.txt')?.parent_id).toBe(1);
    expect(rowByPath(db, '/inner.txt')?.parent_id).toBe(1);
  });
});
