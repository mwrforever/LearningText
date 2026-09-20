// @vitest-environment jsdom
// 全局搜索面板冒烟（M5 批次① Task 7）：输入回车发起查询（nodeTypes 三态过滤）、片段着色
// spans（mark[data-hl]，零 HTML 注入）、点击结果 onOpen / 「在树中显示」onReveal、total 计数
// 与 truncated 加载更多（offset 递增，50/页 D24 策略）；另覆盖 Workspace search 态接线
// （标题栏入口 / shell:command 分支 / Esc 回树态 / 搜索→打开主链路）。
// 断言以 role/aria 为主；radix Select 以键盘事件驱动（触发器 Enter 开启 → ArrowDown 高亮 →
// Enter 选中，jsdom 无 pointer 语义）；渲染期禁写 ref，桥桩形态沿 trash-panel 先例。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { SearchHit } from '../../../src/shared/search-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { SearchPanel } from '../../../src/renderer/src/features/search/SearchPanel';
import { ToastHost } from '../../../src/renderer/src/features/ui/Toast';
import { Workspace } from '../../../src/renderer/src/features/workspace/Workspace';

/** 文件节点 meta 工厂（text/html 白名单内，openFile 主链路可走通） */
function meta(id: number, name: string, overrides: Partial<NodeMeta> = {}): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/html',
    size: 4,
    createdAt: '2026-09-21T10:00:00.000+08:00',
    updatedAt: '2026-09-21T10:00:00.000+08:00',
    ...overrides,
  };
}

/** 目录节点 meta 工厂（mimeType 契约 null，openFile 非文本拦截语义内） */
function dirMeta(id: number, name: string, parentId: number = 1): NodeMeta {
  return meta(id, name, { parentId, nodeType: 'dir', mimeType: null, size: 0 });
}

/** reveal 链路固定场景（M5 Task 7 评审 fix 测试面）：根 > 笔记(10) > todo.html(11) */
const NOTE_DIR = dirMeta(10, '笔记');
const NESTED_TODO = meta(11, 'todo.html', { parentId: 10, virtualPath: '/笔记/todo.html' });

/** 命中工厂：名称片段 + 可选正文片段（区间码元语义，服务端产出形态） */
function hitWith(
  id: number,
  name: string,
  bodySnippet: SearchHit['bodySnippet'] = null,
  node: NodeMeta = meta(id, name),
): SearchHit {
  return {
    node,
    matchIn: bodySnippet === null ? 'name' : 'both',
    score: 1,
    nameSnippet: { text: name, ranges: [{ start: 0, end: 2 }] },
    bodySnippet,
  };
}

/** 分页响应工厂：total 命中数、count 条命中、truncated 是否还有余量（名称与 id 同序） */
function page(
  total: number,
  count: number,
  truncated: boolean,
): {
  hits: SearchHit[];
  total: number;
  truncated: boolean;
} {
  return {
    hits: Array.from({ length: count }, (_, i) => hitWith(i + 1, `文件${i + 1}.html`)),
    total,
    truncated,
  };
}

/** 桥桩（trash-panel/quick-open 先例）：返回对象供测试取 spy */
function stubSearchApi(overrides: Partial<Record<string, unknown>> = {}): {
  api: Record<string, ReturnType<typeof vi.fn>>;
  shellHandlers: Array<(command: ShellCommand) => void>;
} {
  const shellHandlers: Array<(command: ShellCommand) => void> = [];
  const api = {
    searchQuery: vi.fn(() => Promise.resolve({ ok: true, value: page(2, 2, false) })),
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    settingsSet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    // resolvePath 默认拒绝（reveal 容错路径：祖先段解析失败静默跳过不抛错）
    resolvePath: vi.fn(() =>
      Promise.resolve({ ok: false, error: { code: 'E_VFS_NOT_FOUND', message: '路径不存在' } }),
    ),
    getNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'x.html') })),
    readFile: vi.fn(() =>
      Promise.resolve({ ok: true, value: { content: new Uint8Array(), meta: meta(2, 'x') } }),
    ),
    onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
      shellHandlers.push(callback);
      return vi.fn();
    }),
    onVfsChanged: vi.fn(() => vi.fn()),
    // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅
    onIoProgress: vi.fn(() => vi.fn()),
    ...overrides,
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return { api, shellHandlers };
}

