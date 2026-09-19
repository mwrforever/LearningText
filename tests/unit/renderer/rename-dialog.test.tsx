// @vitest-environment jsdom
// 重命名模态冒烟（M4 spec §6.2 D8）：预填当前名、确认回传新名（trim）、取消/空名不回传
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameDialog } from '../../../src/renderer/src/features/tree/RenameDialog';

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  document.body.innerHTML = '';
});

describe('RenameDialog', () => {
  it('预填当前名；修改后确认回传 trim 新名；空名确认不回传', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <RenameDialog
          nodeName="旧名.html"
          inFlight={false}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );
    });
    const input = container.querySelector('input');
    expect((input as HTMLInputElement | null)?.value).toBe('旧名.html');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '  新名.html  ');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="确认重命名"]`)?.click();
    });
    expect(onConfirm).toHaveBeenCalledWith('新名.html');
    act(() => {
      tree.render(
        <RenameDialog
          nodeName="旧名.html"
          inFlight={false}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );
    });
    const input2 = container.querySelector('input');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input2, '   ');
      input2?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="确认重命名"]`)?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1); // 空名不回传
    act(() => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="取消重命名"]`)?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
