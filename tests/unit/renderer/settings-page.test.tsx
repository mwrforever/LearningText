// @vitest-environment jsdom
// 设置标签页（M5 批次③ Task 8/9 + Task 16 补「启动时恢复工作区」开关 → M6 spec §2.7 重制）
// 冒烟：SettingsPage 表单交互（四区导航/主题三选/字号与去抖、自动保存滑块钳制/备份区自动开关
// 与立即备份/还原强确认/工作区恢复开关）+ Workspace 设置标签接线（状态栏齿轮与菜单
// open-settings 双入口、标签关闭钮收口、写链 get→merge→set 全量、.dark 类切换与 matchMedia
// system 态监听、字号 props 透传、保存失败 toast 回滚、备份列表拉取与广播重拉、还原失败 toast）。
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
import type { DataDirInfo } from '../../../src/shared/storage-contract';
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

/** 数据目录布局桩（M6 批次③）：默认位置（custom=false），storage 分区与接线用例共用 */
function stubStorageInfo(custom: boolean): DataDirInfo {
  return {
    root: 'C:/Users/t/AppData/Roaming/LearningText',
    dbFile: 'C:/Users/t/AppData/Roaming/LearningText/learningtext.db',
    backupsDir: 'C:/Users/t/AppData/Roaming/LearningText/backups',
    settingsFile: 'C:/Users/t/AppData/Roaming/LearningText/settings.json',
    custom,
  };
}

/** 文件节点 meta（withTab 桩专用：根下可开标签文件；M6 批次②起 HTML 走画布标签，
 *  EditorPanel 挂载需文本标签——夹具用 text/plain 保 CM 会话路径） */
function stubFileMeta(
  id: number,
  name: string,
): {
  id: number;
  parentId: number;
  nodeType: 'file';
  name: string;
  virtualPath: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/plain',
    size: 4,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}

function stubWorkspaceApi(
  overrides: { settingsSetOk?: boolean; backupRestoreOk?: boolean; withTab?: boolean } = {},
): {
  api: Record<string, unknown>;
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
  // withTab 桩（M6 起 EditorPanel 仅随激活 doc 标签挂载）：根下预置一个可开标签文件
  const tabFile = stubFileMeta(3, 'a.txt');
  const api = {
    listChildren: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: overrides.withTab === true ? [tabFile] : [],
      }),
    ),
    createNode: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    readFile: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { content: new TextEncoder().encode('<p>正文</p>'), meta: tabFile },
      }),
    ),
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
    // 数据目录域（M6 批次③）：设置标签打开期间拉取布局；迁移链路按用例驱动
    getDataDirInfo: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: stubStorageInfo(false) }),
    ),
    openPath: vi.fn(() => Promise.resolve({ ok: true as const, value: null })),
    pickDirectory: vi.fn(() => Promise.resolve({ ok: true as const, value: ['D:/new-home'] })),
    changeDataDir: vi.fn(() => Promise.resolve({ ok: true as const, value: { relaunch: true } })),
    // 状态栏文档计数与平台标识（M6 壳层装配路径）：挂载即查 countNodes，TitleBar 消费 platform
    countNodes: vi.fn(() => Promise.resolve({ ok: true as const, value: 0 })),
    platform: 'win32',
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
  // 启动恢复开关（Task 16）：受控值与回调桩（开关桩同步受控值并重渲染，checkbox 同备份开关先例）
  restoreOnStart = true;
  onRestoreOnStartChange = vi.fn((enabled: boolean) => {
    restoreOnStart = enabled;
    renderPage();
  });
  onCreateBackup = vi.fn();
  onRestoreBackup = vi.fn();
  // 数据与存储分区（M6 批次③）：受控布局值与两回调桩
  currentStorageInfo = stubStorageInfo(false);
  onOpenStorageDir = vi.fn();
  onChangeStorageDir = vi.fn();
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
// 备份域受控值与回调桩（M5 Task 9）
let currentBackups: BackupEntry[];
let backupAutoEnabled: boolean;
let onBackupAutoEnabledChange: Mock<(enabled: boolean) => void>;
// 启动恢复开关受控值与回调桩（Task 16）
let restoreOnStart: boolean;
let onRestoreOnStartChange: Mock<(enabled: boolean) => void>;
let onCreateBackup: Mock<() => void>;
let onRestoreBackup: Mock<(fileName: string) => void>;
// 数据与存储分区受控值与回调桩（M6 批次③）
let currentStorageInfo: DataDirInfo | null;
let onOpenStorageDir: Mock<() => void>;
let onChangeStorageDir: Mock<() => void>;