let container: HTMLElement;
let tree: ReturnType<typeof createRoot>;
const onOpen = vi.fn<(node: NodeMeta) => void>();
const onReveal = vi.fn<(node: NodeMeta) => void>();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  tree = createRoot(container);
  onOpen.mockClear();
  onReveal.mockClear();
});

afterEach(() => {
  act(() => {
    tree.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
});

/** 冲刷 promise 续体（searchQuery/settingsGet 微任务链）后完成重渲染 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {});
}

/** 以既定 props 渲染面板（冒烟用例直接挂 SearchPanel，接线用例挂 Workspace） */
function renderPanel(): void {
  act(() => {
    tree.render(<SearchPanel onOpen={onOpen} onReveal={onReveal} />);
  });
}

const searchInput = (): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]');
const resultItems = (): NodeListOf<HTMLLIElement> =>
  container.querySelectorAll('ul[aria-label="搜索结果"] > li');
const hitMarks = (): NodeListOf<HTMLElement> => container.querySelectorAll('mark[data-hl]');

/** 向搜索输入框注入关键词并回车（Enter 为面板显式监听的提交键，非 form 隐式提交） */
function submitKeyword(text: string): void {
  const input = searchInput();
  if (!input) throw new Error('无搜索输入框');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/** 类型过滤 select 键盘驱动：触发器 Enter 开启 → 相对当前值 ArrowDown → Enter 选中 */
function pickTypeOption(label: string): void {
  const trigger = container.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  if (!trigger) throw new Error('无类型过滤 select');
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  const targetIndex = options.findIndex((el) => el.textContent === label);
  if (targetIndex < 0) {
    throw new Error(
      `select 无选项 ${label}（实际：${options.map((o) => o.textContent ?? '').join('/')}）`,
    );
  }
  // 开启后高亮位 = 当前选中项（radix 语义）；选中经目标项自身 keydown（Enter）承载——
  // 事件冒泡至 React 根即触发 SelectItem onKeyDown，不依赖焦点与 pointer 语义
  const currentLabel = trigger.textContent ?? '';
  const currentIndex = options.findIndex((el) => el.textContent === currentLabel);
  const steps = Math.max(0, targetIndex - currentIndex);
  const openTrigger = document.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  if (!openTrigger) throw new Error('select 开启后无触发器');
  act(() => {
    const target = options[targetIndex];
    if (target) target.focus();
    for (let i = 0; i < steps; i += 1) {
      openTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('SearchPanel 全局搜索面板', () => {
  it('输入回车发起 searchQuery：全部态带 nodeTypes ["dir","file"]、每页 50、offset 0', async () => {
    const { api } = stubSearchApi();
    renderPanel();
    submitKeyword('指数');
    await flushMicrotasks();
    expect(api.searchQuery).toHaveBeenCalledWith({
      keyword: '指数',
      filters: { nodeTypes: ['dir', 'file'] },
      limit: 50,
      offset: 0,
    });
    // 空关键词回车不发起查询（契约拒绝空查询，不发无效 IPC）
    submitKeyword('');
    expect(api.searchQuery).toHaveBeenCalledTimes(1);
  });

  it('类型过滤三态：HTML → nodeTypes ["file"]；目录 → nodeTypes ["dir"]', async () => {
    const { api } = stubSearchApi();
    renderPanel();
    pickTypeOption('HTML');
    submitKeyword('指数');
    await flushMicrotasks();
    expect(api.searchQuery).toHaveBeenCalledWith({
      keyword: '指数',
      filters: { nodeTypes: ['file'] },
      limit: 50,
      offset: 0,
    });
    pickTypeOption('目录');
    submitKeyword('指数');
    await flushMicrotasks();
    expect(api.searchQuery).toHaveBeenLastCalledWith({
      keyword: '指数',
      filters: { nodeTypes: ['dir'] },
      limit: 50,
      offset: 0,
    });
  });

  it('结果项渲染 nameSnippet/bodySnippet 着色 spans（mark[data-hl] 区间渲染，零 HTML 注入）', async () => {
    stubSearchApi({
      searchQuery: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: {
            hits: [
              {
                node: meta(9, '指数笔记.html'),
                matchIn: 'both',
                score: 1,
                nameSnippet: { text: '指数笔记.html', ranges: [{ start: 0, end: 2 }] },
                bodySnippet: { text: '关于二元指数分布的笔记', ranges: [{ start: 4, end: 6 }] },
              },
            ],
            total: 1,
            truncated: false,
          },
        }),
      ),
    });
    renderPanel();
    submitKeyword('指数');
    await flushMicrotasks();
    const marks = Array.from(hitMarks()).map((el) => el.textContent ?? '');
    // 名称首两码元 + 正文第 4–6 码元各一处高亮：区间语义直用、不收 HTML
    expect(marks).toEqual(['指数', '指数']);
    expect(container.textContent).toContain('指数笔记.html');
    expect(container.textContent).toContain('/指数笔记.html');
    expect(container.textContent).toContain('关于二元指数分布的笔记');
  });

  it('点击结果回传 onOpen(hit.node)；「在树中显示」回传 onReveal', async () => {
    stubSearchApi();
    renderPanel();
    submitKeyword('指数');
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 文件1.html"]')?.click();
    });
    expect(onOpen).toHaveBeenCalledWith(meta(1, '文件1.html'));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="在树中显示 文件1.html"]')
        ?.click();
    });
    expect(onReveal).toHaveBeenCalledWith(meta(1, '文件1.html'));
  });

  it('total 计数展示；truncated 提示 + 加载更多按 hits.length 递增 offset（50/页）', async () => {
    const { api } = stubSearchApi();
    // 第一页 50 条 / 总 120 条，还有余量
    let call = 0;
    (api.searchQuery as ReturnType<typeof vi.fn>).mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? { ok: true, value: page(120, 50, true) }
          : { ok: true, value: { hits: [hitWith(99, '后续.html')], total: 120, truncated: false } },
      );
    });
    renderPanel();
    submitKeyword('指数');
    await flushMicrotasks();
    expect(container.textContent).toContain('共 120 条命中');
    expect(resultItems().length).toBe(50);
    // truncated：加载更多钮存在且按当前 hits 长度递增 offset
    const more = container.querySelector<HTMLButtonElement>(
      'button[aria-label="加载更多搜索结果"]',
    );
    expect(more).not.toBeNull();
    await act(async () => {
      more?.click();
    });
    expect(api.searchQuery).toHaveBeenNthCalledWith(2, {
      keyword: '指数',
      filters: { nodeTypes: ['dir', 'file'] },
      limit: 50,
      offset: 50,
    });
    await flushMicrotasks();
    // 追加而非替换：51 条（50 + 1），余量耗尽后加载更多钮消失
    expect(resultItems().length).toBe(51);
    expect(container.querySelector('button[aria-label="加载更多搜索结果"]')).toBeNull();
  });

  it('无命中呈「无匹配结果」空态；查询失败 toast 呈现原因', async () => {
    stubSearchApi({
      searchQuery: vi
        .fn()
        .mockReturnValueOnce(Promise.resolve({ ok: true, value: page(0, 0, false) }))
        .mockReturnValueOnce(
          Promise.resolve({ ok: false, error: { code: 'E_STORE_INTERNAL', message: '库不可用' } }),
        ),
    });
    act(() => {
      tree.render(
        <>
          <SearchPanel onOpen={onOpen} onReveal={onReveal} />
          <ToastHost />
        </>,
      );
    });
    submitKeyword('指数');
    await flushMicrotasks();
    expect(container.textContent).toContain('无匹配结果');
    submitKeyword('指数');
    await flushMicrotasks();
    expect(document.body.textContent).toContain('搜索失败：库不可用');
  });
});

