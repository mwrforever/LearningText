// @vitest-environment jsdom
// PreviewPanel：src 初值/沙箱属性/订阅 cleanup；Workspace：M6 壳层（标题栏/活动栏/侧栏/
// 画布/状态栏）启动装配（resolve+listChildren+settingsGet+countNodes）、广播→树刷新、
// stale 重取与侧栏折叠布局记忆的接线（决策逻辑本体已在纯函数单测，此处验证 wiring 成对）
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { NodeMeta, VfsChangedBroadcast } from '../../../src/shared/vfs-contract';
import { PreviewPanel } from '../../../src/renderer/src/features/preview/PreviewPanel';
import { previewableMime } from '../../../src/renderer/src/features/preview/previewableMime';
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
    // 回收站面板挂载首拉（trash 态内容自持数据；Task 10 move 复位用例切入 trash 态时需要）
    listTrashed: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    // 状态栏文档计数（M6 spec §2.6）：启动装配与树广播后各查一次；平台标识供 TitleBar 消费
    countNodes: vi.fn(() => Promise.resolve({ ok: true, value: 1 })),
    platform: 'win32',
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
    // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅，桩按契约形态注入
    onIoProgress: vi.fn((callback: (p: unknown) => void) => {
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
  it('settingsGet + listChildren 根拉取后渲染树与欢迎页空态；countNodes 装配文档计数', async () => {
    const api = stubApi() as unknown as {
      listChildren: ReturnType<typeof vi.fn>;
      countNodes: ReturnType<typeof vi.fn>;
    };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(api.listChildren).toHaveBeenCalledWith(expect.objectContaining({ parentId: 1 }));
    expect(container.textContent).toContain('笔记');
    // 无标签空态由欢迎页承载（M6 spec §2.5）：主操作钮可见，编辑器/预览不再挂空占位
    expect(container.querySelector('.lt-welcome')).not.toBeNull();
    // 状态栏文档计数装配（M6 spec §2.6）：挂载即查一次并呈现「N 个文档」
    expect(api.countNodes).toHaveBeenCalled();
    expect(container.textContent).toContain('1 个文档');
    act(() => {
      tree.unmount();
    });
  });
});

describe('Workspace 多标签会话中枢（M4 Task 4）', () => {
  afterEach(() => {
    vi.useRealTimers(); // toast 消退用例切假时钟，逐用例还原防泄漏到相邻用例
  });

  // M5 批次⑦ 起 image/png 归媒体预览分流（Task 14），拒开夹具改用不可预览的 octet-stream；
  // 拦截语义本体（非文本且非媒体 → toast 拒开）不变
  it('二进制文件前置拦截：toast 呈现拒开原因且 3s 自动消退，不读库不开标签', async () => {
    vi.useFakeTimers();
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'data.bin'), mimeType: 'application/octet-stream' }],
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
        .find((b) => b.textContent === 'data.bin')
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

  // 大文件阈值三分支（spec §2.4 裁决 D7 计划缺口补齐）：size 前置判定早于任何 IPC；
  // >50MB 拒开（不发起 readFile）、5–50MB 经 window.confirm 放行、≤5MB 直开（含边界）
  it('大文件硬上限（>50MB）前置拒开：toast 呈现且不发起 readFile、不开标签、不弹确认', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'huge.html'), size: 50 * 1024 * 1024 + 1 }],
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const tree = createRoot(container);
      // ToastHost 与 Workspace 同容器装配（二进制拦截用例同款结构），toast 文案断言才有 DOM 落点
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
          .find((b) => b.textContent === 'huge.html')
          ?.click();
      });
      // 硬上限分支先于确认分支与读库：>50MB 无征询意义，直接拒开（spec §2.4 D7 前置判定语义）
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(api.readFile).not.toHaveBeenCalled();
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
      expect(container.textContent).toContain('文件超过 50MB，无法打开');
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('大文件确认区间（5–50MB）：window.confirm 确认后照常读库开标签', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'big.html'), size: 5 * 1024 * 1024 + 1 }],
        }),
      ),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>大文</p>'), meta: meta(3, 'big.html') },
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<Workspace />);
      });
      await act(async () => {
        Array.from(container.querySelectorAll('button'))
          .find((b) => b.textContent === 'big.html')
          ?.click();
      });
      expect(confirmSpy).toHaveBeenCalledWith('大文件打开可能卡顿，是否继续？');
      expect(api.readFile).toHaveBeenCalledWith({ nodeId: 3 });
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
      expect(container.querySelector('.cm-content')?.textContent).toBe('<p>大文</p>');
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('大文件确认区间（5–50MB）：window.confirm 取消则不开标签不读库', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'big.html'), size: 50 * 1024 * 1024 }],
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<Workspace />);
      });
      await act(async () => {
        Array.from(container.querySelectorAll('button'))
          .find((b) => b.textContent === 'big.html')
          ?.click();
      });
      expect(confirmSpy).toHaveBeenCalledWith('大文件打开可能卡顿，是否继续？');
      expect(api.readFile).not.toHaveBeenCalled();
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('软阈值边界（恰 5MB）直开：不弹确认框、读库开标签（≤5MB 现行为不回归）', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [{ ...meta(3, 'edge.html'), size: 5 * 1024 * 1024 }],
        }),
      ),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('文'), meta: meta(3, 'edge.html') },
        }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<Workspace />);
      });
      await act(async () => {
        Array.from(container.querySelectorAll('button'))
          .find((b) => b.textContent === 'edge.html')
          ?.click();
      });
      // 软阈值含边界（<= 判定）：恰 5MB 不征询直接开
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(api.readFile).toHaveBeenCalledWith({ nodeId: 3 });
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
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
    // 全关：编辑画布回欢迎页空态，TabBar 摘除
    const closeA = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭标签 a.html"]',
    );
    await act(async () => {
      closeA?.click();
    });
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.lt-welcome')).not.toBeNull();
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
    // 树工具栏删除钮（M6 图标钮锚点）以当前激活（=选中）为目标
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="删除"]')?.click();
    });
    expect(api.trashNode).toHaveBeenCalledWith({ nodeId: 3 });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelector('.lt-welcome')).not.toBeNull();
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

  /** 按文本找按钮并点击（树点选共用助手） */
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

