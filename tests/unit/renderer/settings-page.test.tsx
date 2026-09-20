// @vitest-environment jsdom
// 设置页（M5 批次③ Task 8/9）冒烟：SettingsPage 表单交互（四区导航/主题三选/字号与去抖、
// 自动保存滑块钳制/备份区自动开关与立即备份/还原强确认/维护区占位/返回钮）+ Workspace 设置
// 态接线（状态栏与菜单 open-settings 双入口、写链 get→merge→set 全量、.dark 类切换与
// matchMedia system 态监听、字号 props 透传、保存失败 toast 回滚、备份列表拉取与广播重拉、
// 还原失败 toast）。
// 断言以 role/aria 语义为主；radix Select 沿 search-panel 键盘驱动先例（Enter 开启 →
// ArrowDown 高亮 → 目标项 Enter 选中）；jsdom 无 matchMedia（setup.ts 空桩兜底既有用例），
// system 态监听断言以可编程桩替换并翻转 matches 派发 change。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import type { SettingsData } from '../../../src/shared/settings-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';
import type { BackupEntry } from '../../../src/shared/backup-contract';
import { SettingsPage } from '../../../src/renderer/src/features/settings/SettingsPage';
import { ToastHost } from '../../../src/renderer/src/features/ui/Toast';
import { Workspace } from '../../../src/renderer/src/features/workspace/Workspace';

// EditorPanel props 捕获桩：字号「props 透传」断言面——Workspace 外观变更后新字号到达
// EditorPanel 即契约成立（CM6 内部渲染行为归 editor-panel.test.tsx，此处不重复）
const editorPanelCapture = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('../../../src/renderer/src/features/editor/EditorPanel', () => ({
  EditorPanel: (props: Record<string, unknown>): null => {
    editorPanelCapture.last = props;
    return null;
  },
}));

// —— Workspace 桥桩（quick-open 先例）：设置域可编程（get 失败/set 失败两异常面）——
function stubWorkspaceApi(overrides: { settingsSetOk?: boolean; backupRestoreOk?: boolean } = {}): {
  api: Record<string, ReturnType<typeof vi.fn>>;
  settingsGet: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;
  shellHandlers: Array<(command: ShellCommand) => void>;
  backupDoneHandlers: Array<(fileName: string) => void>;
} {
  let current: SettingsData = structuredClone(DEFAULT_SETTINGS);
  const shellHandlers: Array<(command: ShellCommand) => void> = [];
  const backupDoneHandlers: Array<(fileName: string) => void> = [];
  const settingsGet = vi.fn(() => Promise.resolve({ ok: true as const, value: current }));
  const settingsSet = vi.fn((next: SettingsData) => {
    if (overrides.settingsSetOk === false) {
      return Promise.resolve({
        ok: false as const,
        error: { code: 'E_IPC_BAD_PAYLOAD', message: '设置写入失败' },
      });
    }
    current = next;
    return Promise.resolve({ ok: true as const, value: next });
  });
  // 备份域桩（M5 Task 9）：列表返回单条真实形态条目（还原流程以它驱动）
  const backupEntry: BackupEntry = {
    fileName: 'lt-20260920-080000.db',
    sizeBytes: 1024,
    modifiedAt: '2026-09-20T08:00:00.000+08:00',
  };
  const backupList = vi.fn(() => Promise.resolve({ ok: true as const, value: [backupEntry] }));
  const backupCreate = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      value: { fileName: 'lt-20260921-080000.db' },
    }),
  );
  const backupRestore = vi.fn(() => {
    if (overrides.backupRestoreOk === false) {
      return Promise.resolve({
        ok: false as const,
        error: { code: 'E_BACKUP_CORRUPT', message: '备份文件已损坏，无法还原' },
      });
    }
    return Promise.resolve({ ok: true as const, value: { relaunch: true } });
  });
  const api = {
    listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    createNode: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    readFile: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    writeFile: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    trashNode: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    getNode: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    forceClose: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    searchQuery: vi.fn(() =>
      Promise.resolve({ ok: true, value: { hits: [], total: 0, truncated: false } }),
    ),
    settingsGet,
    settingsSet,
    backupList,
    backupCreate,
    backupRestore,
    onShellCommand: vi.fn((callback: (command: ShellCommand) => void) => {
      shellHandlers.push(callback);
      return vi.fn();
    }),
    onVfsChanged: vi.fn(() => vi.fn()),
    onBackupDone: vi.fn((callback: (fileName: string) => void) => {
      backupDoneHandlers.push(callback);
      return vi.fn();
    }),
    // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅，桩按契约形态注入
    onIoProgress: vi.fn(() => vi.fn()),
  };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return { api, settingsGet, settingsSet, shellHandlers, backupDoneHandlers };
}

