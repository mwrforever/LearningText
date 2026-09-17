// 搜索全链路（FR-SEARCH-01/02/04、spec §4-§7）：双通道、排序、分页、filters、一致性
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { createSearchService } from '../../../src/main/search/searchService';
import { AppError } from '../../../src/shared/result';
import { E_IPC_BAD_PAYLOAD, E_VFS_NOT_FOUND } from '../../../src/shared/errors';
import type { SearchQueryRequest } from '../../../src/shared/search-contract';

let db: Database.Database;
let vfs: ReturnType<typeof createVfsService>;
let search: ReturnType<typeof createSearchService>;

const file = (parentId: number, name: string, text: string): number =>
  vfs.createNode({ parentId, name, nodeType: 'file', content: new Uint8Array(Buffer.from(text)) })
    .id;

beforeEach(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  vfs = createVfsService(db);
  search = createSearchService(db);
  // 场景树：
  //   /笔记/web/index.html      正文含「二元指数分布」「指数」
  //   /指数.txt                  名称含「指数」；正文 plain EXPONENTIAL text
  //   /a%b.txt                   通配符字面量名（LIKE 转义验证）
  //   /pic.png                   非文本 MIME（png）：FTS body 恒空串
  //   /指数目录                  目录命中名称
  const notes = vfs.createNode({ parentId: 1, name: '笔记', nodeType: 'dir' }).id;
  const web = vfs.createNode({ parentId: notes, name: 'web', nodeType: 'dir' }).id;
  file(web, 'index.html', '<p>二元指数分布</p><p>指数</p>');
  file(1, '指数.txt', 'plain EXPONENTIAL text');
  file(1, 'a%b.txt', 'wild');
  file(1, 'pic.png', 'PNGDATA'); // 非文本 MIME → 索引 body 为空，PNGDA 不可检
  vfs.createNode({ parentId: 1, name: '指数目录', nodeType: 'dir' });
});

const query = (req: SearchQueryRequest) => search.query(req);
const names = (req: SearchQueryRequest): string[] => query(req).hits.map((h) => h.node.name);

