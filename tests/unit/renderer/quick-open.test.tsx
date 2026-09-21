// @vitest-environment jsdom
// 快速打开浮层（M5 批次① Task 6）冒烟：cmdk 双源交互（去抖 200ms 搜索 / 空关键词最近打开）
// + Workspace 壳命令接线。断言以 role/aria 语义为主（radix/cmdk 实际渲染 DOM 实测），
// 受控输入经原生 value setter + input 事件驱动（rename-dialog 同款先例）；
// radix Dialog 渲染进 body portal，查询一律走 document 而非容器。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { SearchHit } from '../../../src/shared/search-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import {
  QUICKOPEN_DEBOUNCE_MS,
  QuickOpenDialog,
} from '../../../src/renderer/src/features/quickopen/QuickOpenDialog';
import { Workspace } from '../../../src/renderer/src/features/workspace/Workspace';

/** 文件节点 meta 工厂（mimeType 恒为 text/html——openFile 文本白名单语义之外仅作展示） */
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

/** 名称命中 SearchHit 工厂（片段区间空即可——浮层只消费 node 字段） */
function hit(id: number, name: string): SearchHit {
  return {
    node: meta(id, name),
    matchIn: 'name',
    score: 1,
    nameSnippet: { text: name, ranges: [] },
    bodySnippet: null,
  };
}

/** 带两条最近打开的设置桩（Task 5 recordRecent 持久化形态，openedAt 由写入方补齐） */
const SETTINGS_WITH_RECENT = {
  ...DEFAULT_SETTINGS,
  recent: {
    opened: [
      {
        nodeId: 7,
        virtualPath: '/笔记/todo.html',
        name: 'todo.html',
        openedAt: '2026-09-20T10:00:00.000+08:00',
      },
      {
        nodeId: 3,
        virtualPath: '/a.html',
        name: 'a.html',
        openedAt: '2026-09-19T10:00:00.000+08:00',
      },
    ],
  },
};

/** 浮层桥桩：settingsGet（含最近打开）+ searchQuery（两条命中）+ getNode（按 id 回 meta） */
function stubDialogApi(overrides: Partial<Record<string, unknown>> = {}): {
  settingsGet: ReturnType<typeof vi.fn>;
  searchQuery: ReturnType<typeof vi.fn>;
  getNode: ReturnType<typeof vi.fn>;
} {
  const api = {
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: SETTINGS_WITH_RECENT })),
    searchQuery: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { hits: [hit(9, '笔记a.html'), hit(8, '笔记b.html')], total: 2, truncated: false },
      }),
    ),
    getNode: vi.fn((request: { nodeId: number }) =>
      Promise.resolve({ ok: true, value: meta(request.nodeId, `节点${request.nodeId}.html`) }),
    ),
    ...overrides,
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return api;
}

let container: HTMLElement;
let tree: ReturnType<typeof createRoot>;
const onOpenChange = vi.fn<(open: boolean) => void>();
const onPick = vi.fn<(node: NodeMeta) => void>();

beforeEach(() => {
  // 只 fake 去抖所需 timer：radix/cmdk 内部其余时序（rAF 等）保持真实，避免挂起渲染
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  container = document.createElement('div');
  document.body.appendChild(container);
  tree = createRoot(container);
  onOpenChange.mockClear();
  onPick.mockClear();
});