// —— matchMedia 可编程桩：matches 可翻转 + change 监听记账（cleanup 成对断言面）——
interface MatchMediaStub {
  /** 翻转系统偏好并派发 change 事件（jsdom 无原生 matchMedia，语义由桩承载） */
  setMatches: (value: boolean) => void;
  /** 当前仍挂驻的 change 监听数（卸载成对断言用） */
  listenerCount: () => number;
  counts: { added: number; removed: number };
}

function stubMatchMedia(initialMatches: boolean): MatchMediaStub {
  const counts = { added: 0, removed: 0 };
  const listeners = new Set<() => void>();
  let matches = initialMatches;
  const mql = {
    get matches(): boolean {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type: string, listener: () => void): void => {
      if (type === 'change') {
        listeners.add(listener);
        counts.added += 1;
      }
    },
    removeEventListener: (type: string, listener: () => void): void => {
      if (type === 'change') {
        listeners.delete(listener);
        counts.removed += 1;
      }
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    value: (): MediaQueryList => mql as unknown as MediaQueryList,
    configurable: true,
    writable: true,
  });
  return {
    setMatches: (value: boolean): void => {
      matches = value;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: (): number => listeners.size,
    counts,
  };
}

let container: HTMLElement;
let tree: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  tree = createRoot(container);
  document.documentElement.classList.remove('dark');
  editorPanelCapture.last = null;
  currentTheme = 'system';
  // 回调桩每用例新建（调用记录零跨用例泄漏）；主题桩同步更新受控值并重渲染——模拟
  // Workspace 提升态回灌（受控 Select 在 props 不变时不会重复触发 onValueChange）
  onThemeChange = vi.fn((theme: ThemeValue) => {
    currentTheme = theme;
    renderPage();
  });
  onFontSizeChange = vi.fn();
  onDebounceChange = vi.fn();
  onAutoSaveChange = vi.fn();
  onBack = vi.fn();
  // 备份域（M5 Task 9）：受控值与回调桩（开关桩同步受控值并重渲染，checkbox 同 Select 先例）
  currentBackups = [
    {
      fileName: 'lt-20260920-080000.db',
      sizeBytes: 1024,
      modifiedAt: '2026-09-20T08:00:00.000+08:00',
    },
  ];
  backupAutoEnabled = true;
  onBackupAutoEnabledChange = vi.fn((enabled: boolean) => {
    backupAutoEnabled = enabled;
    renderPage();
  });
  onCreateBackup = vi.fn();
  onRestoreBackup = vi.fn();
});

afterEach(() => {
  tree.unmount();
  container.remove();
  document.body.innerHTML = '';
});