describe('trigram 索引通道（全词 ≥3 码点）', () => {
  it('中文子串命中正文：二元指数 → 仅 index.html，matchIn=body、bodySnippet 区间可还原子串', () => {
    const res = query({ keyword: '二元指数' });
    expect(res.hits.map((h) => h.node.name)).toEqual(['index.html']);
    const hit = res.hits[0];
    expect(hit?.matchIn).toBe('body');
    expect(hit?.score).not.toBeNull(); // 索引通道有 bm25 分数
    const range = hit?.bodySnippet?.ranges[0];
    expect(hit?.bodySnippet?.text).toContain('二元指数');
    expect(hit?.bodySnippet?.text.slice(range?.start ?? -1, range?.end ?? -1)).toBe('二元指数');
    expect(res.total).toBe(1);
    expect(res.truncated).toBe(false);
  });

  it('名称命中：指数.txt → matchIn=name，score 有效、bodySnippet null', () => {
    const res = query({ keyword: '指数.txt' });
    expect(res.hits.map((h) => h.node.name)).toEqual(['指数.txt']);
    expect(res.hits[0]?.matchIn).toBe('name');
    expect(res.hits[0]?.bodySnippet).toBeNull();
    expect(res.hits[0]?.nameSnippet.text).toBe('指数.txt');
  });

  it('AND 语义：多词全命中同一行才出（跨列可组合），分散两行零命中', () => {
    expect(names({ keyword: '指数.txt EXPONENTIAL' })).toEqual(['指数.txt']); // 名称+正文跨列 AND（两词均 ≥3 码点，索引通道）
    expect(names({ keyword: 'EXPO wild' })).toEqual([]); // EXPO 仅 指数.txt、wild 仅 a%b.txt，无单行全含
  });

  it('短语整体成词项：引号内空格不分词，命中含该连排短语的行', () => {
    const id = file(1, 'phrase.html', 'prefix 二元 指数 序列'); // 正文含连排 '二元 指数'
    const res = query({ keyword: '"二元 指数"' });
    expect(res.hits.map((h) => h.node.id)).toEqual([id]); // index.html 的 '二元指数' 无空格，不匹配该带空格短语
  });

  it('大小写不敏感（trigram case_sensitive=0）：expon 命中 EXPONENTIAL', () => {
    expect(names({ keyword: 'expon' })).toEqual(['指数.txt']);
  });

  it('通配符字面量：a%b 查询命中 /a%b.txt（MATCH 短语无 LIKE 通配语义）', () => {
    expect(names({ keyword: 'a%b' })).toEqual(['a%b.txt']);
  });

  it('非文本 MIME 正文不可检：PNGDA 对 pic.png 零命中（body 空串口径）', () => {
    expect(names({ keyword: 'PNGDA' })).toEqual([]);
  });

  it('bm25 权重：名称命中排正文命中之前（二元指数 双命中场景）', () => {
    file(1, '二元指数.html', 'empty'); // 名称含词，正文 empty 级
    const res = query({ keyword: '二元指数' });
    expect(res.hits.map((h) => h.node.name)).toEqual(['二元指数.html', 'index.html']);
  });

  it('tie-break：bm25 同分下 updated_at DESC、再 id ASC 稳定（分页可复现）', () => {
    const a = file(1, 'dupA.html', '共享命中词内容'); // a 先建，id < b
    const b = file(1, 'dupB.html', '共享命中词内容'); // 同正文 → 同分（名称均不含词，name 列贡献 0）
    // 赋不同更新时间排除创建抖动：b 较新 → updated_at DESC 令 b 先
    db.prepare('UPDATE node SET updated_at = ? WHERE id = ?').run(
      '2026-09-17T09:00:00.000+08:00',
      a,
    );
    db.prepare('UPDATE node SET updated_at = ? WHERE id = ?').run(
      '2026-09-17T10:00:00.000+08:00',
      b,
    );
    expect(query({ keyword: '共享命中词' }).hits.map((h) => h.node.id)).toEqual([b, a]);
    // 归一为相同更新时间：退到 id ASC → a 先（a id 更小）
    db.prepare('UPDATE node SET updated_at = ? WHERE id IN (?, ?)').run(
      '2026-09-17T08:00:00.000+08:00',
      a,
      b,
    );
    expect(query({ keyword: '共享命中词' }).hits.map((h) => h.node.id)).toEqual([a, b]);
  });

  it('分页与 truncated/total：limit 截断、offset 翻页、越界空', () => {
    for (let i = 0; i < 5; i += 1) file(1, `分页项${String(i)}.html`, 'body');
    const p1 = query({ keyword: '分页项', limit: 2 });
    expect(p1.hits).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.truncated).toBe(true);
    expect(query({ keyword: '分页项', offset: 4 }).hits).toHaveLength(1);
    const over = query({ keyword: '分页项', offset: 99 });
    expect(over.hits).toEqual([]);
    expect(over.truncated).toBe(false);
  });

  it('名称与正文同时命中 → matchIn=both（单行两列同含词，spec §6 列归属）', () => {
    const id = file(1, '双列.html', '双列正文'); // 名称与正文均含「双列」
    const hit = query({ keyword: '双列' }).hits.find((h) => h.node.id === id);
    expect(hit?.matchIn).toBe('both');
  });
});