afterEach(() => {
  tree.unmount();
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** 以既定 props 渲染浮层（默认展开） */
function renderDialog(open = true): void {
  act(() => {
    tree.render(<QuickOpenDialog open={open} onOpenChange={onOpenChange} onPick={onPick} />);
  });
}

/** 冲刷 promise 续体（settingsGet/searchQuery 微任务链）后完成重渲染 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {});
}

const dialog = (): Element | null => document.querySelector('[role="dialog"]');
const input = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>('input[cmdk-input]');
const optionElements = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

function firstOption(): HTMLElement {
  const el = optionElements()[0];
  if (!el) throw new Error('无渲染结果项');
  return el;
}

/** 受控输入注入关键词（原生 setter + input 事件，绕过 React 合成事件直改 value 的失真） */
function typeKeyword(text: string): void {
  const el = input();
  if (!el) throw new Error('无浮层输入框');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 在输入框上派发按键（冒泡至 cmdk root / radix document 监听面） */
function pressKey(key: string): void {
  const el = input();
  if (!el) throw new Error('无浮层输入框');
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('QuickOpenDialog 快速打开浮层', () => {
  it('open=false 不渲染浮层；open=true 渲染对话框与输入框', () => {
    stubDialogApi();
    renderDialog(false);
    expect(dialog()).toBeNull();
    renderDialog(true);
    expect(dialog()).not.toBeNull();
    expect(input()).not.toBeNull();
  });

  it('空关键词渲染最近打开（Task 5 数据源）；点选经 getNode 解析回传 onPick 并关闭', async () => {
    const api = stubDialogApi();
    renderDialog(true);
    await flushMicrotasks();
    // 空关键词：两条最近打开条目可见，未发起 searchQuery
    expect(api.searchQuery).not.toHaveBeenCalled();
    const names = optionElements().map((el) => el.textContent ?? '');
    expect(names.some((t) => t.includes('todo.html'))).toBe(true);
    expect(names.some((t) => t.includes('a.html'))).toBe(true);
    // 点选第一条：getNode 反查 NodeMeta → onPick 回传 + 关闭浮层
    await act(async () => {
      firstOption().click();
    });
    expect(api.getNode).toHaveBeenCalledWith({ nodeId: 7 });
    expect(onPick).toHaveBeenCalledWith(meta(7, '节点7.html'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('输入去抖 200ms：窗口内不发起 searchQuery，期满发起且 nodeTypes 仅 file、limit 10', async () => {
    const api = stubDialogApi();
    renderDialog(true);
    typeKeyword('文件');
    expect(api.searchQuery).not.toHaveBeenCalled(); // 输入即时不查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICKOPEN_DEBOUNCE_MS - 1);
    });
    expect(api.searchQuery).not.toHaveBeenCalled(); // 去抖窗口内不查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.searchQuery).toHaveBeenCalledWith({
      keyword: '文件',
      filters: { nodeTypes: ['file'] },
      limit: 10,
    });
  });

  it('搜索结果渲染后点选回传 onPick(node) 并关闭', async () => {
    stubDialogApi();
    renderDialog(true);
    typeKeyword('笔记');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICKOPEN_DEBOUNCE_MS);
    });
    await flushMicrotasks();
    const names = optionElements().map((el) => el.textContent ?? '');
    expect(names.some((t) => t.includes('笔记a.html'))).toBe(true);
    await act(async () => {
      firstOption().click();
    });
    expect(onPick).toHaveBeenCalledWith(meta(9, '笔记a.html'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('去抖窗口内关闭浮层取消挂起查询（timer 与开关竞态防护）', async () => {
    const api = stubDialogApi();
    renderDialog(true);
    typeKeyword('文件');
    renderDialog(false); // 去抖窗口内关闭
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICKOPEN_DEBOUNCE_MS + 50);
    });
    expect(api.searchQuery).not.toHaveBeenCalled();
  });

  it('Esc 关闭浮层（onOpenChange(false)）', () => {
    stubDialogApi();
    renderDialog(true);
    pressKey('Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('点击关闭钮关闭浮层', () => {
    stubDialogApi();
    renderDialog(true);
    const close = document.querySelector<HTMLButtonElement>(
      '[data-slot="dialog-content"] [data-slot="dialog-close"]',
    );
    expect(close).not.toBeNull();
    act(() => {
      close?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('键盘 ↓/↑ 移动 active（aria-activedescendant 变化）+ Enter 选中回传 onPick', async () => {
    const api = stubDialogApi();
    renderDialog(true);
    await flushMicrotasks();
    const ids = optionElements().map((el) => el.id);
    expect(ids.length).toBe(2);
    const active = (): string | null => input()?.getAttribute('aria-activedescendant') ?? null;
    const selectedIds = (): Array<string | null> =>
      optionElements().map((el) => el.getAttribute('aria-selected'));
    // cmdk 1.1 实测语义：初始高亮由首项 aria-selected 承载，activedescendant 导航后才回填
    expect(selectedIds()).toEqual(['true', 'false']);
    expect(active()).toBeNull();
    pressKey('ArrowDown');
    expect(active()).toBe(ids[1]);
    expect(selectedIds()).toEqual(['false', 'true']);
    pressKey('ArrowUp');
    expect(active()).toBe(ids[0]);
    pressKey('ArrowDown');
    pressKey('Enter'); // 选中当前 active（第二条）
    await flushMicrotasks(); // 最近打开点选经 getNode 异步解析，回传在微任务续体内
    expect(api.getNode).toHaveBeenCalledWith({ nodeId: 3 });
    expect(onPick).toHaveBeenCalledWith(meta(3, '节点3.html'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Workspace 快速打开接线', () => {
  it('shell:command { type: "quick-open" } 打开浮层（switch 分支追加）', async () => {
    const shellHandlers: Array<(command: ShellCommand) => void> = [];
    const api = {
      listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
      createNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(3, '新文件') })),
      readFile: vi.fn(() =>
        Promise.resolve({ ok: true, value: { content: new Uint8Array(), meta: meta(2, 'x') } }),
      ),
      writeFile: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x') })),
      trashNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
      getNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x.html') })),
      forceClose: vi.fn(() => Promise.resolve({ ok: true, value: null })),
      searchQuery: vi.fn(() =>
        Promise.resolve({ ok: true, value: { hits: [], total: 0, truncated: false } }),
      ),
      settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
      settingsSet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
      // M6 壳层装配路径补员：状态栏文档计数与 TitleBar 平台标识
      countNodes: vi.fn(() => Promise.resolve({ ok: true, value: 0 })),
      platform: 'win32',
      onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
        shellHandlers.push(callback);
        return vi.fn();
      }),
      onVfsChanged: vi.fn(() => vi.fn()),
      // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅
      onIoProgress: vi.fn(() => vi.fn()),
    };
    Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    expect(dialog()).toBeNull(); // 初始未开浮层
    const handler = shellHandlers[0];
    if (!handler) throw new Error('Workspace 未订阅 shell:command');
    act(() => {
      handler({ type: 'quick-open' });
    });
    expect(dialog()).not.toBeNull();
    expect(input()).not.toBeNull();
  });
});