// 侧栏折叠与布局记忆（M4 Task 7 → M6 spec §2.7 语义迁移：三栏折叠退役为单侧栏形态）：
// 折叠/展开经 aria-label 锚点驱动，折叠态经折叠类名断言（jsdom 无布局引擎，不碰
// getBoundingClientRect 实测值；拖拽几何换算本体已在 layoutModel 纯函数单测覆盖，此处只验接线）
describe('Workspace 侧栏折叠与布局记忆（M6 v4）', () => {
  /** 按 aria-label 找钮点击（折叠/展开钮无文本语义，统一走可访问名锚点） */
  async function clickAriaLabel(label: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    });
  }

  it('折叠侧栏：容器带折叠类、窄条展开钮反向出现；settingsSet 以 get→merge→set 全量写回 shell.layout', async () => {
    const api = stubApi() as unknown as { settingsSet: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickAriaLabel('折叠侧栏');
    const sidebar = container.querySelector('.lt-sidebar');
    expect(sidebar?.classList.contains('lt-sidebar-collapsed')).toBe(true);
    expect(container.querySelector('button[aria-label="展开侧栏"]')).not.toBeNull();
    // 全量写回语义：get 到的设置原样保留 preview/editor 等域，仅 shell.layout 换为折叠态
    expect(api.settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      shell: { layout: { ...DEFAULT_LAYOUT, sidebarCollapsed: true } },
    });
    // 反向展开：折叠类摘除、窄条展开钮消失
    await clickAriaLabel('展开侧栏');
    expect(container.querySelector('.lt-sidebar')?.classList.contains('lt-sidebar-collapsed')).toBe(
      false,
    );
    expect(container.querySelector('button[aria-label="展开侧栏"]')).toBeNull();
    expect(api.settingsSet).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      shell: { layout: { ...DEFAULT_LAYOUT, sidebarCollapsed: false } },
    });
    act(() => {
      tree.unmount();
    });
  });

  it('启动恢复：settingsGet 返回的 shell.layout 折叠态与活动视图直接呈现（布局记忆跨重启）', async () => {
    stubApi({
      settingsGet: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: {
            ...DEFAULT_SETTINGS,
            shell: {
              layout: { ...DEFAULT_LAYOUT, sidebarCollapsed: true, activityView: 'search' },
            },
          },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    // 折叠态恢复：窄条呈现（含展开钮），树内容不挂载
    expect(container.querySelector('.lt-sidebar')?.classList.contains('lt-sidebar-collapsed')).toBe(
      true,
    );
    expect(container.querySelector('button[aria-label="展开侧栏"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).toBeNull();
    // 活动视图记忆恢复：展开后侧栏头呈现 search 态标题（而非默认资源树）
    await clickAriaLabel('展开侧栏');
    expect(container.querySelector('.lt-sidebar-header')?.textContent).toContain('全局搜索');
    act(() => {
      tree.unmount();
    });
  });

  it('活动栏切换视图：aria-current 随激活迁移，侧栏头换题并持久化 activityView', async () => {
    const api = stubApi() as unknown as { settingsSet: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="资源树"]')
        ?.getAttribute('aria-current'),
    ).toBe('true');
    await clickAriaLabel('回收站');
    expect(container.querySelector('section[aria-label="回收站"]')).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="回收站"]')
        ?.getAttribute('aria-current'),
    ).toBe('true');
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="资源树"]')
        ?.getAttribute('aria-current'),
    ).toBeNull();
    // 视图切换即持久化（v4 单一写入口）：activityView 记忆为 trash，其余域原样
    expect(api.settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      shell: { layout: { ...DEFAULT_LAYOUT, activityView: 'trash' } },
    });
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

  /** 按文本找钮点击（树点选共用）；树工具栏图标钮无文本，另备 aria-label 寻址（M6） */
  async function clickButton(text: string): Promise<void> {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === text)
        ?.click();
    });
  }

  async function clickAriaLabel(label: string): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    });
  }

  it('重命名：模态预填当前名，确认按 trim 新名调 renameNode，成功后模态关闭', async () => {
    const { api, tree } = await setupWithFileTab({
      renameNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    await clickAriaLabel('重命名');
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
    await clickAriaLabel('重命名');
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
    await clickAriaLabel('移动到…');
    const bar = (): Element | null => container.querySelector('[aria-label="移动选择模式"]');
    const confirmBtn = (): HTMLButtonElement | null =>
      container.querySelector<HTMLButtonElement>('button[aria-label="确认移动"]');
    expect(bar()).not.toBeNull();
    expect(confirmBtn()?.disabled).toBe(true); // 目标未点选：确认禁用
    // 引导文案（M4 spec §6.2 字面，M5 批次④补欠账）：目标未定时状态条呈现指引
    expect(bar()?.textContent).toContain('在树中选择目标目录并确认');
    // file 点选禁用（spec §6.2 D8）
    const treeFileBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
    ).find((b) => b.textContent === 'a.html');
    expect(treeFileBtn?.disabled).toBe(true);
    // dir 点选=选定目标：data-move-target 高亮、确认解禁、引导文案退场
    await clickButton('笔记');
    const dirBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '笔记',
    );
    expect(dirBtn?.getAttribute('data-move-target')).toBe('true');
    expect(confirmBtn()?.disabled).toBe(false);
    expect(bar()?.textContent).not.toContain('在树中选择目标目录并确认');
    await act(async () => {
      confirmBtn()?.click();
    });
    expect(api.moveNode).toHaveBeenCalledWith({ nodeId: 3, targetDirId: 2 });
    expect(bar()).toBeNull(); // 成功退出模式；树/meta 归 moved 广播链
    act(() => {
      tree.unmount();
    });
  });

  it('dir 行内菜单重命名（不开标签、无选中锚）：renameNode 以 dir id 直传', async () => {
    const { api } = stubApiCaptureVfs({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(2, '笔记', 'dir')] })),
      renameNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    // 行内菜单键盘驱动（radix 先例同 panels-tree-editor）：触发器 Enter 开启 → 菜单项 Enter
    // 激活；行级定位走 data-node-id（可访问名「更多操作」为独占锚，不含节点名防 E2E 串扰）
    const trigger = container.querySelector<HTMLElement>('button[data-node-id="2"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent === '重命名',
    );
    expect(item).toBeDefined();
    await act(async () => {
      item?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // 模态以树内当前名预填；改名确认后 renameNode 收到 dir id（2）
    const input = container.querySelector<HTMLInputElement>('input[aria-label="新名称"]');
    expect(input?.value).toBe('笔记');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '新目录');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="确认重命名"]')?.click();
    });
    expect(api.renameNode).toHaveBeenCalledWith({ nodeId: 2, newName: '新目录' });
    // 选中锚退役佐证：全程无标签打开、树无 aria-current 高亮，操作依然可达
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelector('nav[aria-label="资源树"] button[aria-current]')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('move 模式中切往回收站态即复位 moveMode：返回树不再复现选择条（Task 4 deferred 顺手闭环）', async () => {
    await setupWithFileTab();
    await clickAriaLabel('移动到…');
    expect(container.querySelector('[aria-label="移动选择模式"]')).not.toBeNull();
    // 活动栏进入回收站态再返回：moveMode 已随视图切离复位，选择条不得带残态复现
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="回收站"]')?.click();
    });
    expect(container.querySelector('[aria-label="移动选择模式"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="返回资源树"]')?.click();
    });
    expect(container.querySelector('[aria-label="移动选择模式"]')).toBeNull();
  });

  it('move 选择模式取消钮与 Esc 均退出（取消语义，不发起 moveNode）', async () => {
    const { api, tree } = await setupWithFileTab({
      moveNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    });
    await clickAriaLabel('移动到…');
    expect(container.querySelector('[aria-label="移动选择模式"]')).not.toBeNull();
    // 取消钮退出
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="取消移动"]')?.click();
    });
    expect(container.querySelector('[aria-label="移动选择模式"]')).toBeNull();
    // 再进模式后 Esc 退出（window 级 keydown 成对挂卸）
    await clickAriaLabel('移动到…');
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

