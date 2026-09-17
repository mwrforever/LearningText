// 片段解析（spec §6）：控制标记→文本+码元区间；词项大小写扫描；窗口省略号偏移
import { describe, expect, it } from 'vitest';
import {
  MARK_END,
  MARK_START,
  buildWindowSnippet,
  findTermRanges,
  parseMarkedSnippet,
} from '../../../src/main/search/snippetParser';

describe('parseMarkedSnippet', () => {
  it('成对标记剥离并产出偏移正确的区间（多段）', () => {
    const marked = `前缀${MARK_START}二元指数${MARK_END}中段${MARK_START}分布${MARK_END}`;
    const s = parseMarkedSnippet(marked);
    expect(s.text).toBe('前缀二元指数中段分布');
    expect(s.ranges).toEqual([
      { start: 2, end: 6 },
      { start: 8, end: 10 },
    ]);
  });

  it('emoji 命中：偏移按 UTF-16 码元（slice 取回含完整 emoji）', () => {
    const marked = `a${MARK_START}\u{1F600}指数${MARK_END}b`;
    const s = parseMarkedSnippet(marked);
    expect(s.text).toBe('a\u{1F600}指数b');
    const first = s.ranges[0];
    expect(first).toBeDefined();
    expect(s.text.slice(first?.start, first?.end)).toBe('\u{1F600}指数');
  });

  it('未配对标记静默忽略（仅配对段计区间、文本保留）', () => {
    const s = parseMarkedSnippet(`${MARK_START}孤立开始${MARK_START}再开始${MARK_END}`);
    expect(s.text).toBe('孤立开始再开始');
    expect(s.ranges).toEqual([{ start: 4, end: 7 }]);
  });

  it('未配对结束标记静默忽略（无待闭合区间时不产出范围）', () => {
    const s = parseMarkedSnippet(`前缀${MARK_END}正文`);
    expect(s.text).toBe('前缀正文');
    expect(s.ranges).toEqual([]);
  });

  it('无标记输入原样返回空区间', () => {
    expect(parseMarkedSnippet('纯文本')).toEqual({ text: '纯文本', ranges: [] });
  });
});

describe('findTermRanges', () => {
  it('大小写不敏感、全量出现、start 升序、精确去重（多词同区重叠保留）', () => {
    expect(findTermRanges('Abc abc ABC', ['ABC'])).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    // 重叠区间：'指数' 与 '数分' 在 '指数分布' 上相交但不精确重复，均保留
    expect(findTermRanges('指数分布', ['指数', '数分'])).toEqual([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
    ]);
  });

  it('空词项跳过、无命中返回空数组', () => {
    expect(findTermRanges('abc', [''])).toEqual([]);
    expect(findTermRanges('abc', ['xyz'])).toEqual([]);
  });

  it('多词命中同一位置（大小写归一后同区）精确去重只留一条', () => {
    // 'ABC' 与 'abc' 归一后同词，同位置命中 → 精确重复区间去重为单条
    expect(findTermRanges('ABC', ['ABC', 'abc'])).toEqual([{ start: 0, end: 3 }]);
  });
});

describe('buildWindowSnippet', () => {
  it('省略号占位计入偏移：前省略 +1 码元，后省略不移动既有区间', () => {
    const s = buildWindowSnippet('二元分布', ['分布'], true, false);
    expect(s.text).toBe('…二元分布');
    expect(s.ranges).toEqual([{ start: 3, end: 5 }]);
    const both = buildWindowSnippet('二元分布', ['分布'], true, true);
    expect(both.text).toBe('…二元分布…');
    expect(both.ranges).toEqual([{ start: 3, end: 5 }]);
  });

  it('窗口无命中（大小写折叠差异）返回空区间不抛错', () => {
    expect(buildWindowSnippet('无关文本', ['分布'], false, false).ranges).toEqual([]);
  });
});
