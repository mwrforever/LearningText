// @vitest-environment jsdom
// 回收站面板冒烟（M5 批次②）：列表渲染名称/原路径/删除时间、还原回调、还原撞名 toast、
// 彻底删除与清空的**应用内确认弹窗**二次确认（M8 反馈批次取代原生 window.confirm）、
// trash 域广播重拉（restored 重拉/created 不拉）、
// 本地过滤联动；另覆盖 Workspace 活动视图 trash 态接线（活动栏进入/Esc 返回/返回钮）。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type {
  NodeMeta,
  TrashedNodeMeta,
  VfsChangedBroadcast,
} from '../../../src/shared/vfs-contract';
import { ToastHost } from '../../../src/renderer/src/features/ui/Toast';
import { TrashPanel } from '../../../src/renderer/src/features/trash/TrashPanel';
import { Workspace } from '../../../src/renderer/src/features/workspace/Workspace';

function meta(id: number, name: string): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/html',
    size: 4,
    createdAt: '2026-09-20T10:00:00.000+08:00',
    updatedAt: '2026-09-20T10:00:00.000+08:00',
  };
}

function trashed(id: number, name: string): TrashedNodeMeta {
  return { meta: meta(id, name), deletedAt: '2026-09-21T09:30:00.000+08:00' };
}

/** 桥桩（stubApi 先例）：返回对象供测试取 spy；onVfsChanged 捕获回调供逐事件驱动广播 */
function stubTrashApi(overrides: Partial<Record<string, unknown>> = {}): {
  api: Record<string, unknown>;
  vfsHandlers: Array<(b: VfsChangedBroadcast) => void>;
  unsub: ReturnType<typeof vi.fn>;
} {
  const vfsHandlers: Array<(b: VfsChangedBroadcast) => void> = [];
  const unsub = vi.fn();
  const api = {
    listTrashed: vi.fn(() =>
      Promise.resolve({ ok: true, value: [trashed(5, 'a.html'), trashed(6, 'b.css')] }),
    ),
    restoreNode: vi.fn(() => Promise.resolve({ ok: true, value: meta(5, 'a.html') })),
    purgeNode: vi.fn(() => Promise.resolve({ ok: true, value: { affectedCount: 1 } })),
    onVfsChanged: vi.fn((callback: (b: VfsChangedBroadcast) => void) => {
      vfsHandlers.push(callback);
      return unsub;
    }),
    // Workspace 装配所需通道（trash 态接线用例挂载 Workspace；树态首拉走这些桩；
    // 活动视图切换经 updateLayout 触发 settingsGet→settingsSet 布局写回，桩按契约注入）
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    settingsSet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    onShellCommand: vi.fn(() => vi.fn()),
    // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅
    onIoProgress: vi.fn(() => vi.fn()),
    // M6 壳层装配路径补员：状态栏文档计数与 TitleBar 平台标识
    countNodes: vi.fn(() => Promise.resolve({ ok: true, value: 0 })),
    // 数据目录信息（②批次起 Workspace 挂载期拉取，供树栏保存路径小字）
    getDataDirInfo: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          root: 'D:/lt-user-data/LearningText',
          dbFile: 'D:/lt-user-data/LearningText/learningtext.db',
          backupsDir: 'D:/lt-user-data/LearningText/backups',
          settingsFile: 'D:/lt-user-data/LearningText/settings/settings.json',
          custom: false,
        },
      }),
    ),
    // M9 更新域与粘贴导入桩（FR-UPDATE-01/FR-IO-03）：状态首拉返回 idle、订阅退订空函数；
    // 粘贴导入默认空清单（kind:'empty'，非错误）
    importFromClipboard: vi.fn(() => Promise.resolve({ ok: true, value: { kind: 'empty' } })),
    getUpdateState: vi.fn(() =>
      Promise.resolve({ ok: true, value: { kind: 'idle', currentVersion: '0.0.0' } }),
    ),
    onUpdateState: vi.fn(() => () => undefined),
    platform: 'win32',
    ...overrides,
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return { api, vfsHandlers, unsub };
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