// 导入链路接线（M5 批次⑥ Task 12，FR-IO-01）：菜单命令 → 目录选择 → 策略确认弹层 →
// io:import 发起；io:progress 广播驱动进度面板与取消；结果 toast 与树刷新收口。
describe('Workspace 导入链路（M5 Task 12）', () => {
  interface ImportCapture {
    api: Record<string, ReturnType<typeof vi.fn>>;
    shellHandlers: Array<(command: ShellCommand) => void>;
    progressHandlers: Array<(p: unknown) => void>;
    vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
    unsub: ReturnType<typeof vi.fn>;
  }

  /** 捕获 shell 命令、导入/导出进度与树广播订阅回调（供逐条驱动三条主→渲染链） */
  function captureImport(overrides: Partial<Record<string, unknown>> = {}): ImportCapture {
    const shellHandlers: Array<(command: ShellCommand) => void> = [];
    const progressHandlers: Array<(p: unknown) => void> = [];
    const vfsHandlers: Array<(b: VfsChangedBroadcast) => void> = [];
    const unsub = vi.fn();
    const api = stubApi({
      onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
        shellHandlers.push(callback);
        return unsub;
      }),
      onIoProgress: vi.fn((callback: (p: unknown) => void) => {
        progressHandlers.push(callback);
        return unsub;
      }),
      onVfsChanged: vi.fn((callback: (b: VfsChangedBroadcast) => void) => {
        vfsHandlers.push(callback);
        return unsub;
      }),
      pickDirectory: vi.fn(() => Promise.resolve({ ok: true, value: ['D:/notes', 'D:/pics'] })),
      importNodes: vi.fn(() =>
        Promise.resolve({ ok: true, value: { imported: 2, skipped: 1, failed: 0 } }),
      ),
      cancelImport: vi.fn(() => Promise.resolve({ ok: true, value: null })),
      // 导出链路（M5 批次⑥ Task 13）：单选目录 + 导出 invoke + 打开目录，桩按契约形态注入
      exportNodes: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { exported: 3, rewritten: 1, missing: 0, skipped: 0, failed: 0 },
        }),
      ),
      openPath: vi.fn(() => Promise.resolve({ ok: true, value: null })),
      ...overrides,
    }) as Record<string, ReturnType<typeof vi.fn>>;
    return { api, shellHandlers, progressHandlers, vfsHandlers, unsub };
  }

  async function renderWorkspace(): Promise<ReturnType<typeof createRoot>> {
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    return tree;
  }

  /** 从菜单命令推进到确认弹层打开（目录选择已返回双路径） */
  async function openImportDialog(capture: ImportCapture): Promise<void> {
    await act(async () => {
      capture.shellHandlers[0]?.({ type: 'import' });
    });
  }

  it('订阅 cleanup 成对：onIoProgress 卸载必退订（宪法资源纪律）', async () => {
    const capture = captureImport();
    const tree = await renderWorkspace();
    expect(capture.api.onIoProgress).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
    expect(capture.unsub).toHaveBeenCalled();
  });

  it('import 命令 → pickDirectory 选源；用户取消（空清单）不弹确认层', async () => {
    const capture = captureImport({
      pickDirectory: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    });
    const tree = await renderWorkspace();
    await openImportDialog(capture);
    expect(capture.api.pickDirectory).toHaveBeenCalledWith({ multiple: true });
    expect(document.querySelector('[aria-label="确认导入"]')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('选源成功弹出确认层：默认跳过策略，三策略单选可切换；取消导入不发起请求', async () => {
    const capture = captureImport();
    const tree = await renderWorkspace();
    await openImportDialog(capture);

    const radios = Array.from(document.querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    // 切换到覆盖策略（radio 点击 → onValueChange）
    await act(async () => {
      (radios[2] as HTMLElement).click();
    });
    expect(
      Array.from(document.querySelectorAll('[role="radio"]')).map((r) =>
        r.getAttribute('aria-checked'),
      ),
    ).toEqual(['false', 'false', 'true']);

    await act(async () => {
      (document.querySelector('[aria-label="取消导入"]') as HTMLElement).click();
    });
    expect(capture.api.importNodes).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="确认导入"]')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('确认导入 → io:import 载荷（双源路径 + 目标父 + 所选策略）；完成后结果 toast 且弹层关闭', async () => {
    const capture = captureImport();
    // 结果 toast 呈现面：ToastHost 挂载于 App 根（与 Workspace 平级），本用例显式同挂
    const tree = createRoot(container);
    await act(async () => {
      tree.render(
        <>
          <Workspace />
          <ToastHost />
        </>,
      );
    });
    await openImportDialog(capture);
    // 切「重命名」策略后确认：载荷 conflict 必为 rename（策略经单选层传递）
    await act(async () => {
      (Array.from(document.querySelectorAll('[role="radio"]'))[1] as HTMLElement).click();
    });
    await act(async () => {
      (document.querySelector('[aria-label="确认导入"]') as HTMLElement).click();
    });
    expect(capture.api.importNodes).toHaveBeenCalledWith({
      sourcePaths: ['D:/notes', 'D:/pics'],
      targetParentId: 1,
      conflict: 'rename',
    });
    // 完成收口：弹层关闭 + D17 结果 toast 含三项计数
    expect(document.querySelector('[aria-label="确认导入"]')).toBeNull();
    const toasts = Array.from(container.querySelectorAll('.lt-toast')).map((t) => t.textContent);
    expect(
      toasts.some((t) => t?.includes('新增 2') && t?.includes('跳过 1') && t?.includes('失败 0')),
    ).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('导入成功后目标父目录子级直调回写：默认落点=根时顶层新项立即可见（评审 Important 盲区补口）', async () => {
    const capture = captureImport({
      // 首拉（挂载装配）与导入后直调共用同一桩：导入后返回含新增顶层项的子级清单
      listChildren: vi.fn((request: { parentId: number }) => {
        if (request.parentId === 1) {
          return Promise.resolve({
            ok: true,
            value: [meta(2, '笔记', 'dir'), meta(9, '导入的新文件.html')],
          });
        }
        return Promise.resolve({ ok: true, value: [] });
      }),
    });
    const tree = await renderWorkspace();
    // 挂载期首拉已调用一次根子级（Record 索引类型为可 undefined，按既有先例收窄）
    const listChildren = capture.api.listChildren as ReturnType<typeof vi.fn>;
    const rootPullsOf = (): number =>
      listChildren.mock.calls.filter(
        (call: unknown[]) => (call[0] as { parentId: number }).parentId === 1,
      ).length;
    expect(rootPullsOf()).toBe(1);

    await openImportDialog(capture);
    await act(async () => {
      (document.querySelector('[aria-label="确认导入"]') as HTMLElement).click();
    });

    // 评审 Important：默认目标=根（无树选中回落 ROOT_ID）——根永不在 expanded 集、
    // stale 重取效应收集为空的盲区由「目标父目录子级直调回写」补口，导入完成即重调
    expect(listChildren).toHaveBeenCalledWith({ parentId: 1 });
    expect(rootPullsOf()).toBe(2);
    // 直调结果回写树状态：新增顶层项在无任何手点/重启的前提下直接呈现
    expect(
      Array.from(container.querySelectorAll('nav button')).some(
        (b) => b.textContent === '导入的新文件.html',
      ),
    ).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('io:progress 广播驱动进度面板（scanning/writing 文案），取消钮按 importId 寻址', async () => {
    const capture = captureImport({
      importNodes: vi.fn(
        () =>
          new Promise<{ ok: true; value: { imported: number; skipped: number; failed: number } }>(
            () => undefined,
          ),
      ), // 挂起中：进度面板保持
    });
    const tree = await renderWorkspace();
    await openImportDialog(capture);
    await act(async () => {
      (document.querySelector('[aria-label="确认导入"]') as HTMLElement).click();
    });

    // 扫描阶段进度（kind 判别字段：io:progress 为导入/导出可辨识联合，Task 13）
    await act(async () => {
      capture.progressHandlers[0]?.({
        kind: 'import',
        importId: 7,
        phase: 'scanning',
        done: 1,
        total: 2,
        currentPath: 'D:/notes',
      });
    });
    expect(container.querySelector('.lt-import-progress')).not.toBeNull();
    expect(container.textContent).toContain('正在扫描导入源');

    // 写入阶段进度：done/total 文案 + 当前路径呈现
    await act(async () => {
      capture.progressHandlers[0]?.({
        kind: 'import',
        importId: 7,
        phase: 'writing',
        done: 3,
        total: 10,
        currentPath: 'D:/notes/sub/b.html',
      });
    });
    expect(container.textContent).toContain('3/10');
    expect(container.textContent).toContain('D:/notes/sub/b.html');

    // 取消：按进度载荷中的 importId 寻址（io:cancel）
    await act(async () => {
      (container.querySelector('[aria-label="取消导入"]') as HTMLElement).click();
    });
    expect(capture.api.cancelImport).toHaveBeenCalledWith({ importId: 7 });

    // 导入 promise 永挂：直接卸载收尾（资源成对由 unmount 断言覆盖）
    act(() => {
      tree.unmount();
    });
  });

  it('export 命令链（Task 13）：无选中引导提示；选中文件后单选目录 → io:export → 完成 toast 携带「打开目录」动作', async () => {
    const capture = captureImport({
      pickDirectory: vi.fn(() => Promise.resolve({ ok: true, value: ['D:/export-out'] })),
      // 树根直挂一个文件节点：点选开标签 → activeId 即导出选中上下文
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [meta(4, '新页')] })),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(
        <>
          <Workspace />
          <ToastHost />
        </>,
      );
    });
    // 无选中上下文（无标签未 reveal）：引导 toast，不发起目录选择
    await act(async () => {
      capture.shellHandlers[0]?.({ type: 'export' });
    });
    expect(capture.api.pickDirectory).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.lt-toast')].at(-1)?.textContent).toContain(
      '请先在树中选择',
    );

    // 点选树中的「新页」文件（开标签 → 选中上下文就绪）
    const fileButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
    ).find((b) => b.textContent === '新页');
    expect(fileButton).toBeDefined();
    await act(async () => {
      fileButton?.click();
    });
    await act(async () => {
      capture.shellHandlers[0]?.({ type: 'export' });
    });
    expect(capture.api.pickDirectory).toHaveBeenCalledWith({ multiple: false });
    await act(async () => {});
    expect(capture.api.exportNodes).toHaveBeenCalledWith({
      nodeId: 4,
      targetDir: 'D:/export-out',
    });
    // 完成 toast 计数 + 「打开目录」动作钮，点击经 openPath 回传同一目录串（主进程侧登记簿校验）
    expect([...document.querySelectorAll('.lt-toast')].at(-1)?.textContent).toContain('导出完成');
    const openButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.lt-toast button'),
    ).find((b) => b.textContent === '打开目录');
    expect(openButton).toBeDefined();
    await act(async () => {
      openButton?.click();
    });
    expect(capture.api.openPath).toHaveBeenCalledWith({ dir: 'D:/export-out' });
    act(() => {
      tree.unmount();
    });
  });

  it('导出进度（kind: export）驱动导出进度面板，与导入面板互不串扰', async () => {
    const capture = captureImport();
    const tree = await renderWorkspace();
    await act(async () => {
      capture.progressHandlers[0]?.({
        kind: 'export',
        exportId: 1,
        phase: 'writing',
        done: 2,
        total: 5,
        currentPath: 'notes/a.css',
      });
    });
    expect(container.querySelector('.lt-export-progress')).not.toBeNull();
    expect(container.textContent).toContain('2/5');
    expect(container.textContent).toContain('notes/a.css');
    expect(container.querySelector('.lt-import-progress')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });
});

