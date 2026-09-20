// 菜单装配（M4 spec §5.2 D5）：模板结构（文件/搜索/导入导出 + id/accelerator/disabled）+ 命令单通道转发
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Menu } from 'electron';
import { IPC } from '../../../src/shared/ipc';
import { createMenuTemplate, installApplicationMenu } from '../../../src/main/menu/menu';

// brief 实施注实跑适配：vi.mock 工厂不可闭包引用模块级变量，send 以 vi.hoisted
// 提升为可断言桩（getAllWindows 返回的窗口统一挂同一 send 实例），断言等价迁移
const sendMock = vi.hoisted(() => vi.fn<(channel: string, payload: unknown) => void>());

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), whenReady: vi.fn(() => Promise.resolve()), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => [{ webContents: { send: sendMock } }]) },
  Menu: { buildFromTemplate: vi.fn((t: unknown) => t), setApplicationMenu: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

describe('createMenuTemplate', () => {
  it('文件菜单含新建文件/新建目录/保存（id 与 accelerator 逐字），全局搜索与导入导出 disabled 占位', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const fileMenu = template.find((m) => m.label === '文件');
    expect(fileMenu).toBeDefined();
    const items = fileMenu?.submenu ?? [];
    const save = items.find((item) => item.id === 'menu-save');
    expect(save?.['accelerator']).toBe('CmdOrCtrl+S');
    expect(save?.['enabled']).toBeUndefined(); // 可用项不设 disabled
    const searchMenu = template.find((m) => m.label === '搜索');
    const searchItems = searchMenu?.submenu ?? [];
    // M5 Task 6：快速打开已启用（不再 disabled 占位；可用项不设 enabled——与保存项同约定）
    const quickOpen = searchItems.find((item) => item['label'] === '快速打开');
    expect(quickOpen?.['enabled']).not.toBe(false);
    expect(quickOpen?.['accelerator']).toBe('CmdOrCtrl+P');
    // M5 Task 7：全局搜索启用（search 态 UI 落地），经 id 触发面下发命令
    const globalSearch = searchItems.find((item) => item['label'] === '全局搜索');
    expect(globalSearch?.['enabled']).not.toBe(false);
    expect(globalSearch?.['accelerator']).toBe('CmdOrCtrl+Shift+F');
    expect(globalSearch?.['id']).toBe('menu-global-search');
    const ioMenu = template.find((m) => m.label === '导入导出');
    expect(ioMenu).toBeDefined();
  });

  it('点击保存项 → 单通道 shell:command 下发 { type: "save" }（遍历全部窗口）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const fileMenu = template.find((m) => m.label === '文件');
    const save = (fileMenu?.submenu ?? []).find((item) => item['id'] === 'menu-save');
    (save?.['click'] as () => void)();
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'save' });
  });

  it('点击新建文件/新建目录项 → 同通道 shell:command 下发对应命令（E2E 按 id 触发面）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const items = template.find((m) => m.label === '文件')?.submenu ?? [];
    (items.find((item) => item['id'] === 'menu-new-file')?.['click'] as () => void)();
    (items.find((item) => item['id'] === 'menu-new-dir')?.['click'] as () => void)();
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'new-file' });
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'new-dir' });
  });

  it('点击快速打开项 → 同通道下发 { type: "quick-open" }（ShellCommand 联合扩型）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const items = template.find((m) => m.label === '搜索')?.submenu ?? [];
    const quickOpen = items.find((item) => item['id'] === 'menu-quick-open');
    expect(quickOpen).toBeDefined();
    (quickOpen?.['click'] as () => void)();
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'quick-open' });
  });

  it('点击全局搜索项 → 同通道下发 { type: "global-search" }（ShellCommand 联合扩型）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const items = template.find((m) => m.label === '搜索')?.submenu ?? [];
    const globalSearch = items.find((item) => item['id'] === 'menu-global-search');
    expect(globalSearch).toBeDefined();
    (globalSearch?.['click'] as () => void)();
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'global-search' });
  });

  it('文件菜单含「设置…」项（id menu-settings、accelerator CmdOrCtrl+,，M5 Task 8）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const items = template.find((m) => m.label === '文件')?.submenu ?? [];
    const settings = items.find((item) => item['label'] === '设置…');
    expect(settings).toBeDefined();
    expect(settings?.['id']).toBe('menu-settings');
    expect(settings?.['accelerator']).toBe('CmdOrCtrl+,');
    expect(settings?.['enabled']).not.toBe(false); // 可用项不设 disabled
  });

  it('点击设置项 → 同通道下发 { type: "open-settings" }（ShellCommand 联合扩型）', () => {
    const template = createMenuTemplate(false) as Array<{
      label: string;
      submenu: Array<Record<string, unknown>>;
    }>;
    const items = template.find((m) => m.label === '文件')?.submenu ?? [];
    const settings = items.find((item) => item['label'] === '设置…');
    expect(settings).toBeDefined();
    (settings?.['click'] as () => void)();
    expect(sendMock).toHaveBeenCalledWith(IPC.shellCommand, { type: 'open-settings' });
  });

  it('macOS 模板首项为 appMenu role；Windows 非 mac 无', () => {
    const mac = createMenuTemplate(true) as Array<Record<string, unknown>>;
    expect(mac[0]?.['role']).toBe('appMenu');
    const win = createMenuTemplate(false) as Array<Record<string, unknown>>;
    expect(win[0]?.['label']).toBe('文件');
  });
});

describe('installApplicationMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('buildFromTemplate + setApplicationMenu 各一次', () => {
    installApplicationMenu();
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});
