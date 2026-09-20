/**
 * 滚动同步纯函数（M5 批次⑤ Task 11，FR-RENDER-06；协议为 M3 spec §7.2 既定设计）：
 * ratioFromScroll / offsetFromRatio / shouldSuppressReport 三函数承载滚动数学与回环
 * 抑制窗口（M5 spec §6 裁决 D13），组件侧只做接线不做换算；滚动同步消息的形态建模与
 * 子→父消息的收窄守卫也集中于此（window message 为无 schema 外部输入——宪法 A.1-5
 * 禁断言，parseScrollReport 逐字段 typeof 校验收窄）。
 *
 * 抑制链路时序（D13，父侧控制、子端只上报）：编辑器滚动 → 节流上报比例（父侧盖章）→
 * 预览 scrollTo 产生回响 report → 落入 150ms 抑制窗被静默；反向同理（编辑器应用锚点
 * 滚动即盖章），双向均收敛、不死循环。
 */

/** 父→子消息（M3 spec §7.2）：按比例滚动预览；'*' targetOrigin（opaque origin 下唯一通道，同 css-swap 先例） */
export interface ScrollRatioMessage {
  readonly type: 'lt:scroll-ratio';
  readonly ratio: number;
}

/** 子→父消息（M3 spec §7.2）：滚动比例 + 可视首行文本锚点快照（渲染文本与编辑器源文按字面子串对齐） */
export interface ScrollReportMessage {
  readonly type: 'lt:scroll-report';
  readonly ratio: number;
  readonly anchorText: string;
}

/**
 * 由编辑器滚动几何换算 0–1 滚动比例（可滚动量占比）。
 * @param scrollTop 当前滚动偏移（px，来源：CM scrollDOM / 预览 window 的实时读数）
 * @param clientHeight 视口高（px）
 * @param scrollHeight 内容总高（px）
 * @returns 0–1 钳制后的比例；scrollHeight<=clientHeight（内容不足一屏）返 0
 */
export function ratioFromScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): number {
  const maxScroll = scrollHeight - clientHeight;
  // 无可滚动量（零高/内容不足一屏）：任何偏移都视作顶部
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, scrollTop / maxScroll));
}

/**
 * 由比例反向换算目标 scrollTop（父→子下行滚动的落地值）。
 * @param ratio 0–1 滚动比例（越界入参按边界钳制，容错收窄）
 * @param clientHeight 视口高（px）
 * @param scrollHeight 内容总高（px）
 * @returns 目标 scrollTop（px）；零高容错——scrollHeight<=clientHeight 时恒返 0
 */
export function offsetFromRatio(ratio: number, clientHeight: number, scrollHeight: number): number {
  const maxScroll = scrollHeight - clientHeight;
  // 零高容错：无可滚动量时任何比例都落 0
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, ratio)) * maxScroll;
}

/**
 * 回环抑制判定（D13）：now 距上次同步盖章时刻未满窗口期即抑制（当前报告视为自身上报
 * 引发的回响，静默忽略）。
 * @param lastSyncAt 上次同步盖章时刻（ms 时间戳；「从未同步」由调用方以 -Infinity 表达）
 * @param now 当前时刻（ms 时间戳，调用方取值注入）
 * @param windowMs 抑制窗长（ms，默认 150）
 * @returns true = 应抑制本次报告；窗满（now-lastSyncAt >= windowMs）返回 false 放行。
 *          now 早于 lastSyncAt（时钟回拨/未来盖章）视作刚同步而抑制
 */
export function shouldSuppressReport(lastSyncAt: number, now: number, windowMs = 150): boolean {
  return now - lastSyncAt < windowMs;
}

/**
 * 子→父滚动报告消息收窄守卫（PreviewPanel window message 事件唯一入口）：形态合法才
 * 放行——type 字面量相符、ratio 为有限数值（NaN/Infinity 拒收，防下游 scrollTo 落 NaN）、
 * anchorText 为字符串。
 * @param data message 事件的原始 data（外部输入，形态未知）
 * @returns 合法的 ScrollReportMessage；任何字段不符返回 null（调用方静默忽略）
 */
export function parseScrollReport(data: unknown): ScrollReportMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  if (!('type' in data) || !('ratio' in data) || !('anchorText' in data)) return null;
  const { type, ratio, anchorText } = data;
  if (type !== 'lt:scroll-report') return null;
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  if (typeof anchorText !== 'string') return null;
  return { type, ratio, anchorText };
}
