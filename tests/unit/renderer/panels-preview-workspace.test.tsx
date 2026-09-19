// @vitest-environment jsdom
// PreviewPanel：src 初值/沙箱属性/订阅 cleanup；Workspace：启动装配（resolve+listChildren+settingsGet）
// 与广播→树刷新、stale 重取的接线（决策逻辑本体已在 Task 5 单测，此处验证 wiring 成对）
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { NodeMeta, VfsChangedBroadcast } from '../../../src/shared/vfs-contract';
import { PreviewPanel } from '../../../src/renderer/src/features/preview/PreviewPanel';
import { ToastHost } from '../../../src/renderer/src/features/ui/Toast';
import { MAX_TABS } from '../../../src/renderer/src/features/workspace/tabModel';
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
    // M4 契约补员：nodeId 反查（Task 8 rename/move 同步链）为后续挂载路径预留；
    // shell 命令订阅/forceClose 已入挂载路径（Task 6 外壳命令链），桩按契约形态注入
    getNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x.html') })),
    forceClose: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
      // 退订函数为 vi.fn 桩，卸载后可断言 cleanup 确实调用（同 onVfsChanged 强化先例）
      const unsub = vi.fn(() => {
        void callback;
      });
      unsubscribes.push(unsub);
      return unsub;
    }),
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    settingsSet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
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

/** 桩 + 捕获 onVfsChanged 订阅回调（供逐事件 dispatch 驱动广播消费链路：占位态/css 热替换/meta 同步） */
function stubApiCaptureVfs(overrides: Partial<Record<string, unknown>> = {}): {
  api: Record<string, ReturnType<typeof vi.fn>>;
  vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
} {
  const vfsHandlers: Array<(b: VfsChangedBroadcast) => void> = [];
  const api = stubApi({
    onVfsChanged: vi.fn((callback: (b: VfsChangedBroadcast) => void) => {
      vfsHandlers.push(callback);
      return vi.fn();
    }),
    ...overrides,
  }) as Record<string, ReturnType<typeof vi.fn>>;
  return { api, vfsHandlers };
}

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

  it('订阅挂载期一次：node 变化不退订重订（终审 M-4 收口，消丢广播微窗口）', async () => {
    const api = stubApi() as unknown as { onVfsChanged: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} />);
    });
    await act(async () => {
      tree.render(<PreviewPanel node={meta(3, 'b.html')} />);
    });
    await act(async () => {
      tree.render(<PreviewPanel node={null} />);
    });
    expect(api.onVfsChanged).toHaveBeenCalledTimes(1); // 依赖恒空，不随 node 重建
    act(() => {
      tree.unmount();
    });
  });

  it('written 命中当前节点且 getNode 反查失败 → 「文档不可用」占位；切节点复位', async () => {
    const { vfsHandlers } = stubApiCaptureVfs({
      getNode: vi.fn(() =>
        Promise.resolve({ ok: false, error: { code: 'E_VFS_NOT_FOUND', message: '节点不存在' } }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} />);
    });
    expect(container.querySelector('iframe')).not.toBeNull();
    await act(async () => {
      vfsHandlers[0]?.({ rev: 1, event: { type: 'written', node: meta(2, 'a.html') } });
    });
    // 反查失败：iframe 摘除、占位态呈现（不重载旧路径，spec §6.1）
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('文档不可用');
    // 切节点即复位：占位态属上一节点的不可用事实，不沾染后续节点
    await act(async () => {
      tree.render(<PreviewPanel node={meta(3, 'b.html')} />);
    });
    expect(container.textContent).not.toContain('文档不可用');
    expect(container.querySelector('iframe')).not.toBeNull();
    tree.unmount();
  });

  it('written 命中当前节点且反查成功 → 不落占位，刷新链继续（iframe 保持）', async () => {
    const { vfsHandlers } = stubApiCaptureVfs({
      getNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'a.html') })),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} />);
    });
    await act(async () => {
      vfsHandlers[0]?.({ rev: 1, event: { type: 'written', node: meta(2, 'a.html') } });
    });
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.textContent).not.toContain('文档不可用');
    tree.unmount();
  });

  it('written 为 text/css 且非当前节点 → fetch 拉新文本 postMessage 触发热替换（载荷含 path/text）', async () => {
    const { vfsHandlers } = stubApiCaptureVfs();
    const fetchStub = vi.fn(() =>
      Promise.resolve({ text: () => Promise.resolve('body{color:red}') }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} />);
    });
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.contentWindow).not.toBeNull();
    // jsdom iframe 内容窗 postMessage 探针（测试期桩适配，先例同 stubApi 的 as 注释）
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    await act(async () => {
      vfsHandlers[0]?.({
        rev: 1,
        event: { type: 'written', node: { ...meta(5, 'style.css'), mimeType: 'text/css' } },
      });
    });
    expect(fetchStub).toHaveBeenCalledWith('vfs://local/style.css');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'lt:css-swap', path: '/style.css', text: 'body{color:red}' },
      '*',
    );
    vi.unstubAllGlobals();
    tree.unmount();
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