/** 以受控 props 渲染设置页（默认外观区；主题/备份/恢复开关/存储布局显示值随各桩联动） */
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
        restoreOnStart={restoreOnStart}
        onRestoreOnStartChange={onRestoreOnStartChange}
        onCreateBackup={onCreateBackup}
        onRestoreBackup={onRestoreBackup}
        onThemeChange={onThemeChange}
        onFontSizeChange={onFontSizeChange}
        onDebounceChange={onDebounceChange}
        onAutoSaveChange={onAutoSaveChange}
        storageInfo={currentStorageInfo}
        onOpenStorageDir={onOpenStorageDir}
        onChangeStorageDir={onChangeStorageDir}
      />,
    );
  });
}

// 设置页画布内嵌面（M6）：以 section 标签限定锚点——「设置」可访问名已被活动栏齿轮钮占用
const settingsRoot = (): Element | null => document.querySelector('section[aria-label="设置"]');
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
  it('默认呈现外观区（主题三选 + 字号滑块）；导航切换到编辑与预览区渲染去抖/自动保存滑块后可切回', () => {
    renderPage();
    expect(settingsRoot()).not.toBeNull();
    expect(themeTrigger()).not.toBeNull();
    expect(range('编辑器字号')).not.toBeNull();
    expect(range('预览去抖')).toBeNull(); // 编辑与预览区尚未进入
    act(() => {
      navButton('编辑与预览')?.click();
    });
    expect(range('预览去抖')).not.toBeNull();
    expect(range('自动保存间隔')).not.toBeNull();
    act(() => {
      navButton('外观')?.click();
    });
    expect(themeTrigger()).not.toBeNull();
  });

  it('备份/工作区导航项启用：备份区渲染自动开关与立即备份钮，工作区渲染启动恢复开关（M6 起无占位钮）', () => {
    renderPage();
    act(() => {
      navButton('备份')?.click();
    });
    expect(checkbox('每日自动备份')).not.toBeNull();
    expect(container.querySelector('button[aria-label="立即备份"]')).not.toBeNull();
    act(() => {
      navButton('工作区')?.click();
    });
    // 启动恢复工作区开关（Task 16，spec §3.2）：默认开启（出厂值 restoreOnStart=true）
    expect(checkbox('启动时恢复工作区')?.checked).toBe(true);
    // 「重建搜索索引」占位按钮已随 M6 移除（未实现功能不设计），工作区仅承载恢复开关
    expect(container.querySelector('button[aria-label="重建搜索索引"]')).toBeNull();
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

  it('启动恢复工作区开关切换回调 onRestoreOnStartChange（true→false→true）', () => {
    renderPage();
    act(() => {
      navButton('工作区')?.click();
    });
    const toggle = checkbox('启动时恢复工作区');
    if (!toggle) throw new Error('无启动恢复开关');
    act(() => {
      toggle.click();
    });
    expect(onRestoreOnStartChange).toHaveBeenCalledWith(false);
    expect(checkbox('启动时恢复工作区')?.checked).toBe(false); // 受控值回灌驱动视觉态
    act(() => {
      checkbox('启动时恢复工作区')?.click();
    });
    expect(onRestoreOnStartChange).toHaveBeenLastCalledWith(true);
    expect(checkbox('启动时恢复工作区')?.checked).toBe(true);
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
      navButton('编辑与预览')?.click();
    });
    setRangeValue('预览去抖', 5000);
    expect(onDebounceChange).toHaveBeenLastCalledWith(2000);
    setRangeValue('自动保存间隔', 120000);
    expect(onAutoSaveChange).toHaveBeenLastCalledWith(60000);
  });

  // —— 数据与存储分区（M6 批次③，FR-AUX-03）——

  it('数据与存储分区：默认位置呈现「默认」badge 与 root 路径；自定义位置换「自定义」badge', () => {
    renderPage();
    act(() => {
      navButton('数据与存储')?.click();
    });
    expect(document.querySelector('.lt-storage-badge')?.textContent).toBe('默认');
    expect(document.querySelector('.lt-storage-root')?.textContent).toBe(
      'C:/Users/t/AppData/Roaming/LearningText',
    );
    // 自定义位置：badge 随 storageInfo.custom 切换，路径照实呈现
    currentStorageInfo = { ...stubStorageInfo(true), root: 'D:/lt-data/LearningText' };
    renderPage();
    expect(document.querySelector('.lt-storage-badge')?.textContent).toBe('自定义');
    expect(document.querySelector('.lt-storage-root')?.textContent).toBe('D:/lt-data/LearningText');
  });

  it('数据与存储分区两钮分别回调 onOpenStorageDir / onChangeStorageDir', () => {
    renderPage();
    act(() => {
      navButton('数据与存储')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开数据目录"]')?.click();
    });
    expect(onOpenStorageDir).toHaveBeenCalledTimes(1);
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="更改数据位置"]')?.click();
    });
    expect(onChangeStorageDir).toHaveBeenCalledTimes(1);
  });

  it('storageInfo 尚未装载（null）→ 「正在读取…」占位且两钮不呈现（防空路径误触）', () => {
    currentStorageInfo = null;
    renderPage();
    act(() => {
      navButton('数据与存储')?.click();
    });
    expect(container.textContent).toContain('正在读取…');
    expect(container.querySelector('button[aria-label="打开数据目录"]')).toBeNull();
    expect(container.querySelector('button[aria-label="更改数据位置"]')).toBeNull();
  });
});

