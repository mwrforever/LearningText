// @vitest-environment jsdom
// TabBar 冒烟（宪法 A.6-2）：文件名/dirty 圆点/激活态/关闭与激活回调（纯呈现无数据逻辑）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { TabBar } from '../../../src/renderer/src/features/workspace/TabBar';

function meta(id: number, name: string): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/html',
    size: 4,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  document.body.innerHTML = '';
});

describe('TabBar', () => {
  it('渲染文件名与 dirty 圆点、激活态 aria-current；点选触发 onActivate、关闭钮触发 onClose', () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TabBar
          tabs={[
            { meta: meta(2, 'a.html'), dirty: false },
            { meta: meta(3, 'b.css'), dirty: true },
          ]}
          activeId={3}
          onActivate={onActivate}
          onClose={onClose}
        />,
      );
    });
    // [role="tab"] 选择器无 DOM 类型映射（返回 Element），显式收窄到按钮以驱动 click
    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabButtons).toHaveLength(2);
    const active = tabButtons.find((b) => b.getAttribute('aria-current') === 'true');
    expect(active?.textContent).toContain('b.css');
    expect(active?.textContent).toContain('未保存'); // dirty 圆点文本替代（可访问性）
    act(() => {
      tabButtons[0]?.click();
    });
    expect(onActivate).toHaveBeenCalledWith(2);
    // 复合属性选择器无 DOM 类型映射（返回 Element），显式收窄到按钮以驱动 click
    const closeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="关闭标签"]'),
    );
    act(() => {
      closeButtons.find((b) => b.getAttribute('aria-label') === '关闭标签 b.css')?.click();
    });
    expect(onClose).toHaveBeenCalledWith(3);
    tree.unmount();
  });
});
