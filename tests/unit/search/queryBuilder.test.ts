// 查询构造（spec §4）：NFC、空格+引号短语分词、上限、trigram/LIKE 通道选择与转义
import { describe, expect, it } from 'vitest';
import { buildSearchQuery, escapeLikePattern } from '../../../src/main/search/queryBuilder';
import { AppError } from '../../../src/shared/result';
import { E_IPC_BAD_PAYLOAD } from '../../../src/shared/errors';

const reject = (keyword: string): void => {
  try {
    buildSearchQuery(keyword);
    expect.unreachable('应被拒绝却通过：' + keyword);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(E_IPC_BAD_PAYLOAD);
  }
};

describe('buildSearchQuery', () => {
  it('索引通道：全词 ≥3 码点，MATCH 为双引号短语 AND 拼接', () => {
    const q = buildSearchQuery('二元分布 指数分布');
    expect(q.channel).toBe('trigram');
    expect(q.terms).toEqual(['二元分布', '指数分布']);
    expect(q.match).toBe('"二元分布" AND "指数分布"');
    expect(q.likePatterns).toEqual([]);
  });

  it('词项间连续空白/制表符同单空格切分', () => {
    // spec §4：空白切分含连续空格与制表符，短词连续空白触发整条 LIKE 回退的同源分支
    expect(buildSearchQuery('二元  分布').terms).toEqual(['二元', '分布']);
    expect(buildSearchQuery('二元\t分布').terms).toEqual(['二元', '分布']);
  });

  it('短语整体成词项（引号内空格不分词），内部引号加倍为字面量', () => {
    const q = buildSearchQuery('"二元 分布"');
    expect(q.terms).toEqual(['二元 分布']);
    expect(q.match).toBe('"二元 分布"');
    const inner = buildSearchQuery('"a""b 指数分布"');
    expect(inner.terms).toEqual(['a"b 指数分布']);
    expect(inner.match).toBe('"a""b 指数分布"');
  });

  it('NFC 规范化先于长度与通道判定：组合序列归一为码点计数', () => {
    // cafe + 组合急性符号（NFD，2 码点尾部）→ NFC café 后词项含 é；
    // 词 'café' 4 码点 ≥3 → 索引通道，terms 为 NFC 规范形
    const q = buildSearchQuery('caf\u0065\u0301');
    expect(q.terms).toEqual(['caf\u00e9']);
    expect(q.channel).toBe('trigram');
  });

  it('回退通道：短词触发整条 LIKE 回退，通配符按字面量转义', () => {
    // 'ab' 2 码点 <3 触发整条回退；'a%b'（3 码点）非短词但随整条走回退，% 转义后按字面量匹配
    const q = buildSearchQuery('指数分布 a%b ab');
    expect(q.channel).toBe('like');
    // 字面量含百分号：对 a%b 的转义断言（% → \%）
    expect(q.likePatterns).toEqual(['%指数分布%', '%a\\%b%', '%ab%']);
    expect(q.match).toBe('');
  });

  it('词数上界 8 通过、9 拒绝；空/纯空白/空短语/引号未闭合拒绝', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `词${String(i)}号字`).join(' ');
    expect(buildSearchQuery(eight).terms).toHaveLength(8);
    reject(`${eight} 词8号字`); // 第 9 词
    reject('');
    reject('   ');
    reject('指数分布 ""');
    reject('未闭合 "指数');
  });

  it('词项长度上限：255 码点通过、256 拒绝（增补平面按码点计）', () => {
    expect([...(buildSearchQuery('a'.repeat(255)).terms[0] ?? '')]).toHaveLength(255);
    reject('a'.repeat(256));
    // 128 emoji = 128 码点（256 码元）合法（M1 码点口径同源）且 ≥3 → 索引通道
    expect(buildSearchQuery('\u{1F600}'.repeat(128)).channel).toBe('trigram');
  });

  it('emoji 词按码点数取通道：2 枚 = 2 码点 <3 → 回退（码元长度 4 不得误判）', () => {
    expect(buildSearchQuery('\u{1F600}\u{1F600}').channel).toBe('like');
    // 字面量含反斜杠/下划线/百分号三字符全转义
    expect(escapeLikePattern('a_b\\c%d')).toBe('%a\\_b\\\\c\\%d%');
  });
});
