/**
 * 最小单例 toast（M4 spec §5.5 D11）：右下角队列、同屏最多 3 条、3s 自动消退、
 * aria-live polite；模块级订阅器 + ToastHost 组件消费（避免每处操作传回调）。
 * 动作钮（M5 批次⑥ Task 13）：可选 action 携带「打开目录」类后续动作，随条目同生命周期。
 * 退场动效（M8 动效批次）：3s 到期或手动关闭一律先播 240ms 退场（leaving 标记）再摘除，
 * 形态与进度面板退场同源（见 ioProgressPresence 的 PROGRESS_EXIT_MS 惯例）。
 */
import { useEffect, useState } from 'react';

/** 条目可选动作：label 为钮文案，onClick 为点击回调（如 openPath 打开导出目录） */
export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

interface ToastItem {
  readonly id: number;
  readonly text: string;
  readonly action?: ToastAction;
  /** 是否处于退场播放期：true 时挂退场类串（含 pointer-events-none，防误点动作钮） */
  readonly leaving: boolean;
}
type Listener = (items: readonly ToastItem[]) => void;
const listeners = new Set<Listener>();
let queue: readonly ToastItem[] = [];
let seq = 0;

/** 自动消退倒计时（毫秒）：到期只进入退场播放（挂 leaving 标记），不直接摘除 */
const TOAST_AUTO_DISMISS_MS = 3000;

/**
 * 退场播放时长（毫秒）：与退场类串 `duration-240` 同源——Tailwind JIT 需字面类名，调整时长
 * 必须本常量与类串两处同步修改（同 ioProgressPresence 的 PROGRESS_EXIT_MS 惯例）；240ms 与
 * 入场对称，退场播完才真正摘除。
 */
export const TOAST_EXIT_MS = 240;

/** 条目基础形态类串（视觉与结构，与动效无关）：leaving 切换时不重复的部分 */
const TOAST_BASE_CLASSES =
  'lt-toast rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md tabular-nums';

/**
 * 入场类串：240ms 淡入 + 底部轻位移（设计系统文档 §6.4）；animate-in 的动画简写不读
 * theme.css 的全局缓动基线（只认 var(--tw-ease, ease)），入场必须显式补 ease-out。
 * pointer-events-auto：宿主容器 pointer-events-none，单条恢复可交互。
 */
const TOAST_ENTER_CLASSES =
  'pointer-events-auto duration-240 ease-out animate-in fade-in slide-in-from-bottom-2';

/**
 * 退场类串：240ms 淡出 + 底部滑出（出场缓动 ease-in，设计系统文档 §6.1）；pointer-events-none
 * 防退场播放期（240ms）误点动作钮；duration-240 与 TOAST_EXIT_MS 计时同源——Tailwind JIT 需
 * 字面类名，调整时长必须两处同步修改（与 Workspace 的 PROGRESS_EXIT_CLASSES 同款形态）。
 * `fill-mode-forwards` 为 reduced-motion 兜底：全局把动画压到 0.01ms 时，fill-mode none 的
 * 动画结束后会回到基础值（toast「闪回不透明 + 滞留一个退场时长」），forwards 令终态保持
 */
const TOAST_EXIT_CLASSES =
  'pointer-events-none duration-240 ease-in animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards';

/**
 * 在途计时器登记表（条目 id → 计时器句柄）：自动消退计时与退场计时一律登记在案，条目离队
 * （被挤出 / 退场播完摘除）时统一清理，杜绝悬挂计时器。计时器归属条目而非宿主组件——宿主
 * 卸载只摘订阅器（见 ToastHost 的 effect cleanup），队列与计时在模块级单例上继续推进，
 * 因此不存在对已卸载组件的 setState。
 */
const timers = new Map<number, ReturnType<typeof setTimeout>[]>();

/** 登记条目在途计时器（与 clearTimers 配对，保证条目离队时全部句柄可回收） */
function trackTimer(id: number, handle: ReturnType<typeof setTimeout>): void {
  const handles = timers.get(id);
  if (handles === undefined) timers.set(id, [handle]);
  else handles.push(handle);
}