// —— M5 批次⑦ Task 14（FR-EDIT-04，spec §8/D20）：图片/音频只读预览 ——
// previewableMime 纯函数全分支 + openFile 媒体分流（不开标签不读库、双源状态机）+
// 树弱选中 aria 语义 + PreviewPanel 媒体渲染分支

/** 媒体文件 meta：默认顶层 pic.png（id=3），mime/名称可覆盖 */
function mediaMeta(mimeType: string, name = 'pic.png'): NodeMeta {
  return { ...meta(3, name), mimeType };
}

describe('previewableMime（M5 批次⑦ 全分支）', () => {
  it('图片族 mime → image：png/jpg/jpeg/gif/webp/svg 全覆盖', () => {
    expect(previewableMime('image/png')).toBe('image');
    expect(previewableMime('image/jpeg')).toBe('image');
    expect(previewableMime('image/gif')).toBe('image');
    expect(previewableMime('image/webp')).toBe('image');
    expect(previewableMime('image/svg+xml')).toBe('image');
  });

  it('音频族 mime → audio：mp3(mpeg)/wav/ogg 全覆盖', () => {
    expect(previewableMime('audio/mpeg')).toBe('audio');
    expect(previewableMime('audio/wav')).toBe('audio');
    expect(previewableMime('audio/ogg')).toBe('audio');
  });

  it('其余 mime → null：octet-stream/文本/目录/视频一律不可预览', () => {
    expect(previewableMime('application/octet-stream')).toBeNull();
    expect(previewableMime('text/html')).toBeNull();
    expect(previewableMime('application/pdf')).toBeNull();
    expect(previewableMime('video/mp4')).toBeNull();
    expect(previewableMime('x-directory')).toBeNull();
  });
});

