// @vitest-environment jsdom
// 回收站面板冒烟（M5 批次②）：列表渲染名称/原路径/删除时间、还原回调、还原撞名 toast、
// 彻底删除 window.confirm 二次确认、清空强确认、trash 域广播重拉（restored 重拉/created 不拉）、
// 本地过滤联动；另覆盖 Workspace 三态容器 trash 态接线（打开回收站/Esc 返回/返回钮）。
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
  api: Record<string, ReturnType<typeof vi.fn>>;
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
    // Workspace 装配所需通道（trash 态接线用例挂载 Workspace；树态首拉走这些桩）
    settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
    listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    onShellCommand: vi.fn(() => vi.fn()),
    // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅
    onIoProgress: vi.fn(() => vi.fn()),
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

  it('彻底删除二次确认：confirm 取消不发起 purgeNode，确认后按 nodeId 发起', async () => {
    const { api } = stubTrashApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<TrashPanel />);
      });
      await clickAriaLabel('彻底删除 a.html');
      expect(confirmSpy).toHaveBeenCalledWith('彻底删除「a.html」？不可恢复');
      expect(api.purgeNode).not.toHaveBeenCalled();
      // 确认分支：放行后按条目 id 发起
      confirmSpy.mockReturnValue(true);
      await clickAriaLabel('彻底删除 a.html');
      expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 5 });
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('清空强确认：文案含条目数（D4），确认后逐项 purge', async () => {
    const { api } = stubTrashApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<TrashPanel />);
      });
      await clickAriaLabel('清空回收站');
      // 强确认文案逐字（brief D4）：「将彻底删除 N 个节点，不可恢复」
      expect(confirmSpy).toHaveBeenCalledWith('将彻底删除 2 个节点，不可恢复');
      expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 5 });
      expect(api.purgeNode).toHaveBeenCalledWith({ nodeId: 6 });
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('清空强确认取消：不发起任何 purgeNode', async () => {
    const { api } = stubTrashApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const tree = createRoot(container);
      await act(async () => {
        tree.render(<TrashPanel />);
      });
      await clickAriaLabel('清空回收站');
      expect(api.purgeNode).not.toHaveBeenCalled();
      act(() => {
        tree.unmount();
      });
    } finally {
      confirmSpy.mockRestore();
    }
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

// Workspace 三态视图容器（本任务先立 trash 态最小切换，search 态归 Task 7）：
// 工具栏「回收站」切换钮进入、Esc/返回钮回树态；TrashPanel 数据自持，Workspace 不代理拉取
describe('Workspace 三态容器 trash 态接线', () => {
  it('「打开回收站」切换 trash 态（TrashPanel 挂载并首拉）；Esc 返回树态', async () => {
    const { api } = stubTrashApi();
    const tree = createRoot(container);
    await act(async () => {
      tree.render(<Workspace />);
    });
    expect(container.querySelector('nav[aria-label="资源树"]')).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开回收站"]')?.click();
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
      container.querySelector<HTMLButtonElement>('button[aria-label="打开回收站"]')?.click();
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
