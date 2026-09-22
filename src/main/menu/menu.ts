/**
 * 应用菜单装配（M4 spec §5.2 裁决 D5）：骨架一次到位——文件（新建/保存）可用、
 * 搜索与导入导出 disabled 占位（M5 往缝里填）；命令经 shell:command 单通道下发
 * （可辨识联合，渲染层 switch never 穷举兜底）；快捷键由 accelerator 承载，渲染层
 * 不再自挂键盘监听（键位单一来源）。
 */
import { BrowserWindow, Menu } from 'electron';
import type { BrowserWindow as BrowserWindowType, MenuItemConstructorOptions } from 'electron';
import { IPC } from '../../shared/ipc';
import type { ShellCommand } from '../../shared/shell-contract';

/** 命令单通道下发：遍历全部窗口（M3 broadcast 同款纪律） */
function sendCommand(command: ShellCommand): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.shellCommand, command);
  }
}

/** 菜单模板（isMac 分支：app 菜单平台惯例；导出供单测与装配复用） */
export function createMenuTemplate(isMac: boolean): MenuItemConstructorOptions[] {
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      id: 'menu-import-html',
      label: '导入 HTML 文件…',
      accelerator: 'CmdOrCtrl+N',
      // M7：原「新建文件」语义升级为 HTML 文件导入（文件选择 → 导入确认浮层 → 导入即开），
      // 命令单通道下发
      click: () => sendCommand({ type: 'import-html' }),
    },
    {
      id: 'menu-new-dir',
      label: '新建目录',
      accelerator: 'CmdOrCtrl+Shift+N',
      click: () => sendCommand({ type: 'new-dir' }),
    },
    {
      id: 'menu-save',
      label: '保存',
      accelerator: 'CmdOrCtrl+S',
      click: () => sendCommand({ type: 'save' }),
    },
    {
      id: 'menu-settings',
      label: '设置…',
      accelerator: 'CmdOrCtrl+,',
      // M5 批次③ Task 8：设置页（全屏覆盖视图）开启命令，经 shell:command 单通道下发
      click: () => sendCommand({ type: 'open-settings' }),
    },
  ];
  if (!isMac) fileSubmenu.push({ type: 'separator' }, { role: 'quit', label: '退出' });
  const template: MenuItemConstructorOptions[] = [
    { label: '文件', submenu: fileSubmenu },
    {
      label: '搜索',
      submenu: [
        {
          id: 'menu-quick-open',
          label: '快速打开',
          accelerator: 'CmdOrCtrl+P',
          // M5 批次① Task 6：浮层 UI 落地，启用并经命令单通道下发
          click: () => sendCommand({ type: 'quick-open' }),
        },
        {
          id: 'menu-global-search',
          label: '全局搜索',
          accelerator: 'CmdOrCtrl+Shift+F',
          // M5 批次① Task 7：全局搜索面板落地（树栏 search 态），启用并经命令单通道下发
          click: () => sendCommand({ type: 'global-search' }),
        },
      ],
    },
    {
      label: '导入导出',
      submenu: [
        {
          id: 'menu-import',
          label: '导入…',
          // M5 批次⑥ Task 12：导入链路（目录选择 → 策略确认 → io:import）落地，经命令单通道下发
          click: () => sendCommand({ type: 'import' }),
        },
        {
          id: 'menu-export',
          label: '导出…',
          // M5 批次⑥ Task 13：导出链路（选中子树 → 目录选择 → io:export）落地，经命令单通道下发
          click: () => sendCommand({ type: 'export' }),
        },
      ],
    },
  ];
  if (isMac) template.unshift({ role: 'appMenu' });
  return template;
}

/** 装配应用菜单（whenReady 后、窗口创建后调用一次） */
export function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(createMenuTemplate(process.platform === 'darwin')),
  );
}

/**
 * 窗口关闭拦截 guard（M4 spec §2.3 D3）：首次 close 一律拦截并发 confirm-close 命令；
 * 渲染层判定无脏直接 forceClose、有脏弹 confirm 后再 forceClose——放行标记由
 * registerIpcHandlers 的 requestClose 置位（同对象引用）。
 */
export function attachWindowCloseGuard(win: BrowserWindowType, allow: { value: boolean }): void {
  win.on('close', (event) => {
    if (allow.value) return;
    event.preventDefault();
    win.webContents.send(IPC.shellCommand, { type: 'confirm-close' });
  });
}
