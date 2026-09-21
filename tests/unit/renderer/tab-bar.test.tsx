// @vitest-environment jsdom
// TabBar 冒烟（宪法 A.6-2 → M6 spec §2.4 图标化重制）：类型图标 + 文件名 + dirty 圆点 +
// 激活态 aria-current + 关闭钮回调；设置伪标签（settingsOpen）恒驻末位，激活/关闭回调
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
  it('渲染文件名与 dirty 圆点（aria-label「未保存」，无文字）、激活态 aria-current；点选与关闭回调', () => {
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
          settingsOpen={false}
          onActivate={onActivate}
          onClose={onClose}
          onActivateSettings={vi.fn()}
          onCloseSettings={vi.fn()}
        />,
      );
    });
    // [role="tab"] 选择器无 DOM 类型映射（返回 Element），显式收窄到按钮以驱动 click
    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabButtons).toHaveLength(2);
    const active = tabButtons.find((b) => b.getAttribute('aria-current') === 'true');
    expect(active?.textContent).toContain('b.css');
    // dirty 态以圆点承载（M6 spec §2.4，替代「未保存」文字），可访问名保留语义
    expect(active?.querySelector('[aria-label="未保存"]')).not.toBeNull();
    expect(tabButtons[0]?.querySelector('[aria-label="未保存"]')).toBeNull();
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

  it('设置伪标签（M6 spec §2.4）：settingsOpen 时恒驻末位，激活/关闭经专用回调', () => {
    const onActivateSettings = vi.fn();
    const onCloseSettings = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TabBar
          tabs={[{ meta: meta(2, 'a.html'), dirty: false }]}
          activeId="settings"
          settingsOpen
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onActivateSettings={onActivateSettings}
          onCloseSettings={onCloseSettings}
        />,
      );
    });
    const tabButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabButtons).toHaveLength(2);
    // 设置页签居末位且携带激活态；doc 页签无激活
    expect(tabButtons[1]?.textContent).toContain('设置');
    expect(tabButtons[1]?.getAttribute('aria-current')).toBe('true');
    expect(tabButtons[0]?.getAttribute('aria-current')).toBeNull();
    act(() => {
      tabButtons[1]?.click();
    });
    expect(onActivateSettings).toHaveBeenCalledTimes(1);
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
    });
    expect(onCloseSettings).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it('settingsOpen=false 不渲染设置页签（纯 doc 标签条）', () => {
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TabBar
          tabs={[{ meta: meta(2, 'a.html'), dirty: false }]}
          activeId={2}
          settingsOpen={false}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onActivateSettings={vi.fn()}
          onCloseSettings={vi.fn()}
        />,
      );
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(container.querySelector('button[aria-label="关闭设置"]')).toBeNull();
    tree.unmount();
  });
});