/** 清除并注销某条目的全部在途计时器：条目离队时调用，防计时器回调迟到触碰已离队条目 */
function clearTimers(id: number): void {
  const handles = timers.get(id);
  if (handles === undefined) return;
  for (const handle of handles) clearTimeout(handle);
  timers.delete(id);
}

/** 广播当前队列：无订阅者（宿主未挂载 / 已卸载）时为空转，不会触发已卸载组件的 setState */
function publish(): void {
  for (const listener of listeners) listener(queue);
}

/**
 * 摘除条目（队列唯一摘除点）：清计时器后从队列剔除并广播；id 已不在队列时幂等返回。
 * 仅由 beginDismiss 的退场计时器调用——任何摘除之前必先播完退场。
 */
function removeItem(id: number): void {
  if (!queue.some((t) => t.id === id)) return;
  clearTimers(id);
  queue = queue.filter((t) => t.id !== id);
  publish();
}

/**
 * 开始退场（**唯一退场入口**）：3s 自动消退与手动关闭（动作钮点击后）都必须经此，
 * 保证「先播退场再摘除」不存在瞬时消失的分裂路径。挂 leaving 标记触发重渲染挂退场类串，
 * TOAST_EXIT_MS 播完后经 removeItem 摘除。
 * 幂等：id 已离队或已在退场播放中直接返回，重复调用不会叠加退场计时器。
 *
 * @param id 目标条目 id（模块内自增序号，非业务节点 id）；不存在时静默返回
 */
function beginDismiss(id: number): void {
  const target = queue.find((t) => t.id === id);
  if (target === undefined || target.leaving) return;
  // 撤销在途自动消退计时：手动关闭早于 3s 时防其迟到再触发一次退场（幂等护栏之外的双保险）
  clearTimers(id);
  queue = queue.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  publish();
  trackTimer(
    id,
    setTimeout(() => {
      removeItem(id);
    }, TOAST_EXIT_MS),
  );
}

/** 业务侧唯一入口（模块级单例）：入队 3s 后进入退场、退场播完摘除；同屏最多 3 条（挤出最旧） */
export function showToast(text: string, action?: ToastAction): void {
  seq += 1;
  const item: ToastItem = { id: seq, text, action, leaving: false };
  // 队列上限与去重行为零变更：仅保留最近 2 条再追加新条；被挤出的最旧条目连同其在途计时器
  // 一并清理（退场播放中被挤出同样适用），防其计时器回调迟到触碰已离队条目
  for (const evicted of queue.slice(0, Math.max(0, queue.length - 2))) clearTimers(evicted.id);
  queue = [...queue.slice(-2), item];
  publish();
  trackTimer(
    item.id,
    setTimeout(() => {
      beginDismiss(item.id);
    }, TOAST_AUTO_DISMISS_MS),
  );
}

export function ToastHost(): React.JSX.Element {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  useEffect(() => {
    const listener: Listener = setItems;
    listeners.add(listener);
    return () => {
      // 卸载即摘订阅器：此后模块级广播不再触达本组件（无对已卸载组件的 setState）
      listeners.delete(listener);
    };
  }, []);
  return (
    // 宿主定 right-bottom 悬浮、不拦截底层点击（pointer-events-none），单条恢复可交互；
    // 入场 240ms（fade + 底部轻位移，设计系统文档 §6.4）、退场 240ms（ease-in 底部滑出，M8 批次）
    <div
      className="lt-toasts pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`${TOAST_BASE_CLASSES} ${item.leaving ? TOAST_EXIT_CLASSES : TOAST_ENTER_CLASSES}`}
        >
          {item.text}
          {item.action !== undefined ? (
            <button
              type="button"
              className="ml-2 inline-flex h-5 items-center justify-center rounded-sm bg-primary px-2 font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90"
              onClick={() => {
                // 动作执行 + 本条退场：用户已对提示做出响应，无需再等满 3s（与关闭钮同语义，
                // 退场仍走 beginDismiss，不出现瞬时消失的分裂路径）
                item.action?.onClick();
                beginDismiss(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