describe('Workspace 媒体只读预览分流（M5 批次⑦ Task 14）', () => {
  /** 树点选指定名称的行钮（树/标签同名时取树栏内首个命中——顶层单层无重名） */
  async function clickTreeRow(text: string): Promise<void> {
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === text)
        ?.click();
    });
  }

  it('image 节点树点选：不开标签不读库（保存管线零接触），树弱选中标记预览中行', async () => {
    const api = stubApi({
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [mediaMeta('image/png')] })),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickTreeRow('pic.png');
    // 不读库：img 经 vfs:// 协议直载，openFile 分流在读库之前返回
    expect(api.readFile).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    // M6 单画布模型：无并存 doc 标签时媒体呈现面退场（画布由欢迎页承载，批次②画布化回收），
    // 双源状态机仍以树弱选中为观察锚——行带 data-preview-selected 与「（预览中）」可访问名
    expect(container.querySelector('img.lt-preview-media')).toBeNull();
    const picRow = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'pic.png',
    );
    expect(picRow?.getAttribute('data-preview-selected')).toBe('true');
    expect(picRow?.getAttribute('aria-label')).toBe('pic.png（预览中）');
    expect(container.querySelector('.lt-welcome')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('audio 节点树点选：同款不开标签不读库、树弱选中标记（表单呈现随并存标签承载）', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({ ok: true, value: [mediaMeta('audio/mpeg', 'song.mp3')] }),
      ),
    }) as unknown as { readFile: ReturnType<typeof vi.fn> };
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickTreeRow('song.mp3');
    expect(api.readFile).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    const audioRow = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'song.mp3',
    );
    expect(audioRow?.getAttribute('data-preview-selected')).toBe('true');
    expect(audioRow?.getAttribute('aria-label')).toBe('song.mp3（预览中）');
    act(() => {
      tree.unmount();
    });
  });

  it('其余二进制维持拒开 toast：octet-stream 不读库不开标签、预览态不被牵动', async () => {
    const api = stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [mediaMeta('application/octet-stream', 'data.bin')],
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
    await clickTreeRow('data.bin');
    expect(api.readFile).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.textContent).toContain('二进制文件暂不支持编辑');
    // 画布不落任何媒体元素：拒开路径不触碰双源状态机（空态由欢迎页承载，M6 起）
    expect(container.querySelector('img.lt-preview-media')).toBeNull();
    expect(container.querySelector('audio.lt-preview-media')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('媒体点选与标签并存（D20 双源）：激活标签保留、切回标签预览回 iframe、弱选中随源进退', async () => {
    stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [mediaMeta('image/png'), meta(4, 'a.html')],
        }),
      ),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: meta(4, 'a.html') },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    // 开 a.html 标签（iframe 预览）→ 点 pic.png（媒体预览）
    const aRow = (): HTMLButtonElement | null =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
      ).find((b) => b.textContent === 'a.html') ?? null;
    const picRow = (): HTMLButtonElement | null =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
      ).find((b) => b.textContent === 'pic.png') ?? null;
    await clickTreeRow('a.html');
    expect(container.querySelector('iframe')).not.toBeNull();
    await clickTreeRow('pic.png');
    // 预览切图片；激活标签保留在 TabBar 且强选中语义原样
    expect(container.querySelector('img.lt-preview-media')).not.toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(
      Array.from(container.querySelectorAll('[role="tab"]')).find(
        (b) => b.getAttribute('aria-current') === 'true',
      )?.textContent,
    ).toBe('a.html');
    // 树弱选中 aria 语义并存：强选中行 aria-current=true 原样；媒体行 data-preview-selected
    // 标记 + 可访问名带「（预览中）」说明（强选中恒无弱标记，同一行不双标）
    expect(aRow()?.getAttribute('aria-current')).toBe('true');
    expect(aRow()?.getAttribute('data-preview-selected')).toBeNull();
    expect(picRow()?.getAttribute('data-preview-selected')).toBe('true');
    expect(picRow()?.getAttribute('aria-label')).toBe('pic.png（预览中）');
    // 切回标签（TabBar 点选）：预览回 iframe，弱选中随源退场（previewNode 保留不展示）
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .find((b) => b.textContent === 'a.html')
        ?.click();
    });
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelector('img.lt-preview-media')).toBeNull();
    expect(picRow()?.getAttribute('data-preview-selected')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('全关标签不连带收回媒体源（源=image 不被「关空标签」清掉）；文本重开即收回', async () => {
    stubApi({
      listChildren: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [mediaMeta('image/png'), meta(4, 'a.html')],
        }),
      ),
      readFile: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: { content: new TextEncoder().encode('<p>正文</p>'), meta: meta(4, 'a.html') },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await clickTreeRow('a.html');
    await clickTreeRow('pic.png');
    expect(container.querySelector('img.lt-preview-media')).not.toBeNull();
    // 关闭最后一个标签（activeId→null，无标签可激活）：媒体源保持——关闭标签不表达
    // 「看标签」意图；M6 无并存标签时呈现面退场（画布回欢迎页），弱选中标记仍在
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭标签 a.html"]')?.click();
    });
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(container.querySelector('.lt-welcome')).not.toBeNull();
    const picRow = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'pic.png',
    );
    expect(picRow?.getAttribute('data-preview-selected')).toBe('true');
    // 重开文本文件：打开成功即收回预览源到标签（含 activeId 不变的重开路径，effect 不触发须显式）；
    // 弱选中随源退场，预览回 iframe
    await clickTreeRow('a.html');
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelector('img.lt-preview-media')).toBeNull();
    expect(picRow?.getAttribute('data-preview-selected')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });
});