// 外壳命令 dispatch + 关窗确认链（M4 Task 6，spec §2.3/§5.2）：命令经 onShellCommand
// 订阅回调驱动（E2E 归 Task 10，此处单测断言 handler 行为）
describe('Workspace 外壳命令链（M4 Task 6）', () => {
  interface ShellCapture {
    api: Record<string, ReturnType<typeof vi.fn>>;
    handlers: Array<(command: ShellCommand) => void>;
    unsub: ReturnType<typeof vi.fn>;
  }

  /** 捕获 onShellCommand 订阅回调（供逐命令 dispatch）与退订桩（cleanup 断言） */
  function captureShell(overrides: Partial<Record<string, unknown>> = {}): ShellCapture {
    const handlers: Array<(command: ShellCommand) => void> = [];
    const unsub = vi.fn();
    const api = stubApi({
      onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
        handlers.push(callback);
        return unsub;
      }),
      ...overrides,
    }) as Record<string, ReturnType<typeof vi.fn>>;
    return { api, handlers, unsub };
  }

  /** jsdom 无真实键入：CM6 官方静态 API findFromDOM 取视图实例（editor-panel 同款先例） */
  function mountedView(root: HTMLElement): EditorView | null {
    const editorDom = root.querySelector<HTMLDivElement>('.cm-editor');
    return editorDom === null ? null : EditorView.findFromDOM(editorDom);
  }

  /** 按文本找按钮并点击（树点选/工具栏共用助手） */
  async function clickButton(text: string): Promise<void> {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === text)
        ?.click();
    });
  }

  it('订阅 cleanup 成对：卸载必调用退订函数（宪法资源纪律）', async () => {
    const { api, unsub } = captureShell();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(api.onShellCommand).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
    expect(unsub).toHaveBeenCalled();
  });

  it('save 命令 → flushActive 立即写激活标签（不等尾沿去抖）', async () => {
    const { api, handlers } = captureShell({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode(''), meta: meta(3, 'a.html') },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickButton('a.html');
    const view = mountedView(container);
    expect(view).not.toBeNull();
    await act(async () => {
      view?.dispatch({ changes: { from: 0, insert: '甲' } });
    });
    // 去抖窗口（300ms）远未到期：此刻不应有写发生，证明写确由 save 命令触发
    expect(api.writeFile).not.toHaveBeenCalled();
    await act(async () => {
      handlers[0]?.({ type: 'save' });
    });
    expect(api.writeFile).toHaveBeenCalledWith({
      nodeId: 3,
      content: new TextEncoder().encode('甲'),
    });
    act(() => {
      tree.unmount();
    });
  });

  it('confirm-close 无脏直接 forceClose，不弹确认框', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const { api, handlers } = captureShell();
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<Workspace />);
      });
      await act(async () => {
        handlers[0]?.({ type: 'confirm-close' });
      });
      expect(api.forceClose).toHaveBeenCalledTimes(1);
      expect(confirmSpy).not.toHaveBeenCalled();
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('confirm-close 有脏弹确认框：取消留在应用、确认后放行 forceClose', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const { api, handlers } = captureShell({
        listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
        readFile: vi.fn(() =>
          Promise.resolve({
            ok: true,
            value: { content: new TextEncoder().encode(''), meta: meta(3, 'a.html') },
          }),
        ),
      });
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<Workspace />);
      });
      await clickButton('a.html');
      await act(async () => {
        mountedView(container)?.dispatch({ changes: { from: 0, insert: '甲' } });
      });
      // 取消分支：确认框出现但拒绝 → 不放行
      await act(async () => {
        handlers[0]?.({ type: 'confirm-close' });
      });
      expect(confirmSpy).toHaveBeenCalledWith('有未保存的更改，确定退出？');
      expect(api.forceClose).not.toHaveBeenCalled();
      // 确认分支：再次 confirm-close，用户确认 → 放行
      confirmSpy.mockReturnValue(true);
      await act(async () => {
        handlers[0]?.({ type: 'confirm-close' });
      });
      expect(api.forceClose).toHaveBeenCalledTimes(1);
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('new-file/new-dir 命令 → 根目录新建；new-file 创建即开标签、new-dir 不开', async () => {
    const { api, handlers } = captureShell();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      handlers[0]?.({ type: 'new-dir' });
    });
    expect(api.createNode).toHaveBeenCalledWith({
      parentId: 1,
      name: '新建目录',
      nodeType: 'dir',
    });
    await act(async () => {
      handlers[0]?.({ type: 'new-file' });
    });
    expect(api.createNode).toHaveBeenCalledWith({
      parentId: 1,
      name: '新建文件.html',
      nodeType: 'file',
    });
    // 创建即开标签回路（onCreate 同款语义）：读库建会话 + 标签呈现
    expect(api.readFile).toHaveBeenCalledWith({ nodeId: 3 });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    act(() => {
      tree.unmount();
    });
  });

  it('MAX_TABS 触顶：toast 提示先关且不开标签；释放槽位后可再开（无悬挂会话）', async () => {
    const files = Array.from({ length: MAX_TABS + 1 }, (_, i) => ({
      ...meta(10 + i, `f${i}.html`),
      mimeType: 'text/plain',
    }));
    const api = stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: files })),
      readFile: vi.fn((request: { nodeId: number }) =>
        Promise.resolve({
          ok: true,
          value: {
            content: new TextEncoder().encode('文'),
            meta: files.find((f) => f.id === request.nodeId) ?? files[0],
          },
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(
        <>
          <Workspace />
          <ToastHost />
        </>,
      );
    });
    // 依次开满 20 个标签
    for (let i = 0; i < MAX_TABS; i += 1) {
      await clickButton(`f${i}.html`);
    }
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(MAX_TABS);
    expect(api.readFile).toHaveBeenCalledTimes(MAX_TABS);
    // 触顶再点第 21 个：toast 拒开、标签数不变（超限提示先关，spec §3）
    await clickButton(`f${MAX_TABS}.html`);
    expect(container.textContent).toContain(`最多同时打开 ${MAX_TABS} 个标签，请先关闭部分标签`);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(MAX_TABS);
    expect(api.readFile).toHaveBeenCalledTimes(MAX_TABS + 1); // 判定在 readFile 回调内：读库发生但不开标签
    // 释放一个槽位后再点：正常开签（触顶尝试未残留孤儿会话，回路完整）
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭标签 f0.html"]')?.click();
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(MAX_TABS - 1);
    await clickButton(`f${MAX_TABS}.html`);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(MAX_TABS);
    const active = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (b) => b.getAttribute('aria-current') === 'true',
    );
    expect(active?.textContent).toBe(`f${MAX_TABS}.html`);
    act(() => {
      tree.unmount();
    });
  });
});

