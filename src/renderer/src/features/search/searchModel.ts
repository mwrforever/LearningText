/**
 * 搜索结果展示模型（M5 批次① Task 7）：片段（纯文本 + UTF-16 码元命中区间）到展示态的
 * 纯函数换算——sliceWithHighlights 负责裁窗与区间平移（渲染层只按 spans 着色，不收 HTML），
 * 类型过滤映射把面板 select 三态翻译为 SearchFilters.nodeTypes。无 IO、无组件依赖。
 */

/** 平移后的高亮区间：展示文本内 UTF-16 码元偏移，[start, end) 半开（M2 契约同语义） */
export interface HighlightSpan {
  readonly start: number;
  readonly end: number;
}

/** 展示窗定义：首命中向前 before / 向后 after 码元 */
export interface HighlightWindow {
  readonly before: number;
  readonly after: number;
}

/** 默认展示窗 ±36 码元（brief 定值；与 LIKE 回退通道 ±36 上下文窗口同量级口径） */
export const SNIPPET_WINDOW: HighlightWindow = { before: 36, after: 36 };

/**
 * 全文窗：窗口计算永不裁剪（Infinity 参与运算后窗即 [0, len]）。名称片段服务端按
 * ≤255 码点全量提供（M2 契约「无需窗口化」），渲染端不得二次裁剪丢后缀
 */
export const FULL_TEXT_WINDOW: HighlightWindow = { before: Infinity, after: Infinity };

/**
 * 片段切片与高亮区间平移（纯函数）：按命中区间裁出展示窗（首命中 ±window 码元）并把
 * 窗内区间平移为展示文本内偏移，渲染层按 spans 着色（<mark> 或 span.className），零 HTML。
 *
 * 码元定档（İ 类展开字符，spec §2.3 展示级降级）：İ (U+0130) 等字符在服务层
 * toLowerCase() 定位链下 1→2 码元展开，可致命中区间 +1 偏移。本函数对 text 做 NFC 归一后
 * 再切片（对齐名称入库即 NFC、查询同法的归一口径），区间以 UTF-16 码元语义直用、不做码点
 * 级换算——展开字符导致的 ±1 偏移接受为展示级降级（高亮可能偏移一个码元，不崩溃、不串行），
 * 不追求码点完美对齐。
 *
 * @param text 片段纯文本（服务端产出，零 HTML）
 * @param ranges 命中区间（升序不保证重叠禁止——允许重叠/乱序，函数内防御性收敛）
 * @param window 展示窗（缺省 ±36 码元；名称片段传 FULL_TEXT_WINDOW 不裁窗）
 * @returns 展示文本（NFC 归一 + 切片）与平移后的高亮区间；无有效区间时返回全文 + 空 spans
 */
export function sliceWithHighlights(
  text: string,
  ranges: readonly { start: number; end: number }[],
  window: HighlightWindow = SNIPPET_WINDOW,
): { readonly text: string; readonly spans: HighlightSpan[] } {
  // NFC 归一先行（定档见函数头）：切片与区间均以归一后文本为展示基准
  const normalized = text.normalize('NFC');
  const length = normalized.length;
  // 区间钳制到 [0, length] 并丢弃空/畸形区间（越界钳制；end ≤ start 无高亮语义）
  const clamped = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, length)),
      end: Math.max(0, Math.min(range.end, length)),
    }))
    .filter((range) => range.end > range.start);
  if (clamped.length === 0) {
    return { text: normalized, spans: [] };
  }
  // 展示窗以首个有效区间为锚（区间按起点升序整理，乱序输入防御性排序）
  const ordered = [...clamped].sort((a, b) => a.start - b.start);
  // 收窄守卫（noUncheckedIndexedAccess）：上方已排除空集，逻辑不可达，仅满足下标访问判空
  const first = ordered[0];
  if (first === undefined) {
    return { text: normalized, spans: [] };
  }
  const windowStart = Math.max(0, first.start - window.before);
  let windowEnd = Math.min(length, first.end + window.after);
  // 多区间跨窗并集：与当前窗相交的后继区间把窗右沿扩至其终点（升序下单趟即闭合传递链），
  // 完全落在窗外的区间弃置——展示窗有界，远端命中不无限撑开窗体
  for (const range of ordered) {
    if (range.end <= windowStart) continue; // 整体在窗左沿之外，不可见
    if (range.start < windowEnd) {
      windowEnd = Math.min(length, Math.max(windowEnd, range.end));
    }
  }
  // 平移到展示文本坐标：与窗相交部分裁剪后减去窗左沿
  const spans = ordered
    .filter((range) => range.start < windowEnd && range.end > windowStart)
    .map((range) => ({
      start: Math.max(range.start, windowStart) - windowStart,
      end: Math.min(range.end, windowEnd) - windowStart,
    }));
  return { text: normalized.slice(windowStart, windowEnd), spans };
}

/** 面板类型过滤三态（spec §2.2：全部 / HTML / 目录） */
export type SearchTypeFilter = 'all' | 'file' | 'dir';

/**
 * 类型过滤 → SearchFilters.nodeTypes 映射（纯函数）：全部 = 双类型显式全量（schema min(1)
 * 合法面），HTML = 仅文件，目录 = 仅目录。switch 穷举 + never 兜底（宪法 A.1-4）
 */
export function nodeTypesForFilter(filter: SearchTypeFilter): readonly ('dir' | 'file')[] {
  switch (filter) {
    case 'all':
      return ['dir', 'file'];
    case 'file':
      return ['file'];
    case 'dir':
      return ['dir'];
    default: {
      const exhaustive: never = filter;
      throw new Error(`未知类型过滤态：${String(exhaustive)}`);
    }
  }
}