/** 冲刷 promise 续体（settingsGet/settingsSet 微任务链）后完成重渲染 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {});
}

// —— SettingsPage 表单交互（props 级冒烟）——

type ThemeValue = 'light' | 'dark' | 'system';
let currentTheme: ThemeValue;
let onThemeChange: Mock<(theme: ThemeValue) => void>;
let onFontSizeChange: Mock<(fontSize: number) => void>;
let onDebounceChange: Mock<(debounceMs: number) => void>;
let onAutoSaveChange: Mock<(autoSaveMs: number) => void>;
let onBack: Mock<() => void>;
// 备份域受控值与回调桩（M5 Task 9）
let currentBackups: BackupEntry[];
let backupAutoEnabled: boolean;
let onBackupAutoEnabledChange: Mock<(enabled: boolean) => void>;
let onCreateBackup: Mock<() => void>;
let onRestoreBackup: Mock<(fileName: string) => void>;

/** 以受控 props 渲染设置页（默认外观区；主题/备份显示值随各桩联动） */
function renderPage(): void {
  act(() => {
    tree.render(
      <SettingsPage
        theme={currentTheme}
        editorFontSize={14}
        debounceMs={300}
        autoSaveMs={3000}
        backups={currentBackups}
        backupAutoEnabled={backupAutoEnabled}
        onBackupAutoEnabledChange={onBackupAutoEnabledChange}
        onCreateBackup={onCreateBackup}
        onRestoreBackup={onRestoreBackup}
        onThemeChange={onThemeChange}
        onFontSizeChange={onFontSizeChange}
        onDebounceChange={onDebounceChange}
        onAutoSaveChange={onAutoSaveChange}
        onBack={onBack}
      />,
    );
  });
}

const settingsRoot = (): Element | null => document.querySelector('[aria-label="设置"]');
/** 最新一条 toast（toast 模块级队列跨用例存活——3s 定时器为真实时钟，断言取队尾新条） */
const latestToastText = (): string =>
  [...document.querySelectorAll('.lt-toast')].at(-1)?.textContent ?? '';
