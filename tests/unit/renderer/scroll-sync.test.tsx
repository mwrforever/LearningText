// @vitest-environment jsdom
// 滚动同步（M5 批次⑤ Task 11，FR-RENDER-06）：三纯函数全分支（零/负/溢出钳制、抑制窗口
// 边界）+ 协议消息收窄守卫 + PreviewPanel 冒烟（开关默认开、关闭不投递、report 接收联动
// 编辑器回调）+ EditorPanel 下行接线（锚点命中滚动/未命中静默/150ms 抑制窗）。
// jsdom 无真实滚动：断言只碰回调与 dispatch 面，滚动数学由纯函数承载（完整 E2E 驱动归 Task 16）。
import { act } from 'react';
import { EditorView } from '@codemirror/view';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { EditorPanel } from '../../../src/renderer/src/features/editor/EditorPanel';
import { createEditorState } from '../../../src/renderer/src/features/editor/codemirror';
import type { EditorAppearance } from '../../../src/renderer/src/features/editor/codemirror';
import { TabSessions } from '../../../src/renderer/src/features/editor/tabSessions';
import { PreviewPanel } from '../../../src/renderer/src/features/preview/PreviewPanel';
import {
  offsetFromRatio,
  parseScrollReport,
  ratioFromScroll,
  shouldSuppressReport,
} from '../../../src/renderer/src/features/preview/scrollSync';

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

