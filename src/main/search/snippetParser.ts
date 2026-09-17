// 命中片段解析（spec §6）：trigram 通道 snippet() 标记文本 → 文本 + 命中码元区间；
// 名称与 LIKE 回退通道统一按词项大小写归一 indexOf 计算区间。
// 区间契约：相对最终返回文本、JS UTF-16 码元偏移、start 升序、精确去重、允许重叠（多词命中同一区域）。
import type { SearchHitRange, Snippet } from '../../shared/search-contract';

/** FTS5 snippet() 起止控制标记（非可打印码位，与正文零冲突；SQL 侧以 char(2)/char(3) 产生） */
export const MARK_START = '\u0002';
export const MARK_END = '\u0003';

/** LIKE 回退通道正文窗口半宽（≈12 个 trigram token 的展示量级，SQL substr 码点单位） */
export const SNIPPET_WINDOW = 36;

/** 解析 snippet 标记文本：剥离 MARK_*，配对标记之间计为区间；未配对标记静默忽略 */
export function parseMarkedSnippet(marked: string): Snippet {
  let text = '';
  const ranges: SearchHitRange[] = [];
  let open = -1;
  for (const ch of marked) {
    if (ch === MARK_START) {
      open = text.length;
      continue;
    }
    if (ch === MARK_END) {
      if (open !== -1) {
        ranges.push({ start: open, end: text.length });
        open = -1;
      }
      continue;
    }
    text += ch;
  }
  return { text, ranges };
}

/**
 * 词项大小写不敏感全量扫描（与 trigram case_sensitive=0 口径一致，toLowerCase 归一）。
 * 每词内逐出现推进 1 码元以捕获重叠；跨词精确重复区间去重；结果按 start 升序。
 */
export function findTermRanges(text: string, terms: readonly string[]): readonly SearchHitRange[] {
  const haystack = text.toLowerCase();
  const ranges: SearchHitRange[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (needle === '') continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      const key = `${at}:${at + needle.length}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ start: at, end: at + needle.length });
      }
      from = at + 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * LIKE 回退通道窗口片段：入参为 SQL 侧 substr 取回的窗口文本（码点窗口）；
 * 省略号计入文本与区间偏移（前省略占 1 码元并整体右移，后省略不移动既有区间）。
 * 窗口文本内找不到的词项（如 SQLite lower() 仅折叠 ASCII、增补字符大小写折叠差异）
 * 不计区间——片段仍为有效上下文展示（spec §6 降级通道语义）。
 */
export function buildWindowSnippet(
  windowText: string,
  terms: readonly string[],
  hasPrefix: boolean,
  hasSuffix: boolean,
): Snippet {
  const text = `${hasPrefix ? '…' : ''}${windowText}${hasSuffix ? '…' : ''}`;
  const shift = hasPrefix ? 1 : 0;
  return {
    text,
    ranges: findTermRanges(windowText, terms).map((r) => ({
      start: r.start + shift,
      end: r.end + shift,
    })),
  };
}
