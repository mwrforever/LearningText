// @vitest-environment jsdom
// PreviewPanel：src 初值/沙箱属性/订阅 cleanup；Workspace：启动装配（resolve+listChildren+settingsGet）
// 与广播→树刷新、stale 重取的接线（决策逻辑本体已在 Task 5 单测，此处验证 wiring 成对）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { NodeMeta, VfsChangedBroadcast } from '../../../src/shared/vfs-contract';
import { PreviewPanel } from '../../../src/renderer/src/features/preview/PreviewPanel';
import { ToastHost } from '../../../src/renderer/src/features/ui/Toast';
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
    // M4 契约补员：nodeId 反查（Task 8 rename/move 同步链）与 shell 命令订阅（Task 6 接线），
    // Workspace 本批挂载路径未调用，桩按契约形态预留（M3 最小注入先例的同批契约面）
    getNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x.html') })),
    onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
      // 退订函数为 vi.fn 桩，卸载后可断言 cleanup 确实调用（同 onVfsChanged 强化先例）
      const unsub = vi.fn(() => {
        void callback;
      });
      unsubscribes.push(unsub);
      return unsub;
    }),
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
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
    // 未选中文件占位现由 EditorPanel 空态承载（M4 起 activeTab 恒空的过渡桥已被会话中枢取代）
    expect(container.textContent).toContain('未选中文件');
    act(() => {
      tree.unmount();
    });
  });
});

describe('Workspace 多标签会话中枢（M4 Task 4）', () => {
  afterEach(() => {
    vi.useRealTimers(); // toast 消退用例切假时钟，逐用例还原防泄漏到相邻用例
  });

  it('二进制文件前置拦截：toast 呈现拒开原因且 3s 自动消退，不读库不开标签', async () => {
    vi.useFakeTimers();
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'pic.png'), mimeType: 'image/png' }],
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    // ToastHost 与 Workspace 同容器装配（App.tsx 同款结构），toast 文案断言才有 DOM 落点
    await act(async () => {
      tree.render(
        <>
          <Workspace />
          <ToastHost />
        </>,
      );
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'pic.png')
        ?.click();
    });
    expect(api.readFile).not.toHaveBeenCalled(); // 前置拦截在读库之前
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.textContent).toContain('二进制文件暂不支持编辑');
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).not.toContain('二进制文件暂不支持编辑'); // 3s 消退（spec §5.5）
    act(() => {
      tree.unmount();
    });
  });

  it('点选文本文件开标签：TabBar 激活态、树选中联动、CM 会话就绪与预览命中', async () => {
    const api = stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: meta(3, 'a.html') },
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(api.readFile).toHaveBeenCalledWith({ nodeId: 3 });
    // TabBar 出现且 a.html 激活（aria-current）
    const activeTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (b) => b.getAttribute('aria-current') === 'true',
    );
    expect(activeTab?.textContent).toBe('a.html');
    // 树选中由 activeTab 派生（selected 概念已被取代）
    const treeFileBtn = Array.from(
      container.querySelectorAll('nav[aria-label="资源树"] button'),
    ).find((b) => b.textContent === 'a.html');
    expect(treeFileBtn?.getAttribute('aria-current')).toBe('true');
    // CM 会话就绪且文档为 BLOB 解码文本；预览命中激活标签 meta
    expect(container.querySelector('.cm-content')?.textContent).toBe('<p>正文</p>');
    expect(container.querySelector('iframe')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('逐个关标签：激活补位左邻、全关回空态、会话随标签关闭（重开重读库）', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [meta(3, 'a.html'), { ...meta(4, 'b.css'), mimeType: 'text/css' }],
        }),
      ),
      readFile: vi.fn((request: { nodeId: number }) =>
        Promise.resolve({
          ok: true,
          value: {
            content: new TextEncoder().encode(request.nodeId === 3 ? '甲' : '乙'),
            meta:
              request.nodeId === 3
                ? meta(3, 'a.html')
                : { ...meta(4, 'b.css'), mimeType: 'text/css' },
          },
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'b.css')
        ?.click();
    });
    expect(api.readFile).toHaveBeenCalledTimes(2);
    const tabs = () => Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs()).toHaveLength(2);
    // 关闭激活的 b.css：右邻无 → 左邻 a.html 补位，编辑区随 activeTab 换入 a 的会话文档
    const closeB = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭标签 b.css"]',
    );
    await act(async () => {
      closeB?.click();
    });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]?.getAttribute('aria-current')).toBe('true');
    expect(tabs()[0]?.textContent).toBe('a.html');
    expect(container.querySelector('.cm-content')?.textContent).toBe('甲');
    // 全关：编辑/预览回空态占位，TabBar 摘除
    const closeA = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭标签 a.html"]',
    );
    await act(async () => {
      closeA?.click();
    });
    expect(tabs()).toHaveLength(0);
    expect(container.textContent).toContain('未选中文件');
    expect(container.querySelector('iframe')).toBeNull();
    // 会话已随标签关闭（而非仅视图摘除）：重开同文件必须重新读库建会话
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(api.readFile).toHaveBeenCalledTimes(3);
    act(() => {
      tree.unmount();
    });
  });

  it('删除已开标签的节点：trash 成功后标签与会话同收、编辑区回空态', async () => {
    const api = stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('甲'), meta: meta(3, 'a.html') },
        }),
      ),
    }) as unknown as { trashNode: ReturnType<typeof vi.fn>; readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    // 树工具栏删除钮以当前激活（=选中）为目标
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === '删除')
        ?.click();
    });
    expect(api.trashNode).toHaveBeenCalledWith({ nodeId: 3 });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.textContent).toContain('未选中文件');
    // 会话同收证据：重开必须重新读库
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(api.readFile).toHaveBeenCalledTimes(2);
    act(() => {
      tree.unmount();
    });
  });
});
