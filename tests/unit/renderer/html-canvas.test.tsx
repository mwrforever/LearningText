// @vitest-environment jsdom
// HTML 所见即所得画布冒烟（M6 spec §3.3，批次②）：保活 iframe 集（sandbox 逐字/激活可见
// 后台 hidden）、lt:doc-edit 消息路由（来源精确比对 + 形态收窄）、从库重新加载钮
// （脏态禁用 = 批次②落地修正，防静默覆盖本地修改；净态 replace 直载库内容）、CSS 热替换
// 广播（written 命中 text/css → fetch 拉新文本 postMessage lt:css-swap，M4 spec §5.4
// 通道自 PreviewPanel 迁入）与卸载退订成对。jsdom 对 iframe 仅提供 about:blank 内容窗
// （vfs:// 不实际加载），消息路由以同引用 source 满足精确比对，无需产品代码加测试钩子。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VfsChangedBroadcast, NodeMeta } from '../../../src/shared/vfs-contract';
import { HtmlCanvas } from '../../../src/renderer/src/features/canvas/HtmlCanvas';
import type { TabState } from '../../../src/renderer/src/features/workspace/tabModel';

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

function tab(id: number, name: string, dirty = false): TabState {
  return { meta: meta(id, name), dirty };
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

interface ApiStub {
  vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
  unsub: ReturnType<typeof vi.fn>;
}

/** 桥桩：仅画布消费面（onVfsChanged 捕获订阅回调 + 退订 spy 供资源成对断言） */
function stubApi(): ApiStub {
  const vfsHandlers: Array<(b: VfsChangedBroadcast) => void> = [];
  const unsub = vi.fn();
  const api = {
    onVfsChanged: vi.fn((callback: (b: VfsChangedBroadcast) => void) => {
      vfsHandlers.push(callback);
      return unsub;
    }),
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return { vfsHandlers, unsub };
}

interface RenderResult {
  vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
  unsub: ReturnType<typeof vi.fn>;
  frames: () => HTMLIFrameElement[];
  rerender: (props: {
    tabs?: readonly TabState[];
    activeId?: number | null;
    activeDirty?: boolean;
  }) => void;
  unmount: () => void;
}

/** 以受控 props 渲染画布（onDocEdit 记账于 edits；props 变化经重渲染回灌模拟 Workspace） */
function renderCanvas(
  initial: {
    tabs: readonly TabState[];
    activeId: number | null;
    activeDirty: boolean;
  },
  edits: Array<(nodeId: number, html: string) => void>,
): RenderResult {
  const stub = stubApi();
  const tree = createRoot(container);
  let current = initial;
  const render = (): void => {
    act(() => {
      tree.render(
        <HtmlCanvas
          tabs={current.tabs}
          activeId={current.activeId}
          activeDirty={current.activeDirty}
          onDocEdit={(nodeId, html) => {
            for (const edit of edits) edit(nodeId, html);
          }}
        />,
      );
    });
  };
  render();
  return {
    vfsHandlers: stub.vfsHandlers,
    unsub: stub.unsub,
    frames: (): HTMLIFrameElement[] =>
      Array.from(container.querySelectorAll<HTMLIFrameElement>('iframe.lt-canvas-frame')),
    rerender: (props): void => {
      current = { ...current, ...props };
      render();
    },
    unmount: (): void => {
      act(() => {
        tree.unmount();
      });
    },
  };
}

describe('HtmlCanvas（HTML 所见即所得画布）', () => {
  it('两个 HTML 标签渲染两个保活 iframe：sandbox/referrerpolicy 逐字、src=vfs 直载，激活可见非激活 hidden', () => {
    const view = renderCanvas(
      { tabs: [tab(3, 'a.html'), tab(4, 'b.html')], activeId: 3, activeDirty: false },
      [],
    );
    const frames = view.frames();
    expect(frames).toHaveLength(2);
    expect(frames[0]?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frames[0]?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frames[0]?.getAttribute('src')).toBe('vfs://local/a.html');
    expect(frames[1]?.getAttribute('src')).toBe('vfs://local/b.html');
    // 激活可见（无 hidden 类）、后台标签隐藏保活（切签保留浏览器原生撤销）
    expect(frames[0]?.className).not.toContain('hidden');
    expect(frames[1]?.className).toContain('hidden');
    view.unmount();
  });

  it('画布 iframe 携带浏览器白底：文档未自设背景时不透出应用底色（灰色遮罩缺陷回归守卫）', () => {
    const view = renderCanvas({ tabs: [tab(3, 'a.html')], activeId: 3, activeDirty: false }, []);
    // 浏览器对顶层文档恒以白色为画布基底；子文档根背景 transparent 时 Chromium 画布对
    // 嵌入者透明，文档无自设 background 时应用底色（亮 #f8fafc / 暗 #0f172a）会透出文档，
    // 用户实测表述为「HTML 渲染出现莫名其妙的灰色遮罩层」——基底由 iframe 元素承载，
    // 用户文档与保存序列化零改动（jsdom 不加载 Tailwind 产物，此处断言契约类名；
    // 真机合成结果由 preview.spec「文档面基底」用例以 computed style 断言）
    expect(view.frames()[0]?.className).toContain('bg-white');
    view.unmount();
  });

  it('激活 iframe 来源的 lt:doc-edit 消息 → onDocEdit 携正确 nodeId 与 html（反查路由）', () => {
    const onDocEdit = vi.fn();
    const view = renderCanvas(
      { tabs: [tab(3, 'a.html'), tab(4, 'b.html')], activeId: 3, activeDirty: false },
      [(nodeId, html) => onDocEdit(nodeId, html)],
    );
    const [frameA, frameB] = view.frames();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frameA?.contentWindow ?? null,
          data: { type: 'lt:doc-edit', html: '<p>甲</p>' },
        }),
      );
    });
    expect(onDocEdit).toHaveBeenCalledTimes(1);
    expect(onDocEdit).toHaveBeenCalledWith(3, '<p>甲</p>');
    // 后台 iframe 同样可达（保活编辑语义：来源反查 nodeId，不看激活态）
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frameB?.contentWindow ?? null,
          data: { type: 'lt:doc-edit', html: '<p>乙</p>' },
        }),
      );
    });
    expect(onDocEdit).toHaveBeenLastCalledWith(4, '<p>乙</p>');
    view.unmount();
  });

  it('形态非法或来源不符的消息丢弃：onDocEdit 不被伪造来源与畸形载荷触发', () => {
    const onDocEdit = vi.fn();
    const view = renderCanvas({ tabs: [tab(3, 'a.html')], activeId: 3, activeDirty: false }, [
      (nodeId, html) => onDocEdit(nodeId, html),
    ]);
    const frame = view.frames()[0];
    // 伪造来源（非画布 iframe）：形态合法也不可达（来源精确比对，防他源消息串扰）
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: { type: 'lt:doc-edit', html: '<p>伪造</p>' },
        }),
      );
    });
    // 画布来源但形态非法：type 不符 / html 非字符串 / 载荷非对象，一律丢弃
    for (const data of [
      { type: 'lt:other', html: '<p>x</p>' },
      { type: 'lt:doc-edit', html: 42 },
      '裸字符串',
      null,
    ]) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', { source: frame?.contentWindow ?? null, data }),
        );
      });
    }
    expect(onDocEdit).not.toHaveBeenCalled();
    view.unmount();
  });

  it('从库重新加载钮：无激活或脏态禁用（防静默覆盖本地修改）；净态点击 replace 直载库内容', () => {
    const onDocEdit = vi.fn();
    const view = renderCanvas({ tabs: [tab(3, 'a.html')], activeId: null, activeDirty: false }, [
      (nodeId, html) => onDocEdit(nodeId, html),
    ]);
    const button = (): HTMLButtonElement | null =>
      container.querySelector<HTMLButtonElement>('button[aria-label="从库重新加载"]');
    // 无激活：禁用（契约收尾形态）
    expect(button()?.disabled).toBe(true);
    // 脏态禁用（批次②落地修正）：本地修改与库内容冲突时不提供静默覆盖入口
    view.rerender({ activeId: 3, activeDirty: true });
    expect(button()?.disabled).toBe(true);
    // 净态可点：对激活 iframe 执行 location.replace(vfs://...)（jsdom Location.replace 为
    // 不可配置自有属性无法 spy——以自有属性遮蔽 contentWindow 注入带 replace mock 的
    // 桩内容窗，组件读取路径 frame.contentWindow?.location.replace 不变，无需改产品代码）
    view.rerender({ activeDirty: false });
    expect(button()?.disabled).toBe(false);
    const replace = vi.fn();
    const frame = view.frames()[0];
    Object.defineProperty(frame as HTMLIFrameElement, 'contentWindow', {
      value: { location: { replace } },
    });
    act(() => {
      button()?.click();
    });
    expect(replace).toHaveBeenCalledWith('vfs://local/a.html');
    view.unmount();
  });

  it('written 命中 text/css → fetch 拉新文本对全部画布 iframe 广播 lt:css-swap（零重载热替换）', async () => {
    const fetchStub = vi.fn(() =>
      Promise.resolve({ text: () => Promise.resolve('body{color:red}') }),
    );
    vi.stubGlobal('fetch', fetchStub);
    try {
      const onDocEdit = vi.fn();
      const view = renderCanvas(
        { tabs: [tab(3, 'a.html'), tab(4, 'b.html')], activeId: 3, activeDirty: false },
        [(nodeId, html) => onDocEdit(nodeId, html)],
      );
      const [frameA, frameB] = view.frames();
      const postA = vi.spyOn(frameA?.contentWindow as Window, 'postMessage');
      const postB = vi.spyOn(frameB?.contentWindow as Window, 'postMessage');
      await act(async () => {
        view.vfsHandlers[0]?.({
          rev: 1,
          event: { type: 'written', node: { ...meta(5, 'style.css'), mimeType: 'text/css' } },
        });
      });
      // 拉取走 vfs://（协议侧只读出口），新文本广播到全部保活 iframe（含后台标签）
      expect(fetchStub).toHaveBeenCalledWith('vfs://local/style.css');
      expect(postA).toHaveBeenCalledWith(
        { type: 'lt:css-swap', path: '/style.css', text: 'body{color:red}' },
        '*',
      );
      expect(postB).toHaveBeenCalledWith(
        { type: 'lt:css-swap', path: '/style.css', text: 'body{color:red}' },
        '*',
      );
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('卸载资源成对：onVfsChanged 退订被调用，window message 监听不再触发 onDocEdit', () => {
    const onDocEdit = vi.fn();
    const view = renderCanvas({ tabs: [tab(3, 'a.html')], activeId: 3, activeDirty: false }, [
      (nodeId, html) => onDocEdit(nodeId, html),
    ]);
    const frame = view.frames()[0];
    view.unmount();
    expect(view.unsub).toHaveBeenCalled();
    // 卸载后路由已摘除：同形态消息不再触发编辑上报
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame?.contentWindow ?? null,
          data: { type: 'lt:doc-edit', html: '<p>卸载后</p>' },
        }),
      );
    });
    expect(onDocEdit).not.toHaveBeenCalled();
  });
});
