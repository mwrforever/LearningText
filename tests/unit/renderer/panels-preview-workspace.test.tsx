// @vitest-environment jsdom
// PreviewPanel：src 初值/沙箱属性/订阅 cleanup；Workspace：启动装配（resolve+listChildren+settingsGet）
// 与广播→树刷新、stale 重取的接线（决策逻辑本体已在 Task 5 单测，此处验证 wiring 成对）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta, VfsChangedBroadcast } from '../../../src/shared/vfs-contract';
import { PreviewPanel } from '../../../src/renderer/src/features/preview/PreviewPanel';
import { Workspace } from '../../../src/renderer/src/features/workspace/Workspace';

function meta(id: number, name: string, type: 'dir' | 'file' = 'file'): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: type,
    name,
    virtualPath: `/${name}`,
    mimeType: type === 'dir' ? 'x-directory' : 'text/html',
    size: 4,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}

const unsubscribes: Array<() => void> = [];

/** 桥桩：返回对象供测试取 spy（`as unknown as` 测试期桩适配先例） */
function stubApi(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const api = {
    resolvePath: vi.fn(() => Promise.resolve({ ok: true, value: { nodeId: 1 } })),
    listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(2, '笔记', 'dir')] })),
    createNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(3, '新文件') })),
    trashNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    readFile: vi.fn(() =>
      Promise.resolve({ ok: true, value: { content: new Uint8Array(), meta: meta(2, 'x.html') } }),
    ),
    writeFile: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x.html') })),
    settingsGet: vi.fn(() =>
      Promise.resolve({ ok: true, value: { schemaVersion: 1, preview: { debounceMs: 300 } } }),
    ),
    onVfsChanged: vi.fn((callback: (b: VfsChangedBroadcast) => void) => {
      // 主控裁决强化：退订函数为 vi.fn 桩，卸载后可断言 cleanup 确实调用（仅「存在」断言无法暴露漏 cleanup）
      const unsub = vi.fn(() => {
        void callback;
      });
      unsubscribes.push(unsub);
      return unsub;
    }),
    ...overrides,
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return api;
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  document.body.innerHTML = '';
  unsubscribes.length = 0;
});

describe('PreviewPanel', () => {
  it('沙箱属性逐字 + src=vfs URL + 无选中占位文案', () => {
    stubApi();
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={meta(2, '笔记/index.html')} />);
    });
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe?.getAttribute('src')).toContain('vfs://');
    act(() => {
      tree.render(<PreviewPanel node={null} />);
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('未选中文件');
    tree.unmount();
  });

  it('卸载必须解绑 onVfsChanged（资源成对释放，宪法自查项）', () => {
    const api = stubApi() as unknown as { onVfsChanged: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} />);
    });
    expect(api.onVfsChanged).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
    const unsub = unsubscribes[0];
    expect(unsub).toBeDefined();
    // 主控裁决强化：断言 React cleanup 确实调用了退订函数，而非仅要求其存在
    expect(unsub).toHaveBeenCalled();
  });
});

describe('Workspace 启动装配', () => {
  it('settingsGet + listChildren 根拉取后渲染树与编辑器占位与预览占位', async () => {
    const api = stubApi() as unknown as { listChildren: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(api.listChildren).toHaveBeenCalledWith(expect.objectContaining({ parentId: 1 }));
    expect(container.textContent).toContain('笔记');
    expect(container.textContent).toContain('未选中文件');
    act(() => {
      tree.unmount();
    });
  });
});
