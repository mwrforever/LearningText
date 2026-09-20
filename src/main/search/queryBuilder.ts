// 搜索查询构造（spec §4）：纯函数——NFC 规范化、空格分词 + 双引号短语、词数/码点校验、
// trigram/LIKE 通道选择与 LIKE 模式转义。不触库、不感知 db；上限常量取 shared 契约。
import { E_IPC_BAD_PAYLOAD } from '../../shared/errors';
import { AppError } from '../../shared/result';
import { MAX_SEARCH_TERMS, MAX_SEARCH_TERM_CODEPOINTS } from '../../shared/search-contract';

/** trigram 无法索引 <3 Unicode 码点子串（官方硬限制，A.4-11）：短词整条查询走 LIKE 回退 */
const TRIGRAM_MIN_CODEPOINTS = 3;

export interface BuiltQuery {
  readonly channel: 'trigram' | 'like';
  /** NFC 规范化后的词项（含引号短语整体），按输入序 */
  readonly terms: readonly string[];
  /** trigram MATCH 表达式（词项双引号 AND 拼接，内部 " 加倍为字面量）；回退通道为空串 */
  readonly match: string;
  /** LIKE 模式串（%转义词%）：仅回退通道有值（ESCAPE 子句在 SQL 侧，索引通道禁 ESCAPE） */
  readonly likePatterns: readonly string[];
}

/** 载荷类拒绝统一 E_IPC_BAD_PAYLOAD（spec §7.3 不新增错误码；消息只含形态描述、不含原文） */
function reject(reason: string): never {
  throw new AppError(E_IPC_BAD_PAYLOAD, `搜索查询不合法：${reason}`);
}

/** LIKE 通配符转义：\ % _ 前置反斜杠（回退通道专用——带 ESCAPE 的 LIKE 不走索引，A.4-11 已知形态） */
export function escapeLikePattern(term: string): string {
  // 字符类 [\%_\\] 含 \% 会触发 ESLint no-useless-escape，等价写作 [\\%_]（同一字符集）
  return `%${term.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
}

/** 词项 Unicode 码点数（M1 名称校验同口径：length 计 UTF-16 码元会双计增补平面） */
function codePoints(value: string): number {
  return [...value].length;
}

/**
 * 分词：引号外按空白切分；双引号段为短语（内部空格不分词）；
 * 引号内连续两个双引号为字面量引号（FTS5 短语惯例）；未闭合引号拒绝。
 * 前提（尾部无条件收尾的安全依据）：本函数为模块私有，唯一调用方 buildSearchQuery
 * 已保证入参为 trim 后非空串——started=false 仅在全空白输入下可能延续到循环结束，
 * 而该形态已被调用方拒绝；若前提被破坏，尾部将推入空串词项，由「存在空词项」校验兜底拒绝。
 */
function tokenize(input: string): string[] {
  const terms: string[] = [];
  let current = '';
  let started = false;
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    // charAt 越界返回空串且类型为 string（循环内 i 恒在界内），避免索引访问引入不可达分支
    const ch = input.charAt(i);
    if (!inQuotes) {
      if (/\s/.test(ch)) {
        if (started) {
          terms.push(current);
          current = '';
          started = false;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        started = true; // 空短语 "" 也置 started：产出空词项由空词项校验统一拒绝
        continue;
      }
      current += ch;
      started = true;
      continue;
    }
    if (ch === '"') {
      if (input[i + 1] === '"') {
        current += '"'; // 字面量引号（"" → "）
        i += 1;
        continue;
      }
      inQuotes = false; // 闭合短语
      continue;
    }
    current += ch;
  }
  if (inQuotes) reject('引号未闭合');
  // 前提（见函数头注释）保证 started 此处必为 true，无条件收尾以消除不可达分支
  terms.push(current);
  return terms;
}

/** MATCH 短语转义：内部 " 加倍（FTS5 字符串字面量规则） */
function quotePhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/**
 * 构造查询（spec §4 管线）：trim + NFC → 分词 → 词数/码点校验 → 通道选择。
 * 全词 ≥3 码点 → trigram 索引通道；任一词 <3 → 整条 LIKE 回退通道（保 AND 可组合，不承诺 P95）。
 * @param keyword 用户原始查询串（渲染端输入）
 * @throws AppError(E_IPC_BAD_PAYLOAD) 空 / 词数超 MAX_SEARCH_TERMS / 词项超
 *   MAX_SEARCH_TERM_CODEPOINTS 码点 / 引号未闭合 / 空短语（拒绝阈值引用 shared 契约常量，
 *   注释不硬编码数值——契约调整时本注释不漂移）
 */
export function buildSearchQuery(keyword: string): BuiltQuery {
  const normalized = keyword.normalize('NFC').trim();
  if (normalized === '') reject('空查询');
  const terms = tokenize(normalized);
  if (terms.length > MAX_SEARCH_TERMS) reject(`词项数超过上限 ${MAX_SEARCH_TERMS}`);
  for (const term of terms) {
    const length = codePoints(term);
    if (length === 0) reject('存在空词项（双引号空短语）');
    if (length > MAX_SEARCH_TERM_CODEPOINTS) {
      reject(`词项超过 ${MAX_SEARCH_TERM_CODEPOINTS} 码点上限`);
    }
  }
  const hasShort = terms.some((term) => codePoints(term) < TRIGRAM_MIN_CODEPOINTS);
  if (hasShort) {
    return { channel: 'like', terms, match: '', likePatterns: terms.map(escapeLikePattern) };
  }
  return {
    channel: 'trigram',
    terms,
    match: terms.map(quotePhrase).join(' AND '),
    likePatterns: [],
  };
}