/** 最小桥桩：PreviewPanel 挂载仅订阅 onVfsChanged（本任务测试不驱动广播） */
function stubApi(): void {
  Object.defineProperty(window, 'api', {
    value: { onVfsChanged: vi.fn(() => vi.fn()) },
    configurable: true,
    writable: true,
  });
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

describe('滚动同步纯函数（Task 11）', () => {
  describe('ratioFromScroll（比例换算：0–1 钳制，无滚动量返 0）', () => {
    it('半程滚动返回 0.5；顶部 0、底部恰为 1', () => {
      expect(ratioFromScroll(300, 300, 900)).toBe(0.5);
      expect(ratioFromScroll(0, 300, 900)).toBe(0);
      expect(ratioFromScroll(600, 300, 900)).toBe(1);
    });

    it('负值钳制为 0，超出上限钳制为 1', () => {
      expect(ratioFromScroll(-100, 300, 900)).toBe(0);
      expect(ratioFromScroll(9999, 300, 900)).toBe(1);
    });

    it('内容不足一屏（scrollHeight<=clientHeight，含相等边界）恒返 0', () => {
      expect(ratioFromScroll(0, 300, 300)).toBe(0);
      expect(ratioFromScroll(50, 300, 100)).toBe(0);
    });
  });

  describe('offsetFromRatio（反向目标 scrollTop：零高容错）', () => {
    it('比例 0.5 落到可滚动半程；比例钳制：负值归 0、超 1 归上限', () => {
      expect(offsetFromRatio(0.5, 300, 900)).toBe(300);
      expect(offsetFromRatio(-0.5, 300, 900)).toBe(0);
      expect(offsetFromRatio(1.5, 300, 900)).toBe(600);
    });

    it('零高容错：scrollHeight<=clientHeight 时任何比例都落 0', () => {
      expect(offsetFromRatio(0, 300, 300)).toBe(0);
      expect(offsetFromRatio(0.7, 300, 100)).toBe(0);
    });

    it('与 ratioFromScroll 往返一致（同几何下经两函数换算回到原 scrollTop）', () => {
      const top = 437;
      expect(offsetFromRatio(ratioFromScroll(top, 300, 900), 300, 900)).toBeCloseTo(top, 10);
    });
  });

  describe('shouldSuppressReport（D13 回环抑制窗，默认 150ms）', () => {
    it('窗内抑制、恰窗满放行（< 严格边界）、窗外放行', () => {
      expect(shouldSuppressReport(1000, 1100)).toBe(true); // 100ms < 150ms：抑制
      expect(shouldSuppressReport(1000, 1150)).toBe(false); // 恰 150ms：窗口已满，放行
      expect(shouldSuppressReport(1000, 1200)).toBe(false);
    });

    it('自定义窗长生效；从未同步（-Infinity）不抑制；时钟回拨（now 早于盖章）视为刚同步而抑制', () => {
      expect(shouldSuppressReport(1000, 1299, 300)).toBe(true);
      expect(shouldSuppressReport(1000, 1300, 300)).toBe(false);
      expect(shouldSuppressReport(Number.NEGATIVE_INFINITY, 0)).toBe(false);
      expect(shouldSuppressReport(2000, 1000)).toBe(true);
    });
  });

  describe('parseScrollReport（子→父消息收窄守卫：外部输入禁断言，逐字段校验）', () => {
    it('合法消息解析出完整三元组', () => {
      expect(
        parseScrollReport({ type: 'lt:scroll-report', ratio: 0.5, anchorText: '第二节' }),
      ).toEqual({
        type: 'lt:scroll-report',
        ratio: 0.5,
        anchorText: '第二节',
      });
    });

    it('非对象/null/缺字段/字段类型错/非有限数/type 不符一律判 null', () => {
      expect(parseScrollReport(null)).toBeNull();
      expect(parseScrollReport(undefined)).toBeNull();
      expect(parseScrollReport('lt:scroll-report')).toBeNull();
      expect(parseScrollReport(42)).toBeNull();
      expect(parseScrollReport({})).toBeNull();
      expect(
        parseScrollReport({ type: 'lt:scroll-report', ratio: '0.5', anchorText: '甲' }),
      ).toBeNull();
      expect(
        parseScrollReport({ type: 'lt:scroll-report', ratio: Number.NaN, anchorText: '甲' }),
      ).toBeNull();
      expect(parseScrollReport({ type: 'lt:scroll-report', ratio: 0.5 })).toBeNull();
      expect(parseScrollReport({ type: 'lt:css-swap', ratio: 0.5, anchorText: '甲' })).toBeNull();
    });
  });
});

describe('PreviewPanel 滚动同步（Task 11 冒烟）', () => {
  /** 投递槽位桩（结构等价 Workspace 传入的 useRef 产物） */
  function scrollPostSlot(): { current: ((ratio: number) => void) | null } {
    return { current: null };
  }

  it('滚动同步开关钮默认开启（D14 会话级偏好，不进 settings）', () => {
    stubApi();
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} scrollPostRef={scrollPostSlot()} />);
    });
    const toggle = container.querySelector('button[aria-label="滚动同步"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    tree.unmount();
  });

  it("开关关闭后不向 iframe 投递 lt:scroll-ratio；重开恢复投递（载荷含比例、'*' targetOrigin）", async () => {
    stubApi();
    const scrollPostRef = scrollPostSlot();
    const tree = createRoot(container);
    act(() => {
      tree.render(<PreviewPanel node={meta(2, 'a.html')} scrollPostRef={scrollPostRef} />);
    });
    const iframe = container.querySelector('iframe');
    expect(iframe?.contentWindow).not.toBeNull();
    const postMessage = vi.spyOn(iframe?.contentWindow as Window, 'postMessage');
    // 开关开启（默认）：登记的投递函数把比例按 M3 §7.2 协议发给子文档
    expect(scrollPostRef.current).not.toBeNull();
    scrollPostRef.current?.(0.5);
    expect(postMessage).toHaveBeenCalledWith({ type: 'lt:scroll-ratio', ratio: 0.5 }, '*');
    // 关闭开关：投递静默（不 postMessage）
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="滚动同步"]')?.click();
    });
    expect(
      container.querySelector('button[aria-label="滚动同步"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
    postMessage.mockClear();
    scrollPostRef.current?.(0.5);
    expect(postMessage).not.toHaveBeenCalled();
    // 重开恢复：投递恢复且比例随调随传
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="滚动同步"]')?.click();
    });
    scrollPostRef.current?.(0.25);
    expect(postMessage).toHaveBeenCalledWith({ type: 'lt:scroll-ratio', ratio: 0.25 }, '*');
    tree.unmount();
  });

  it('收到本 iframe 的合法 lt:scroll-report 且开关开 → 调编辑器滚动回调（锚点文本透传）', async () => {
    stubApi();
    const onScrollReport = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <PreviewPanel
          node={meta(2, 'a.html')}
          scrollPostRef={scrollPostSlot()}
          onScrollReport={onScrollReport}
        />,
      );
    });
    const iframe = container.querySelector('iframe');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'lt:scroll-report', ratio: 0.4, anchorText: '第二节' },
          source: iframe?.contentWindow ?? null,
        }),
      );
    });
    expect(onScrollReport).toHaveBeenCalledTimes(1);
    expect(onScrollReport).toHaveBeenCalledWith('第二节');
    tree.unmount();
  });

  it('开关关闭/非本 iframe 来源/形态非法的 report 一律不联动编辑器回调', async () => {
    stubApi();
    const onScrollReport = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <PreviewPanel
          node={meta(2, 'a.html')}
          scrollPostRef={scrollPostSlot()}
          onScrollReport={onScrollReport}
        />,
      );
    });
    const iframe = container.querySelector('iframe');
    const dispatchFromIframe = async (data: unknown): Promise<void> => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', { data, source: iframe?.contentWindow ?? null }),
        );
      });
    };
    // 开关关闭：report 不联动
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="滚动同步"]')?.click();
    });
    await dispatchFromIframe({ type: 'lt:scroll-report', ratio: 0.4, anchorText: '第二节' });
    expect(onScrollReport).not.toHaveBeenCalled();
    // 重开后：非本 iframe 来源（source 缺失）不联动
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="滚动同步"]')?.click();
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'lt:scroll-report', ratio: 0.4, anchorText: '第二节' },
          source: null,
        }),
      );
    });
    expect(onScrollReport).not.toHaveBeenCalled();
    // 形态非法（ratio 非数值）不联动
    await dispatchFromIframe({ type: 'lt:scroll-report', ratio: '0.4', anchorText: '第二节' });
    expect(onScrollReport).not.toHaveBeenCalled();
    tree.unmount();
  });
});