/** 按可访问名找钮点击（还原/彻底删除/清空均为 aria 锚点，E2E 同款寻址） */
async function clickAriaLabel(label: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
  });
}

/** 确认弹窗内按可访问名点击（radix Portal 挂在 document.body，非本测试容器内——须全文档寻址） */
async function clickDialogButton(label: string): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
  });
}

describe('TrashPanel', () => {
  it('列表渲染名称/原路径/删除时间；有条目时清空钮可用', async () => {
    stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    expect(container.textContent).toContain('a.html');
    expect(container.textContent).toContain('/b.css');
    expect(container.textContent).toContain('2026-09-21T09:30:00.000+08:00');
    const emptyBtn = container.querySelector<HTMLButtonElement>('button[aria-label="清空回收站"]');
    expect(emptyBtn?.disabled).toBe(false);
    act(() => {
      tree.unmount();
    });
  });

  it('后代行「随上级还原」标注：父链命中另一回收站条目的行呈现标注，顶层行不呈现', async () => {
    // 平铺回收站清单：目录 7（顶层，parentId=根）+ 其子文件 8（parentId=7）——
    // 子行还原会被父链校验拒（父级还原时整树出列），呈现层标注指向性事实
    const dirMeta: NodeMeta = {
      ...meta(7, '笔记'),
      nodeType: 'dir',
      mimeType: null,
      virtualPath: '/笔记',
    };
    const childMeta: NodeMeta = { ...meta(8, 'c.html'), parentId: 7, virtualPath: '/笔记/c.html' };
    stubTrashApi({
      listTrashed: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: [
            { meta: dirMeta, deletedAt: '2026-09-21T09:30:00.000+08:00' },
            { meta: childMeta, deletedAt: '2026-09-21T09:30:00.000+08:00' },
          ],
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    // 标注恰好一次（仅子行）；还原钮仍可点（标注不改变可点性——行为零变更）
    expect(container.textContent).toContain('随上级还原');
    expect(
      Array.from(container.querySelectorAll('li')).filter((li) =>
        li.textContent?.includes('随上级还原'),
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="还原 c.html"]'),
    ).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('空回收站：占位文案呈现且清空钮禁用', async () => {
    stubTrashApi({ listTrashed: vi.fn(() => Promise.resolve({ ok: true, value: [] })) });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    expect(container.textContent).toContain('回收站为空');
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="清空回收站"]')?.disabled,
    ).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  it('还原钮回调：按条目 nodeId 调 restoreNode，成功不 toast', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(
        <>
          <TrashPanel />
          <ToastHost />
        </>,
      );
    });
    await clickAriaLabel('还原 a.html');
    expect(api.restoreNode).toHaveBeenCalledWith({ nodeId: 5 });
    expect(document.body.textContent).not.toContain('还原失败');
    act(() => {
      tree.unmount();
    });
  });

  it('还原撞名 E_VFS_DUPLICATE_NAME → toast 呈现失败原因', async () => {
    stubTrashApi({
      restoreNode: vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: { code: 'E_VFS_DUPLICATE_NAME', message: '同级已存在同名文件或文件夹' },
        }),
      ),
    });
    const tree = createRoot(container);
    await act(async () => {
      tree.render(
        <>
          <TrashPanel />
          <ToastHost />
        </>,
      );
    });
    await clickAriaLabel('还原 a.html');
    expect(document.body.textContent).toContain('还原失败：同级已存在同名文件或文件夹');
    act(() => {
      tree.unmount();
    });
  });

  it('彻底删除二次确认（应用内弹窗）：取消不发起 purgeNode，确认后按 nodeId 发起', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    // 首次点击只打开确认弹窗：文案逐字沿用原 window.confirm 文案，且未发起任何写侧调用
    await clickAriaLabel('彻底删除 a.html');
    expect(document.querySelector('.lt-confirm')?.textContent).toContain(
      '彻底删除「a.html」？不可恢复',
    );
    expect(api.purgeNode).not.toHaveBeenCalled();
    // 取消分支：弹窗关闭、不发起
    await clickDialogButton('取消操作');
    expect(document.querySelector('.lt-confirm')).toBeNull();
    expect(api.purgeNode).not.toHaveBeenCalled();
    // 确认分支：放行后按条目 id 发起，弹窗随即收口
    await clickAriaLabel('彻底删除 a.html');
    await clickDialogButton('确认操作');
    expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 5 });
    expect(document.querySelector('.lt-confirm')).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('清空强确认（应用内弹窗）：文案含条目数（D4），确认后逐项 purge', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    await clickAriaLabel('清空回收站');
    // 强确认文案逐字（brief D4）：「将彻底删除 N 个节点，不可恢复」
    expect(document.querySelector('.lt-confirm')?.textContent).toContain(
      '将彻底删除 2 个节点，不可恢复',
    );
    expect(api.purgeNode).not.toHaveBeenCalled();
    await clickDialogButton('确认操作');
    expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 5 });
    expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 6 });
    act(() => {
      tree.unmount();
    });
  });

  it('清空强确认取消：弹窗关闭且不发起任何 purgeNode', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    await clickAriaLabel('清空回收站');
    await clickDialogButton('取消操作');
    expect(document.querySelector('.lt-confirm')).toBeNull();
    expect(api.purgeNode).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
  });

  it('trash 域广播重拉：restored/purged/trashed 触发 listTrashed 重拉，created 不触发；卸载退订成对', async () => {
    const { api, vfsHandlers, unsub } = stubTrashApi();
    // Record 下标访问判空收窄（noUncheckedIndexedAccess；测试桩 cast 先例同 ipc.test）
    const listTrashedSpy = api.listTrashed as ReturnType<typeof vi.fn>;
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    expect(listTrashedSpy).toHaveBeenCalledTimes(1);
    // restored 广播 → 重拉（桩改回含新条目，重拉后呈现）
    listTrashedSpy.mockImplementation(() =>
      Promise.resolve({ ok: true, value: [trashed(5, 'a.html'), trashed(7, 'new.css')] }),
    );
    await act(async () => {
      vfsHandlers[0]?.({ rev: 1, event: { type: 'restored', node: meta(9, 'x.html') } });
    });
    expect(listTrashedSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('new.css');
    // 非 trash 域事件（created）不触发重拉
    await act(async () => {
      vfsHandlers[0]?.({ rev: 2, event: { type: 'created', node: meta(10, 'y.html') } });
    });
    expect(listTrashedSpy).toHaveBeenCalledTimes(2);
    // 卸载必须调用退订函数（资源成对纪律）
    act(() => {
      tree.unmount();
    });
    expect(unsub).toHaveBeenCalled();
  });

  it('本地过滤联动：输入关键词后列表即时收窄（filterTrashed 接线）', async () => {
    stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<TrashPanel />);
    });
    expect(container.textContent).toContain('a.html');
    expect(container.textContent).toContain('b.css');
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="过滤回收站"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'b');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('b.css');
    expect(container.textContent).not.toContain('a.html');
    act(() => {
      tree.unmount();
    });
  });
});

// Workspace 活动视图 trash 态接线（M5 三态容器 → M6 活动栏语义）：
// 活动栏「回收站」图标钮进入、Esc/侧栏头返回钮回树态；TrashPanel 数据自持，Workspace 不代理拉取
describe('Workspace trash 态接线', () => {
  it('活动栏「回收站」切换 trash 态（TrashPanel 挂载并首拉）；Esc 返回树态', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="回收站"]')?.click();
    });
    expect(container.querySelector('section[aria-label="回收站"]')).not.toBeNull();
    expect(api.listTrashed).toHaveBeenCalled();
    expect(container.textContent).toContain('a.html');
    // Esc 返回树态（window 级 keydown 成对挂卸，moveMode Esc 同款）
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('section[aria-label="回收站"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  it('「返回资源树」钮返回树态，回收站面板随态卸载', async () => {
    stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="回收站"]')?.click();
    });
    expect(container.querySelector('section[aria-label="回收站"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="返回资源树"]')?.click();
    });
    expect(container.querySelector('section[aria-label="回收站"]')).toBeNull();
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    act(() => {
      tree.unmount();
    });
  });
});