describe('PreviewPanel 媒体分支（M5 批次⑦ Task 14）', () => {
  it('image meta 渲染 <img>（无滚动同步条、无 iframe）；onError 落「文档不可用」占位', () => {
    stubApi();
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={mediaMeta('image/png')} />);
    });
    const img = container.querySelector('img.lt-preview-media');
    expect(img?.getAttribute('src')).toBe('vfs://local/pic.png');
    expect(img?.getAttribute('alt')).toBe('pic.png');
    expect(container.querySelector('iframe')).toBeNull();
    // 媒体态无滚动同步语义（无 iframe 可同步），开关条不呈现（Task 11 html 分支不受影响）
    expect(container.querySelector('button[aria-label="滚动同步"]')).toBeNull();
    // 加载失败态沿用既有占位语义：onError → 「文档不可用」占位（媒体元素接管 unavailable 通道）
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img.lt-preview-media')).toBeNull();
    expect(container.textContent).toContain('文档不可用');
    tree.unmount();
  });

  it('audio meta 渲染 <audio controls>（同款无开关条、无 iframe）', () => {
    stubApi();
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={mediaMeta('audio/mpeg', 'song.mp3')} />);
    });
    const audio = container.querySelector('audio.lt-preview-media');
    expect(audio?.hasAttribute('controls')).toBe(true);
    expect(audio?.getAttribute('src')).toBe('vfs://local/song.mp3');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('button[aria-label="滚动同步"]')).toBeNull();
    tree.unmount();
  });
});