// —— Workspace 设置态接线 ——

const statusSettingsButton = (): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]');

/** 以 Workspace 渲染设置态（默认已挂 matchMedia 桩 + 桥桩），返回桩引用 */
function renderWorkspace(
  overrides: {
    settingsSetOk?: boolean;
    backupRestoreOk?: boolean;
    withTab?: boolean;
    withToastHost?: boolean;
  } = {},
): {
  api: Record<string, unknown>;
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
  it('状态栏「设置」钮打开设置伪标签（画布内嵌）；标签关闭钮「关闭设置」收口回工作台', async () => {
    renderWorkspace();
    await flushMicrotasks();
    expect(settingsRoot()).toBeNull();
    expect(statusSettingsButton()).not.toBeNull();
    act(() => {
      statusSettingsButton()?.click();
    });
    // 设置以伪标签形态呈现在画布区（M6 spec D3），TabBar 同步出现设置页签
    expect(settingsRoot()).not.toBeNull();
    expect(container.querySelector('button[aria-label="关闭设置"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
    });
    expect(settingsRoot()).toBeNull();
    expect(container.querySelector('button[aria-label="关闭设置"]')).toBeNull();
  });

  it('shell:command { type: "open-settings" } 打开设置伪标签（菜单命令同一收口）', async () => {
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
    // M6 起 EditorPanel 仅随激活 doc 标签挂载：withTab 预置文件并先开标签（props 断言的挂载前提）
    const { settingsSet } = renderWorkspace({ withTab: true });
    await flushMicrotasks();
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.txt')
        ?.click();
    });
    act(() => {
      statusSettingsButton()?.click();
    });
    setRangeValue('编辑器字号', 100);
    await flushMicrotasks();
    expect(settingsSet).toHaveBeenCalledWith(
      expect.objectContaining({ appearance: { theme: 'system', editorFontSize: 24 } }),
    );
    // 设置标签激活期间编辑器面板卸载：关闭设置标签回落 doc 标签后重挂，钳制后字号到达面板
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
    });
    expect(editorPanelCapture.last?.['editorFontSize']).toBe(24);
  });

  it('设置保存失败 → toast 提示且显示值回滚（EditorPanel 字号回原值）', async () => {
    renderWorkspace({ settingsSetOk: false, withTab: true, withToastHost: true });
    await flushMicrotasks();
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === 'a.txt')
        ?.click();
    });
    act(() => {
      statusSettingsButton()?.click();
    });
    setRangeValue('编辑器字号', 18);
    await flushMicrotasks(); // 冲刷写链：get→set 失败→回滚续体
    const toast = document.querySelector('.lt-toast');
    expect(toast?.textContent).toContain('设置保存失败');
    // 关闭设置标签回落 doc 标签：重挂面板收到的显示值已随失败回滚至原值
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
    });
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
    // 关闭设置：列表随标签页卸载，订阅退订成对
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
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

  it('启动恢复开关切换写入 workspace 域（get→merge→set 全量写，会话字段保留）', async () => {
    const { settingsSet } = renderWorkspace();
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    act(() => {
      navButton('工作区')?.click();
    });
    const toggle = checkbox('启动时恢复工作区');
    if (!toggle) throw new Error('无启动恢复开关');
    act(() => {
      toggle.click();
    });
    await flushMicrotasks();
    // 全量写断言：workspace 域合并写（tabNodeIds/activeTabNodeId 原样保留，仅开关翻转）
    expect(settingsSet).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: false },
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

// —— 数据目录域 Workspace 接线（M6 批次③）：设置标签打开期间拉取布局、
// 打开目录直达 openPath、更改位置经 pickDirectory → 强确认弹层 → changeDataDir ——

describe('Workspace 数据与存储接线（M6 批次③）', () => {
  it('打开设置标签拉取数据目录信息（storage:get-info）；关闭再开重拉（随标签进出装载）', async () => {
    const { api } = renderWorkspace();
    await flushMicrotasks();
    expect(api.getDataDirInfo).not.toHaveBeenCalled(); // 未开设置不预取
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    expect(api.getDataDirInfo).toHaveBeenCalledTimes(1);
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="关闭设置"]')?.click();
    });
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    expect(api.getDataDirInfo).toHaveBeenCalledTimes(2);
  });

  it('「打开数据目录」经 openPath 携登记簿内的当前数据根', async () => {
    const { api } = renderWorkspace();
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    act(() => {
      navButton('数据与存储')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开数据目录"]')?.click();
    });
    await flushMicrotasks();
    expect(api.openPath).toHaveBeenCalledWith({
      dir: 'C:/Users/t/AppData/Roaming/LearningText',
    });
  });

  it('更改数据位置：pickDirectory 单选 → 强确认弹层；取消不发起迁移，确认才调 changeDataDir 携目标目录', async () => {
    const { api } = renderWorkspace();
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    act(() => {
      navButton('数据与存储')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="更改数据位置"]')?.click();
    });
    await flushMicrotasks();
    // 目录选择弹窗为单选（迁移只收一个目标）
    expect(api.pickDirectory).toHaveBeenCalledWith({ multiple: false });
    // 强确认弹层（数据覆盖级操作）呈现迁移内容与重启语义
    const confirmDialog = document.querySelector('[role="alertdialog"]');
    expect(confirmDialog?.textContent).toContain('更改数据位置');
    expect(confirmDialog?.textContent).toContain('D:/new-home');
    expect(confirmDialog?.textContent).toContain('自动重启');
    // 取消：不发起迁移，弹层收起
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="取消迁移"]')?.click();
    });
    expect(api.changeDataDir).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    // 再走一遍后确认：changeDataDir 携对话框产出的目标目录
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="更改数据位置"]')?.click();
    });
    await flushMicrotasks();
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="确认迁移"]')?.click();
    });
    await flushMicrotasks();
    expect(api.changeDataDir).toHaveBeenCalledWith({ targetDir: 'D:/new-home' });
  });

  it('迁移失败（未达 relaunch）toast 呈现原因并清确认态（可重试）', async () => {
    const { api } = renderWorkspace({ withToastHost: true });
    (api.changeDataDir as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'E_STORAGE_MIGRATE_FAILED', message: '目标目录不可写' },
      }),
    );
    await flushMicrotasks();
    act(() => {
      statusSettingsButton()?.click();
    });
    await flushMicrotasks();
    act(() => {
      navButton('数据与存储')?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="更改数据位置"]')?.click();
    });
    await flushMicrotasks();
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="确认迁移"]')?.click();
    });
    await flushMicrotasks();
    expect(latestToastText()).toContain('数据迁移失败');
    expect(latestToastText()).toContain('目标目录不可写');
    // 失败清确认态：弹层收起（用户可改道重试）
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
