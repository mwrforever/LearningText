/**
 * 最小单例 toast（M4 spec §5.5 D11）：右下角队列、同屏最多 3 条、3s 自动消退、
 * aria-live polite；模块级订阅器 + ToastHost 组件消费（避免每处操作传回调）。
 */
import { useEffect, useState } from 'react';

interface ToastItem {
  readonly id: number;
  readonly text: string;
}
type Listener = (items: readonly ToastItem[]) => void;
const listeners = new Set<Listener>();
let queue: readonly ToastItem[] = [];
let seq = 0;

/** 业务侧唯一入口（模块级单例）：入队 3s 自动消退，同屏最多 3 条（挤出最旧） */
export function showToast(text: string): void {
  seq += 1;
  const item: ToastItem = { id: seq, text };
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
          className="lt-toast pointer-events-auto rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-240 animate-in fade-in slide-in-from-bottom-2"
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