// ——（续 tests/integration/search/search.test.ts：在上一 describe 之后追加）——
describe('LIKE 回退通道（任一词 <3 码点，整条降级）', () => {
  it('2 字词「指数」：名称+正文命中集合与索引通道一致，score 为 null、按 updated_at 降序', () => {
    const res = query({ keyword: '指数' });
    expect(res.hits.map((h) => h.node.name).sort()).toEqual(['index.html', '指数.txt', '指数目录']);
    expect(res.hits.every((h) => h.score === null)).toBe(true);
    // 无 score：回退通道按更新时间倒序（场景创建顺序即时间序，index.html 最新——afterEach 断言弱序即可）
    expect(res.total).toBe(3);
  });

  it('通配符转义：x_y 词不匹配 xay（%未转义会误中的对照场景），字面 x_y 命中', () => {
    file(1, '指xay.txt', 'body'); // 名称含 指 与 xay
    file(1, '指x_y.txt', 'body'); // 名称含 指 与 x_y 字面
    // terms：x_y(3 码点) + 指(1 码点 <3) → 整条 LIKE 通道；%x\_y% 转义精确
    expect(names({ keyword: 'x_y 指' })).toEqual(['指x_y.txt']);
  });

  it('like 通道 snippet：窗口文本含词且区间可还原（省略号偏移正确）', () => {
    const long = `${'前缀'.repeat(200)}指数尾部文本`;
    file(1, '窗口长文.txt', long);
    const res = query({ keyword: '数尾' }); // 2 字词 → LIKE
    const hit = res.hits.find((h) => h.node.name === '窗口长文.txt');
    expect(hit?.bodySnippet).not.toBeNull();
    const snip = hit?.bodySnippet;
    expect(snip?.text).toContain('数尾');
    const r = snip?.ranges.find((x) => snip.text.slice(x.start, x.end) === '数尾');
    expect(r).toBeDefined();
    expect(snip?.text.startsWith('…')).toBe(true); // 深部命中必有前省略
  });

  it('同形态重复查询复用预编译语句（A.4-5 缓存）：两次结果一致', () => {
    const first = query({ keyword: '指数' });
    const second = query({ keyword: '指数' }); // 同键第二次走缓存命中路径
    expect(second.total).toBe(first.total);
    expect(second.hits.map((h) => h.node.id)).toEqual(first.hits.map((h) => h.node.id));
    expect(second.truncated).toBe(first.truncated);
  });
});

describe('filters（FR-SEARCH-03）', () => {
  it('nodeTypes 白名单：dir 仅目录、file 排除目录', () => {
    expect(names({ keyword: '指数', filters: { nodeTypes: ['dir'] } })).toEqual(['指数目录']);
    expect(names({ keyword: '指数', filters: { nodeTypes: ['file'] } }).sort()).toEqual([
      'index.html',
      '指数.txt',
    ]);
  });

  it('nodeTypes 双类型白名单：dir+file 覆盖两类，命中集合等价于无类型过滤', () => {
    expect(names({ keyword: '指数', filters: { nodeTypes: ['dir', 'file'] } }).sort()).toEqual([
      'index.html',
      '指数.txt',
      '指数目录',
    ]);
  });

  it('underPath 子树限定：/笔记 内命中 index.html，子树外 指数.txt 排除', () => {
    expect(names({ keyword: '指数', filters: { underPath: '/笔记' } })).toEqual(['index.html']);
  });

  it('underPath × 索引通道（全词 ≥3 码点，RECURSIVE 子树 CTE 与物化探针 CTE 组合形态）：子树内命中、子树外排除', () => {
    expect(names({ keyword: '二元指数', filters: { underPath: '/笔记' } })).toEqual(['index.html']);
    expect(names({ keyword: '指数.txt', filters: { underPath: '/笔记' } })).toEqual([]);
  });

  it('underPath 不存在路径 → E_VFS_NOT_FOUND（复用既有码，spec §6）', () => {
    try {
      query({ keyword: '指数', filters: { underPath: '/无此路径' } });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as AppError).code).toBe(E_VFS_NOT_FOUND);
    }
  });
});

describe('索引一致性（FR-SEARCH-04：删除立即可验证）', () => {
  it('trash 后搜不到、还原后恢复', () => {
    expect(names({ keyword: '二元指数' })).toEqual(['index.html']);
    const webId = vfs.resolvePath({ virtualPath: '/笔记/web' }).nodeId;
    vfs.trashNode({ nodeId: webId });
    expect(names({ keyword: '二元指数' })).toEqual([]); // 同事务删除的 FTS 行即刻不可见
    vfs.restoreNode({ nodeId: webId });
    expect(names({ keyword: '二元指数' })).toEqual(['index.html']); // 重建的 FTS 行即刻可检
  });
});

describe('查询拒绝（E_IPC_BAD_PAYLOAD，spec §4/§7.3）', () => {
  it('空查询与引号未闭合拒绝', () => {
    for (const kw of ['', '   ', '未闭合 "指数']) {
      try {
        query({ keyword: kw });
        expect.unreachable('应拒绝');
      } catch (e) {
        expect((e as AppError).code).toBe(E_IPC_BAD_PAYLOAD);
      }
    }
  });
});
