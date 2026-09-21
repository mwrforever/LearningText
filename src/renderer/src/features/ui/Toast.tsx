/**
 * 最小单例 toast（M4 spec §5.5 D11）：右下角队列、同屏最多 3 条、3s 自动消退、
 * aria-live polite；模块级订阅器 + ToastHost 组件消费（避免每处操作传回调）。
 * 动作钮（M5 批次⑥ Task 13）：可选 action 携带「打开目录」类后续动作，随条目同生命周期。
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
}
type Listener = (items: readonly ToastItem[]) => void;
const listeners = new Set<Listener>();
let queue: readonly ToastItem[] = [];
let seq = 0;

/** 业务侧唯一入口（模块级单例）：入队 3s 自动消退，同屏最多 3 条（挤出最旧） */
export function showToast(text: string, action?: ToastAction): void {
  seq += 1;
  const item: ToastItem = { id: seq, text, action };
  queue = [...queue.slice(-2), item];
  for (const listener of listeners) listener(queue);
  setTimeout(() => {
    queue = queue.filter((t) => t.id !== item.id);
    for (const listener of listeners) listener(queue);
  }, 3000);
}

export function ToastHost(): React.JSX.Element {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  useEffect(() => {
    const listener: Listener = setItems;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    // 宿主定 right-bottom 悬浮、不拦截底层点击（pointer-events-none），单条恢复可交互；
    // 入场动效 240ms（fade + 底部轻位移，设计系统文档 §6.4），退场随 3s 摘除瞬时完成（D11 逻辑零变更）
    <div
      className="lt-toasts pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="lt-toast pointer-events-auto rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-240 animate-in fade-in slide-in-from-bottom-2 tabular-nums"
        >
          {item.text}
          {item.action !== undefined ? (
            <button
              type="button"
              className="ml-2 inline-flex h-5 items-center justify-center rounded-sm bg-primary px-2 font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90"
              onClick={item.action.onClick}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
