// @vitest-environment jsdom
// 应用内确认弹窗契约（M8 反馈批次，取代原生 window.confirm）：形态锚点、确认/取消单一兑现、
// Esc 关闭面归取消、破坏性分级类串。锚点 `lt-confirm` / aria-label「确认操作」「取消操作」
// 为 E2E/组件测试共用锚，本文件与消费侧用例共同锁死。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../../src/renderer/src/features/ui/ConfirmDialog';

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  document.body.innerHTML = '';
});

/** 渲染确认弹窗（radix Portal 挂 document.body，断言与点击一律全文档寻址） */
function renderDialog(props: {
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReturnType<typeof createRoot> {
  const tree = createRoot(container);
  act(() => {
    tree.render(
      <ConfirmDialog
        title="彻底删除"
        description="彻底删除「a.html」？不可恢复"
        confirmLabel="彻底删除"
        destructive={props.destructive}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
      />,
    );
  });
  return tree;
}

function clickDialog(label: string): void {
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
}

describe('ConfirmDialog（应用内确认弹窗）', () => {
  it('呈现标题/说明/确认钮文案，取消项与确认项为独立可访问名锚点', () => {
    const tree = renderDialog({ onConfirm: vi.fn(), onCancel: vi.fn() });
    const dialog = document.querySelector('.lt-confirm');
    expect(dialog?.textContent).toContain('彻底删除');
    expect(dialog?.textContent).toContain('彻底删除「a.html」？不可恢复');
    expect(document.querySelector('button[aria-label="取消操作"]')?.textContent).toBe('取消');
    expect(document.querySelector('button[aria-label="确认操作"]')?.textContent).toBe('彻底删除');
    tree.unmount();
  });

  it('确认钮点击只兑现 onConfirm 一次：radix 关闭面不得把「确认」二次上报为「取消」', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = renderDialog({ onConfirm, onCancel });
    act(() => {
      clickDialog('确认操作');
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // 回归守卫：radix Action 点击后同样触发 onOpenChange(false)——无 confirmedRef 守卫时
    // 此处会再报一次取消，消费侧的不可逆动作入口会被污染
    expect(onCancel).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('取消钮点击只兑现 onCancel（不触发确认）', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = renderDialog({ onConfirm, onCancel });
    act(() => {
      clickDialog('取消操作');
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('Esc 关闭面归取消：不触发确认', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = renderDialog({ onConfirm, onCancel });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('破坏性分级：destructive 时确认钮走破坏色，非破坏性走主色（语义分级不混用）', () => {
    const tree = renderDialog({ destructive: true, onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(document.querySelector('button[aria-label="确认操作"]')?.className).toContain(
      'bg-destructive',
    );
    tree.unmount();
    const tree2 = renderDialog({ onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(document.querySelector('button[aria-label="确认操作"]')?.className).not.toContain(
      'bg-destructive',
    );
    tree2.unmount();
  });
});