// Workspace search 态接线：标题栏入口 / shell:command 分支 / Esc 回树态 / 搜索→打开主链路
describe('Workspace search 态接线', () => {
  it('「打开全局搜索」进入 search 态（SearchPanel 挂载、树内容卸载）；「返回资源树」回树', async () => {
    stubSearchApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开全局搜索"]')?.click();
    });
    expect(container.querySelector('section[aria-label="全局搜索"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="返回资源树"]')?.click();
    });
    expect(container.querySelector('section[aria-label="全局搜索"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
  });

  it('shell:command { type: "global-search" } 进入 search 态（dispatch 分支追加）', async () => {
    const { shellHandlers } = stubSearchApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    expect(container.querySelector('section[aria-label="全局搜索"]')).toBeNull();
    const handler = shellHandlers[0];
    if (!handler) throw new Error('Workspace 未订阅 shell:command');
    act(() => {
      handler({ type: 'global-search' });
    });
    expect(container.querySelector('section[aria-label="全局搜索"]')).not.toBeNull();
  });

  it('search 态按 Esc 回树态（window 级 keydown，与 trash 态同款成对挂卸）', async () => {
    stubSearchApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开全局搜索"]')?.click();
    });
    expect(container.querySelector('section[aria-label="全局搜索"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('section[aria-label="全局搜索"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
  });

  it('search 态点选结果走 openFile 主链路（readFile 发起、开标签）', async () => {
    const { api } = stubSearchApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开全局搜索"]')?.click();
    });
    submitKeyword('指数');
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 文件1.html"]')?.click();
    });
    expect(api.readFile).toHaveBeenCalledWith({ nodeId: 1 });
    // 标签 opened：TabBar 呈现（openFile 成功链路）
    expect(container.textContent).toContain('文件1.html');
  });

  // —— reveal 树侧定位链路（M5 Task 7 评审 fix，spec §2.2 两条路径）——
  // 场景：根 > 笔记(10) > todo.html(11)；resolvePath('/笔记') → 10；listChildren 按父分层返回

  /** reveal 链路桥桩：根 children=笔记、笔记 children=todo.html、路径解析按段命中 */
  function stubRevealApi(): Record<string, ReturnType<typeof vi.fn>> {
    const { api } = stubSearchApi({
      searchQuery: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: {
            hits: [hitWith(11, 'todo.html', null, NESTED_TODO)],
            total: 1,
            truncated: false,
          },
        }),
      ),
      listChildren: vi.fn((request: { parentId: number }) => {
        if (request.parentId === 1) {
          return Promise.resolve({ ok: true, value: [NOTE_DIR] });
        }
        if (request.parentId === 10) {
          return Promise.resolve({ ok: true, value: [NESTED_TODO] });
        }
        return Promise.resolve({ ok: true, value: [] });
      }),
      resolvePath: vi.fn((request: { virtualPath: string }) =>
        request.virtualPath === '/笔记'
          ? Promise.resolve({ ok: true, value: { nodeId: 10 } })
          : Promise.resolve({
              ok: false,
              error: { code: 'E_VFS_NOT_FOUND', message: '路径不存在' },
            }),
      ),
    });
    return api;
  }

  /** 冒烟前置：进入 search 态 → 搜索 → 渲染出 todo.html 命中行；返回当前生效桥桩供断言 */
  async function renderSearchWithTodoHit(): Promise<Record<string, ReturnType<typeof vi.fn>>> {
    const api = stubRevealApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开全局搜索"]')?.click();
    });
    submitKeyword('指数');
    await flushMicrotasks();
    expect(container.querySelector('button[aria-label="在树中显示 todo.html"]')).not.toBeNull();
    return api;
  }

  /** 树内按钮定位（按可见文本，TreePanel 无 id 锚） */
  function treeButton(label: string): HTMLButtonElement | undefined {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('nav[aria-label="资源树"] button'),
    ).find((button) => button.textContent === label);
  }

  it('「在树中显示」reveal 文件命中：祖先段解析展开、子级装载、目标选中、视图回树', async () => {
    const api = await renderSearchWithTodoHit();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="在树中显示 todo.html"]')
        ?.click();
    });
    await flushMicrotasks();
    // 视图回树：search 态卸载、树内容挂载
    expect(container.querySelector('section[aria-label="全局搜索"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    // 祖先链解析（/笔记 → 10）与子级就地装载（listChildren 10）
    expect(api.resolvePath).toHaveBeenCalledWith({ virtualPath: '/笔记' });
    expect(api.listChildren).toHaveBeenCalledWith({ parentId: 10 });
    // 目标选中：todo.html 树内可见（父层装载完成）且 aria-current 高亮
    const todoButton = treeButton('todo.html');
    expect(todoButton).toBeDefined();
    expect(todoButton?.getAttribute('aria-current')).toBe('true');
  });

  it('目录命中 reveal：目录自身展开（子级可见）且选中——目录结果的有效动作', async () => {
    const api = await renderSearchWithTodoHit();
    (api.searchQuery as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: { hits: [hitWith(10, '笔记', null, NOTE_DIR)], total: 1, truncated: false },
      }),
    );
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开全局搜索"]')?.click();
    });
    submitKeyword('指数');
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="在树中显示 笔记"]')?.click();
    });
    await flushMicrotasks();
    // 目录自身层级也展开（levels 含自身段）：子级 todo.html 装载可见；目录行获得高亮
    expect(api.listChildren).toHaveBeenCalledWith({ parentId: 10 });
    const noteButton = treeButton('笔记');
    expect(noteButton?.getAttribute('aria-current')).toBe('true');
    expect(treeButton('todo.html')).toBeDefined();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
  });

  it('reveal 选中随 activeId 变化回落：树内点选开签后高亮自覆盖值迁移至 activeTab', async () => {
    // 目录 reveal：笔记(10) 获覆盖选中高亮（activeId 仍 null）
    const api = await renderSearchWithTodoHit();
    (api.searchQuery as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: { hits: [hitWith(10, '笔记', null, NOTE_DIR)], total: 1, truncated: false },
      }),
    );
    submitKeyword('指数');
    await flushMicrotasks();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="在树中显示 笔记"]')?.click();
    });
    await flushMicrotasks();
    expect(treeButton('笔记')?.getAttribute('aria-current')).toBe('true');
    // 树内点选 todo.html → 开签 activeId=11 → 覆盖选中回收，高亮迁移至 todo.html
    await act(async () => {
      treeButton('todo.html')?.click();
    });
    await flushMicrotasks();
    expect(treeButton('todo.html')?.getAttribute('aria-current')).toBe('true');
    expect(treeButton('笔记')?.getAttribute('aria-current')).toBeNull();
  });

  it('祖先段解析失败容错：静默跳过不抛错，仍回树且不开签不装载（在树中显示语义）', async () => {
    const api = await renderSearchWithTodoHit();
    // 全部段改道拒绝：reveal 链路走容错分支，展开集与子级装载均不发生
    // Record 下标访问判空收窄（noUncheckedIndexedAccess；测试桩 cast 先例同 trash-panel.test）
    (api.resolvePath as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'E_VFS_NOT_FOUND', message: '路径不存在' } }),
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="在树中显示 todo.html"]')
        ?.click();
    });
    await flushMicrotasks();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="全局搜索"]')).toBeNull();
    // 在树中显示不开标签（区别于点击定位打开）；解析失败的祖先段不发起子级装载
    expect(api.readFile).not.toHaveBeenCalled();
    expect(api.listChildren).not.toHaveBeenCalledWith({ parentId: 10 });
  });

  it('点击定位打开（spec §2.2）：树侧展开与 openFile 并行——readFile 发起且祖先段解析', async () => {
    const api = await renderSearchWithTodoHit();
    (api.readFile as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({ ok: true, value: { content: new Uint8Array(), meta: NESTED_TODO } }),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开 todo.html"]')?.click();
    });
    await flushMicrotasks();
    // 树侧展开（点击路径的「树侧展开至该节点」）+ openFile 主链路并发推进
    expect(api.resolvePath).toHaveBeenCalledWith({ virtualPath: '/笔记' });
    expect(api.readFile).toHaveBeenCalledWith({ nodeId: 11 });
    expect(container.textContent).toContain('todo.html');
  });
});