describe('EditorPanel 滚动同步接线（Task 11）', () => {
  const APPEARANCE: EditorAppearance = { theme: 'light', fontSize: 14 };

  /** 取当前挂载的 CM 视图实例（editor-panel.test.tsx 同款先例：CM6 官方静态 API） */
  function mountedView(root: HTMLElement): EditorView | null {
    const editorDom = root.querySelector<HTMLDivElement>('.cm-editor');
    return editorDom === null ? null : EditorView.findFromDOM(editorDom);
  }

  function mountWithDoc(
    doc: string,
    props: Partial<Parameters<typeof EditorPanel>[0]> = {},
  ): { readonly unmount: () => void } {
    const sessions = new TabSessions();
    sessions.open(
      2,
      createEditorState({
        doc,
        mimeType: 'text/plain',
        handlers: { onDocChanged: () => {}, onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          {...props}
        />,
      );
    });
    return {
      unmount: () => {
        act(() => {
          tree.unmount();
        });
      },
    };
  }

  it('scrollDOM 滚动事件 → 上行出口收到比例（jsdom 零度量下为 0，接线证明）', () => {
    const onScrollRatio = vi.fn();
    const mounted = mountWithDoc('正文', { onScrollRatio });
    const view = mountedView(container);
    expect(view).not.toBeNull();
    act(() => {
      view?.scrollDOM.dispatchEvent(new Event('scroll'));
    });
    expect(onScrollRatio).toHaveBeenCalledTimes(1);
    expect(onScrollRatio).toHaveBeenCalledWith(0);
    mounted.unmount();
  });

  it('锚点命令：未命中静默零派发（含空锚点）、命中即 dispatch 滚动一次', () => {
    const anchorScrollRef: { current: ((anchorText: string) => void) | null } = { current: null };
    const mounted = mountWithDoc('<p>第一节</p>\n<p>第二节</p>', { anchorScrollRef });
    const view = mountedView(container);
    expect(view).not.toBeNull();
    const dispatchSpy = vi.spyOn(view as EditorView, 'dispatch');
    const command = anchorScrollRef.current;
    expect(command).not.toBeNull();
    // 未命中（渲染文本与源文不可对齐的启发式边界）：静默、零派发、不抛
    act(() => {
      command?.('不存在锚');
    });
    // 空锚点（接收器无可视文本时的空串形态）同静默
    act(() => {
      command?.('');
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    // 命中：按锚点首处派发滚动（scrollIntoView effect 事务，不改 doc）
    act(() => {
      command?.('第二节');
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it('150ms 抑制窗（D13）：窗内报告静默、恰窗满放行——回环不死循环的父侧闸门', () => {
    vi.useFakeTimers();
    try {
      const t0 = 1_000_000;
      vi.setSystemTime(t0);
      const anchorScrollRef: { current: ((anchorText: string) => void) | null } = { current: null };
      const mounted = mountWithDoc('<p>第一节</p>\n<p>第二节</p>', { anchorScrollRef });
      const view = mountedView(container);
      const dispatchSpy = vi.spyOn(view as EditorView, 'dispatch');
      const command = anchorScrollRef.current;
      expect(command).not.toBeNull();
      act(() => {
        command?.('第一节');
      });
      expect(dispatchSpy).toHaveBeenCalledTimes(1); // 首份报告应用并盖章
      vi.setSystemTime(t0 + 100);
      act(() => {
        command?.('第二节');
      });
      expect(dispatchSpy).toHaveBeenCalledTimes(1); // 窗内：视为自身上报的回响，抑制
      vi.setSystemTime(t0 + 150);
      act(() => {
        command?.('第二节');
      });
      expect(dispatchSpy).toHaveBeenCalledTimes(2); // 恰窗满：窗口已过，放行
      mounted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