const navButton = (label: string): HTMLButtonElement | null => {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('nav button'));
  return buttons.find((b) => b.textContent === label) ?? null;
};
const themeTrigger = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-slot="select-trigger"]');
const range = (label: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${label}"]`);
const checkbox = (label: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`);

/** 向滑块注入越界/界内值并派发 input（原生 setter + input 事件，rename-dialog 同款先例） */
function setRangeValue(label: string, value: number): void {
  const input = range(label);
  if (!input) throw new Error(`无滑块 ${label}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 主题 select 键盘驱动（search-panel pickTypeOption 先例）：Enter 开启 → ArrowDown → 目标项 Enter */
async function pickThemeOption(label: string): Promise<void> {
  const trigger = themeTrigger();
  if (!trigger) throw new Error('无主题 select');
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  const targetIndex = options.findIndex((el) => el.textContent === label);
  if (targetIndex < 0) {
    throw new Error(
      `主题 select 无选项 ${label}（实际：${options.map((o) => o.textContent ?? '').join('/')}）`,
    );
  }
  const currentLabel = trigger.textContent ?? '';
  const currentIndex = options.findIndex((el) => el.textContent === currentLabel);
  const steps = Math.max(0, targetIndex - currentIndex);
  const openTrigger = document.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  if (!openTrigger) throw new Error('主题 select 开启后无触发器');
  act(() => {
    const target = options[targetIndex];
    if (target) target.focus();
    for (let i = 0; i < steps; i += 1) {
      openTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await flushMicrotasks();
}

describe('SettingsPage 设置页表单', () => {
  it('默认呈现外观区（主题三选 + 字号滑块）；导航切换到编辑器区渲染去抖/自动保存滑块后可切回', () => {
    renderPage();
    expect(settingsRoot()).not.toBeNull();
    expect(themeTrigger()).not.toBeNull();
    expect(range('编辑器字号')).not.toBeNull();
    expect(range('预览去抖')).toBeNull(); // 编辑器区尚未进入
    act(() => {
      navButton('编辑器')?.click();
    });
    expect(range('预览去抖')).not.toBeNull();
    expect(range('自动保存间隔')).not.toBeNull();
    act(() => {
      navButton('外观')?.click();
    });
    expect(themeTrigger()).not.toBeNull();
  });

  it('备份/维护导航项启用：备份区渲染自动开关与立即备份钮，维护区渲染禁用占位钮', () => {
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    expect(checkbox('每日自动备份')).not.toBeNull();
    expect(container.querySelector('button[aria-label="立即备份"]')).not.toBeNull();
    act(() => {
      navButton('维护')?.click();
    });
    // 重建搜索索引归后续批次（M2 §7.1 例程接线降级，登记 TASK.md）：disabled 占位
    const rebuild = container.querySelector<HTMLButtonElement>('button[aria-label="重建搜索索引"]');
    expect(rebuild).not.toBeNull();
    expect(rebuild?.disabled).toBe(true);
    act(() => {
      navButton('外观')?.click();
    });
    expect(themeTrigger()).not.toBeNull();
  });

  it('备份区：空列表呈现空态提示，有备份时按文件名渲染条目（大小/时间/还原入口）', () => {
    currentBackups = [];
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    expect(document.querySelector('.lt-backup-empty')?.textContent).toContain('暂无备份');
    currentBackups = [
      {
        fileName: 'lt-20260920-080000.db',
        sizeBytes: 1024,
        modifiedAt: '2026-09-20T08:00:00.000+08:00',
      },
    ];
    renderPage();
    const item = document.querySelector('.lt-backup-item');
    expect(item?.textContent).toContain('lt-20260920-080000.db');
    expect(item?.textContent).toContain('1.0KB');
    expect(item?.querySelector('button[aria-label="还原到 lt-20260920-080000.db"]')).not.toBeNull();
  });

  it('立即备份钮回调 onCreateBackup', () => {
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="立即备份"]')?.click();
    });
    expect(onCreateBackup).toHaveBeenCalledTimes(1);
  });

  it('每日自动备份开关切换回调 onBackupAutoEnabledChange（true→false→true）', () => {
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    const toggle = checkbox('每日自动备份');
    if (!toggle) throw new Error('无自动备份开关');
    act(() => {
      toggle.click();
    });
    expect(onBackupAutoEnabledChange).toHaveBeenCalledWith(false);
    act(() => {
      checkbox('每日自动备份')?.click();
    });
    expect(onBackupAutoEnabledChange).toHaveBeenLastCalledWith(true);
  });

  it('还原强确认：描述含「将覆盖当前全部数据并重启应用」；取消不还原，确认才回调 onRestoreBackup', () => {
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    // 第一层：点「还原到此点」弹出强确认（radix alert-dialog，role=alertdialog）
    act(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="还原到 lt-20260920-080000.db"]')
        ?.click();
    });
    const confirmDialog = document.querySelector('[role="alertdialog"]');
    expect(confirmDialog?.textContent).toContain('将覆盖当前全部数据并重启应用');
    // 取消：不触发还原，浮层收起
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="取消还原"]')?.click();
    });
    expect(onRestoreBackup).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    // 第二层：确认后回调 onRestoreBackup 并收起浮层
    act(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="还原到 lt-20260920-080000.db"]')
        ?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="确认还原"]')?.click();
    });
    expect(onRestoreBackup).toHaveBeenCalledWith('lt-20260920-080000.db');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('主题三选即改即回调 onThemeChange（light/dark/system 全枚举）', async () => {
    renderPage();
    await pickThemeOption('暗色');
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    await pickThemeOption('跟随系统');
    expect(onThemeChange).toHaveBeenCalledWith('system');
    await pickThemeOption('亮色');
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('字号滑块越界值钳制后回调（100→24、1→12）', () => {
    renderPage();
    setRangeValue('编辑器字号', 100);
    expect(onFontSizeChange).toHaveBeenLastCalledWith(24);
    setRangeValue('编辑器字号', 1);
    expect(onFontSizeChange).toHaveBeenLastCalledWith(12);
  });

  it('去抖/自动保存滑块越界值钳制后回调（5000→2000、120000→60000）', () => {
    renderPage();
    act(() => {
      navButton('编辑器')?.click();
    });
    setRangeValue('预览去抖', 5000);
    expect(onDebounceChange).toHaveBeenLastCalledWith(2000);
    setRangeValue('自动保存间隔', 120000);
    expect(onAutoSaveChange).toHaveBeenLastCalledWith(60000);
  });

  it('返回钮回调 onBack（工作台据此关闭覆盖层）', () => {
    renderPage();
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回工作台"]');
    expect(back).not.toBeNull();
    act(() => {
      back?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// —— Workspace 设置态接线 ——

const statusSettingsButton = (): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]');

/** 以 Workspace 渲染设置态（默认已挂 matchMedia 桩 + 桥桩），返回桩引用 */
function renderWorkspace(
  overrides: { settingsSetOk?: boolean; backupRestoreOk?: boolean; withToastHost?: boolean } = {},
): {
  api: Record<string, ReturnType<typeof vi.fn>>;
  settingsGet: ReturnType<typeof vi.fn>;
  settingsSet: ReturnType<typeof vi.fn>;
  shellHandlers: Array<(command: ShellCommand) => void>;
  backupDoneHandlers: Array<(fileName: string) => void>;
} {
  stubMatchMedia(false); // system 意图 + 系统亮色 → 解析 light，.dark 初始不挂
  const stub = stubWorkspaceApi(overrides);
  act(() => {
    tree.render(
      overrides.withToastHost ? (
        <>
          <Workspace />
          <ToastHost />
        </>
      ) : (
        <Workspace />
      ),
    );
  });
  return { ...stub, backupDoneHandlers: stub.backupDoneHandlers };
}

describe('Workspace 设置态接线', () => {
  it('状态栏「设置」钮打开设置覆盖层；返回钮关闭回工作台', async () => {
    renderWorkspace();
    await flushMicrotasks();
    expect(settingsRoot()).toBeNull();
    expect(statusSettingsButton()).not.toBeNull();
    act(() => {
      statusSettingsButton()?.click();
    });
    expect(settingsRoot()).not.toBeNull();
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回工作台"]');
    act(() => {
      back?.click();
    });
    expect(settingsRoot()).toBeNull();
  });

  it('shell:command { type: "open-settings" } 打开设置覆盖层（switch 分支追加）', async () => {
    const { shellHandlers } = renderWorkspace();
    await flushMicrotasks();
    expect(settingsRoot()).toBeNull();
    const handler = shellHandlers[0];
    if (!handler) throw new Error('Workspace 未订阅 shell:command');
    act(() => {
      handler({ type: 'open-settings' });
    });
    expect(settingsRoot()).not.toBeNull();
  });

  it('主题三选写入即经串行链 get→merge→set 全量写 appearance 域，.dark 类随之切换', async () => {
    const { settingsSet } = renderWorkspace();
    await flushMicrotasks();
    expect(document.documentElement.classList.contains('dark')).toBe(false); // system→亮色
    act(() => {
      statusSettingsButton()?.click();
    });
    await pickThemeOption('暗色');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // 全量写断言：get→merge→set，payload 为完整 SettingsData（appearance 域整体替换、其余域原样保留）
    await flushMicrotasks();
    expect(settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      appearance: { theme: 'dark', editorFontSize: 14 },
    });
    await pickThemeOption('亮色');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('system 态经 matchMedia 监听解析：系统翻转即切 .dark，卸载监听成对摘除', async () => {
    const mq = stubMatchMedia(false);
    stubWorkspaceApi();
    act(() => {
      tree.render(<Workspace />);
    });
    await flushMicrotasks();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => {
      mq.setMatches(true); // 系统偏好翻转为暗色 → change 事件
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => {
      mq.setMatches(false);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(mq.counts.added).toBe(1);
    tree.unmount();
    expect(mq.counts.removed).toBe(1);
    expect(mq.listenerCount()).toBe(0);
  });

  it('字号滑块越界值钳制后写入，且 EditorPanel 收到钳制后字号（props 透传）', async () => {
    const { settingsSet } = renderWorkspace();
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    setRangeValue('编辑器字号', 100);
    await flushMicrotasks();
    expect(settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ appearance: { theme: 'system', editorFontSize: 24 } }),
    );
    expect(editorPanelCapture.last?.['editorFontSize']).toBe(24);
  });

  it('设置保存失败 → toast 提示且显示值回滚（EditorPanel 字号回原值）', async () => {
    renderWorkspace({ settingsSetOk: false, withToastHost: true });
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    setRangeValue('编辑器字号', 18);
    // 乐观更新先行：act 内同步提交，早于任何持久化续体
    expect(editorPanelCapture.last?.['editorFontSize']).toBe(18);
    await flushMicrotasks(); // 冲刷写链：get→set 失败→回滚续体
    const toast = document.querySelector('.lt-toast');
    expect(toast?.textContent).toContain('设置保存失败');
    expect(editorPanelCapture.last?.['editorFontSize']).toBe(14); // 失败回滚显示
  });

  // —— 备份域接线（M5 批次③ Task 9）——

  /** 打开设置页并切入备份区（Workspace 级备份用例的公共前导） */
  async function openBackupSection(): Promise<void> {
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    act(() => {
      navButton('备份')?.click();
    });
  }

  it('打开设置后拉取备份列表；backup:done 广播到达重拉；关闭设置退订成对', async () => {
    const { api, backupDoneHandlers } = renderWorkspace();
    await flushMicrotasks();
    expect(api.backupList).not.toHaveBeenCalled(); // 未开设置不预取
    await openBackupSection();
    expect(api.backupList).toHaveBeenCalledTimes(1);
    const item = document.querySelector('.lt-backup-item');
    expect(item?.textContent).toContain('lt-20260920-080000.db');
    // 备份完成广播到达 → 列表重拉（立即备份/每日自动共用同一刷新链）
    act(() => {
      backupDoneHandlers[0]?.('lt-20260921-080000.db');
    });
    await flushMicrotasks();
    expect(api.backupList).toHaveBeenCalledTimes(2);
    // 关闭设置：列表随覆盖层卸载，订阅退订成对
    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回工作台"]');
    act(() => {
      back?.click();
    });
    expect(api.onBackupDone).toHaveBeenCalledTimes(1);
    const unsubscribe = (api.onBackupDone as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(unsubscribe).toBeDefined();
    expect((unsubscribe as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('每日自动备份开关切换写入 backup 域（get→merge→set 全量写）', async () => {
    const { settingsSet } = renderWorkspace();
    await flushMicrotasks();
    await openBackupSection();
    const toggle = checkbox('每日自动备份');
    if (!toggle) throw new Error('无自动备份开关');
    act(() => {
      toggle.click();
    });
    await flushMicrotasks();
    expect(settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      backup: { autoEnabled: false },
    });
  });

  it('立即备份经 backup:create，成功 toast 呈现备份文件名（列表刷新归 backup:done 广播）', async () => {
    const { api } = renderWorkspace({ withToastHost: true });
    await flushMicrotasks();
    await openBackupSection();
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="立即备份"]')?.click();
    });
    await flushMicrotasks();
    expect(api.backupCreate).toHaveBeenCalledTimes(1);
    expect(latestToastText()).toContain('lt-20260921-080000.db');
  });

  it('还原失败（未达 relaunch）toast 呈现原因；成功路径 fire-and-forget 不做 UI 态处理', async () => {
    const { api } = renderWorkspace({ backupRestoreOk: false, withToastHost: true });
    await flushMicrotasks();
    await openBackupSection();
    // 强确认链在 SettingsPage 级用例已覆盖，此处直接驱动确认钮验证 Workspace 失败分支
    act(() => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="还原到 lt-20260920-080000.db"]')
        ?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="确认还原"]')?.click();
    });
    await flushMicrotasks();
    expect(api.backupRestore).toHaveBeenCalledWith({ fileName: 'lt-20260920-080000.db' });
    expect(latestToastText()).toContain('还原失败');
  });
});