// 三栏折叠与布局记忆（M4 Task 7，FR-SHELL-01）：折叠/展开经 aria-label 锚点驱动，
// 折叠态经折叠类名与内联样式断言（jsdom 无布局引擎，不碰 getBoundingClientRect 实测值；
// 拖拽几何换算本体已在 layoutModel 纯函数单测覆盖，此处只验接线）
describe('Workspace 三栏折叠与布局记忆（M4 Task 7）', () => {
  /** 按 aria-label 找钮点击（折叠/展开钮无文本语义，统一走可访问名锚点） */
  async function clickAriaLabel(label: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    });
  }

  it('折叠树栏：容器带折叠类、窄条展开钮反向出现；settingsSet 以 get→merge→set 全量写回 shell.layout', async () => {
    const api = stubApi() as unknown as { settingsSet: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickAriaLabel('折叠树栏');
    const treePane = container.querySelector('.lt-pane-tree');
    expect(treePane?.classList.contains('lt-pane-collapsed')).toBe(true);
    expect(container.querySelector('button[aria-label="展开树栏"]')).not.toBeNull();
    // 全量写回语义：get 到的设置原样保留 preview/editor 域，仅 shell.layout 换为折叠态
    expect(api.settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      shell: { layout: { ...DEFAULT_LAYOUT, treeCollapsed: true } },
    });
    // 反向展开：折叠类摘除、窄条展开钮消失
    await clickAriaLabel('展开树栏');
    expect(container.querySelector('.lt-pane-tree')?.classList.contains('lt-pane-collapsed')).toBe(
      false,
    );
    expect(container.querySelector('button[aria-label="展开树栏"]')).toBeNull();
    expect(api.settingsSet).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      shell: { layout: { ...DEFAULT_LAYOUT, treeCollapsed: false } },
    });
    act(() => {
      tree.unmount();
    });
  });

  it('折叠编辑器：容器隐藏（display:none + 折叠类）但 EditorPanel 保持挂载，保存态照常呈现', async () => {
    stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: meta(3, 'a.html') },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    // 先开标签让 CM 会话就绪：编辑器折叠后视图 DOM 必须仍在（保存管线照常的结构前提）
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    await clickAriaLabel('折叠编辑器');
    const editorPane = container.querySelector<HTMLElement>('.lt-pane-editor');
    expect(editorPane?.classList.contains('lt-pane-collapsed')).toBe(true);
    expect(editorPane?.style.display).toBe('none');
    // 保持挂载证据：CM 视图与保存态文案仍在 DOM（容器隐藏非卸载，spec §5.1）
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.lt-editor-bar')?.textContent).toContain('已保存');
    // 展开回显：隐藏样式摘除、视图无重挂（doc 无损的结构面）
    await clickAriaLabel('展开编辑器');
    expect(container.querySelector<HTMLElement>('.lt-pane-editor')?.style.display).toBe('');
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('折叠预览栏：iframe 摘除、窄条展开钮出现；展开后预览回归', async () => {
    stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(3, 'a.html')] })),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: meta(3, 'a.html') },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(container.querySelector('iframe')).not.toBeNull();
    await clickAriaLabel('折叠预览栏');
    expect(
      container.querySelector('.lt-pane-preview')?.classList.contains('lt-pane-collapsed'),
    ).toBe(true);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('button[aria-label="展开预览栏"]')).not.toBeNull();
    await clickAriaLabel('展开预览栏');
    expect(container.querySelector('iframe')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('启动恢复：settingsGet 返回的 shell.layout 折叠态直接呈现（布局记忆）', async () => {
    stubApi({
      settingsGet: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: {
            ...DEFAULT_SETTINGS,
            shell: { layout: { ...DEFAULT_LAYOUT, previewCollapsed: true } },
          },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(
      container.querySelector('.lt-pane-preview')?.classList.contains('lt-pane-collapsed'),
    ).toBe(true);
    expect(container.querySelector('button[aria-label="展开预览栏"]')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });
});

// 树 rename/move 链路（M4 Task 8，spec §6.2 D8/§6.1）：重命名模态预填/成功关闭/失败 toast、
// move 选择模式点选语义与确认载荷、renamed 广播 getNode 反查回写标签 meta（E2E 归 Task 10，
// 此处单测断言接线；选中态=activeId 为既有锚，故源节点恒为已开标签文件）
describe('Workspace 树 rename/move 链路（M4 Task 8）', () => {
  /** 目录内文件 meta（parentId/virtualPath 对齐目录层级） */
  function fileInDir(): NodeMeta {
    return { ...meta(3, 'a.html'), parentId: 2, virtualPath: '/笔记/a.html' };
  }

  /** 装配 Workspace 并开出 a.html 标签（选中态 = activeId，rename/move 源）；返回根供卸载 */
  async function setupWithFileTab(overrides: Partial<Record<string, unknown>> = {}): Promise<{
    api: Record<string, ReturnType<typeof vi.fn>>;
    vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
    tree: ReturnType<typeof createRoot>;
  }> {
    const { api, vfsHandlers } = stubApiCaptureVfs({
      listChildren: vi.fn((request: { parentId?: number }) =>
        request.parentId === 1
          ? Promise.resolve({ ok: true, value: [meta(2, '笔记', 'dir')] })
          : Promise.resolve({ ok: true, value: [fileInDir()] }),
      ),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: fileInDir() },
        }),
      ),
      ...overrides,
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    // 展开「笔记」（dir 点选=展开）→ 点选 a.html（开标签，选中态就位）
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === '笔记')
        ?.click();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    return { api, vfsHandlers, tree };
  }

  /** 按文本找钮点击（树/工具栏共用） */
  async function clickButton(text: string): Promise<void> {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === text)
        ?.click();
    });
  }

  it('重命名：模态预填当前名，确认按 trim 新名调 renameNode，成功后模态关闭', async () => {
    const { api, tree } = await setupWithFileTab({
      renameNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    await clickButton('重命名');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="新名称"]');
    expect(input?.value).toBe('a.html'); // 树内当前名预填
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '  新名.html  ');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="确认重命名"]')?.click();
    });
    expect(api.renameNode).toHaveBeenCalledWith({ nodeId: 3, newName: '新名.html' });
    expect(container.querySelector('[role="dialog"]')).toBeNull(); // 成功关闭；树/meta 归广播链
    act(() => {
      tree.unmount();
    });
  });

  it('重命名失败：toast 呈现原因且模态保留（可改后重试）', async () => {
    const { tree } = await setupWithFileTab({
      renameNode: vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: { code: 'E_VFS_DUPLICATE_NAME', message: '同名节点已存在' },
        }),
      ),
    });
    // ToastHost 与 Workspace 同容器装配（二进制拦截用例同款结构），toast 文案断言才有落点
    const toastRoot = createRoot(document.body);
    await act(async () => {
      toastRoot.render(<ToastHost />);
    });
    await clickButton('重命名');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="确认重命名"]')?.click();
    });
    expect(document.body.textContent).toContain('重命名失败：同名节点已存在');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull(); // 模态保留
    act(() => {
      tree.unmount();
    });
    act(() => {
      toastRoot.unmount();
    });
  });

  it('move 选择模式：dir 点选记账目标（data-move-target）、file 点选禁用、确认按 nodeId+targetDirId 调 moveNode', async () => {
    const { api, tree } = await setupWithFileTab({
      moveNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    await clickButton('移动到…');
    const bar = (): Element | null => container.querySelector('[aria-label="移动选择模式"]');
    const confirmBtn = (): HTMLButtonElement | null =>
      container.querySelector<HTMLButtonElement>('button[aria-label="确认移动"]');
    expect(bar()).not.toBeNull();
    expect(confirmBtn()?.disabled).toBe(true); // 目标未点选：确认禁用
    // file 点选禁用（spec §6.2 D8）
    const treeFileBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
    ).find((b) => b.textContent === 'a.html');
    expect(treeFileBtn?.disabled).toBe(true);
    // dir 点选=选定目标：data-move-target 高亮、确认解禁
    await clickButton('笔记');
    const dirBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '笔记',
    );
    expect(dirBtn?.getAttribute('data-move-target')).toBe('true');
    expect(confirmBtn()?.disabled).toBe(false);
    await act(async () => {
      confirmBtn()?.click();
    });
    expect(api.moveNode).toHaveBeenCalledWith({ nodeId: 3, targetDirId: 2 });
    expect(bar()).toBeNull(); // 成功退出模式；树/meta 归 moved 广播链
    act(() => {
      tree.unmount();
    });
  });

  it('move 选择模式取消钮与 Esc 均退出（取消语义，不发起 moveNode）', async () => {
    const { api, tree } = await setupWithFileTab({
      moveNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    await clickButton('移动到…');
    expect(container.querySelector('[aria-label="移动选择模式"]')).not.toBeNull();
    // 取消钮退出
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="取消移动"]')?.click();
    });
    expect(container.querySelector('[aria-label="移动选择模式"]')).toBeNull();
    // 再进模式后 Esc 退出（window 级 keydown 成对挂卸）
    await clickButton('移动到…');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('[aria-label="移动选择模式"]')).toBeNull();
    expect(api.moveNode).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('renamed 广播 → getNode 反查回写标签 meta（同步链，spec §6.1：标签名随新鲜 meta 更新）', async () => {
    const { api, vfsHandlers, tree } = await setupWithFileTab({
      getNode: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { ...fileInDir(), name: '新名.html', virtualPath: '/笔记/新名.html' },
        }),
      ),
    });
    await act(async () => {
      // 广播主进程侧 fan-out 语义：PreviewPanel（恒挂载、先注册）与 Workspace（后注册）
      // 各持一份订阅，逐份下发（Preview 侧对 renamed 无感知，仅 Workspace 消费）
      vfsHandlers.forEach((handler) => {
        handler({ rev: 1, event: { type: 'renamed', nodeId: 3, affectedCount: 1 } });
      });
    });
    expect(api.getNode).toHaveBeenCalledWith({ nodeId: 3 });
    const activeTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (b) => b.getAttribute('aria-current') === 'true',
    );
    expect(activeTab?.textContent).toBe('新名.html');
    act(() => {
      tree.unmount();
    });
  });
});
