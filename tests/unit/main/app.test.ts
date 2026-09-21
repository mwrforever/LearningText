// 主进程装配单元测试：以 vi.mock('electron') 驱动 bootstrapMain（宪法 A.5-1 / B.3-1），
// 断言 scheme 注册、协议挂载、IPC 注入（origin 白名单 + vfs/search 服务工厂 + 设置服务 + 广播实现）、
// 窗口安全默认值、fail-fast 退出路径与 will-quit 优雅关库（spec §2.2）。
// 数据目录/开库/迁移/vfs/search 工厂接线：electron getPath 返回真实临时目录（dataDir 布局走真实现），
// db/migrate/vfsService/searchService 以桩替换（单元测试不触原生 SQLite，真实行为由集成测试与 E2E 覆盖）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // vfs 服务桩标记对象：断言注入链路（工厂产物原样进入 registerIpcHandlers deps）
  const vfsStub = { __vfsServiceStub: true } as const;
  // 搜索服务桩标记对象：断言 search:query 通道的装配注入链路（M2 spec §7.3）
  const searchStub = { __searchServiceStub: true } as const;
  // 导入服务桩标记对象：断言 io:import 通道的装配注入链路（M5 批次⑥ Task 12）
  const ioStub = { __ioServiceStub: true } as const;
  // 导出服务桩标记对象：断言 io:export 通道的装配注入链路（M5 批次⑥ Task 13）
  const exportServiceStub = { __exportServiceStub: true } as const;
  // 生产 fs 适配桩标记对象：断言 nodeFs 注入链路（mock 工厂须提供同名导出）
  const nodeFsStub = { __nodeFsStub: true } as const;
  // 生产导出 fs 适配桩标记对象：断言 nodeExportFs 注入链路（M5 批次⑥ Task 13）
  const nodeExportFsStub = { __nodeExportFsStub: true } as const;
  // 备份服务桩（M5 批次③ Task 9）：记录构造 deps 供装配断言；各实例方法独立 vi.fn，
  // restore/autoBackupIfNeeded 按用例编程（还原编排/每日触发链路断言面）
  class BackupServiceStub {
    readonly deps: {
      readonly backupsDir: string;
      readonly dbFile: string;
      readonly checkpoint: () => void;
      readonly onDone: (fileName: string) => void;
    };
    autoBackupIfNeeded = vi.fn<(todayIsoDate: string, autoEnabled: boolean) => void>();
    create = vi.fn<() => { readonly fileName: string }>(() => ({
      fileName: 'lt-20260921-080000.db',
    }));
    list = vi.fn<() => unknown[]>(() => []);
    restore = vi.fn<(fileName: string) => void>();
    constructor(deps: typeof BackupServiceStub.prototype.deps) {
      this.deps = deps;
      backupStubs.push(this);
    }
  }
  const backupStubs: BackupServiceStub[] = [];
  const m = {
    registerSchemesAsPrivileged: vi.fn<(schemes: unknown[]) => void>(),
    protocolHandle:
      vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>(),
    whenReady: vi.fn<() => Promise<void>>(),
    appOn: vi.fn<(event: string, listener: () => void) => void>(),
    appExit: vi.fn<(code?: number) => void>(),
    appQuit: vi.fn<() => void>(),
    // 还原成功后重启链路（M5 Task 9）：app.relaunch + app.exit(0)
    appRelaunch: vi.fn<() => void>(),
    getAppPath: vi.fn<() => string>(),
    getPath: vi.fn<(name: string) => string>(),
    openDatabase:
      vi.fn<(options: { readonly file: string }) => { readonly file: string; close: () => void }>(),
    // db 句柄 close/pragma 桩：断言 will-quit 优雅关库（spec §2.2 / A.4-1）与
    // checkpoint 供给闭包的 TRUNCATE 分支（M5 Task 9）
    dbClose: vi.fn<() => void>(),
    dbPragma: vi.fn<(statement: string) => unknown>(),
    runMigrations: vi.fn<(db: unknown) => void>(),
    createVfsService: vi.fn<(db: unknown) => typeof vfsStub>(),
    createSearchService: vi.fn<(db: unknown) => typeof searchStub>(),
    // 导入服务工厂桩（M5 批次⑥）：断言 db/fs/onProgress 装配注入
    createImportService: vi.fn<(deps: unknown) => typeof ioStub>(),
    // 导出服务工厂桩（M5 批次⑥ Task 13）：断言 db/vfs/fs/onProgress 装配注入
    createExportService: vi.fn<(deps: unknown) => typeof exportServiceStub>(),
    // 主进程目录选择弹窗桩（io:pick-directory 供给闭包消费）
    showOpenDialog:
      vi.fn<(options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    // shell.openPath 桩（M5 批次⑥ Task 13）：成功返回空串，失败返回错误描述串（Electron 契约）
    shellOpenPath: vi.fn<(dir: string) => Promise<string>>(),
    getAllWindows: vi.fn<
      () => Array<{
        webContents: { send: (channel: string, payload: unknown) => void };
        // 主题联动用例注入：真实窗口恒有该方法，桩按需提供（无 overlay 形态以缺省表达）
        setTitleBarOverlay?: (overlay: unknown) => void;
      }>
    >(),
    BrowserWindow: vi.fn<(options: unknown) => { loadURL: (url: string) => Promise<void> }>(),
    loadURL: vi.fn<(url: string) => Promise<void>>(),
    wcOn: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
    wcSend: vi.fn<(channel: string, payload: unknown) => void>(),
    // 右键「检查元素」落点桩（Task 9 FR-RENDER-05）：断言以 params 坐标调用
    wcInspectElement: vi.fn<(x: number, y: number) => void>(),
    winOn: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
    winClose: vi.fn<() => void>(),
    menuBuildFromTemplate: vi.fn<(template: unknown) => unknown>(),
    menuSetApplicationMenu: vi.fn<(menu: unknown) => void>(),
    // context-menu 弹出桩（Task 9）：原生 popup 不可被 Playwright 驱动的单测降级断言面
    menuPopup: vi.fn<(options: unknown) => void>(),
    // nativeTheme 桩（M6 自绘标题栏）：system 意图经 shouldUseDarkColors 解析，
    // 用例内可翻转驱动初始 overlay 配色与主题联动断言
    nativeTheme: { shouldUseDarkColors: false },
    // 窗口 setTitleBarOverlay 桩（M6 主题联动）：记录 overlay 更新载荷
    setTitleBarOverlay: vi.fn<(overlay: unknown) => void>(),
    setWindowOpenHandler: vi.fn<(handler: () => { action: string }) => void>(),
    setPermissionRequestHandler:
      vi.fn<
        (
          handler: (wc: unknown, permission: string, callback: (allow: boolean) => void) => void,
        ) => void
      >(),
    registerIpcHandlers:
      vi.fn<
        (deps: {
          readonly allowedOrigins: readonly string[];
          readonly vfs: unknown;
          readonly search: unknown;
          readonly settings: unknown;
          readonly broadcast: (event: unknown) => void;
          readonly requestClose: () => void;
          readonly backup: unknown;
          readonly restoreBackup: (fileName: string) => void;
          readonly requestRelaunch: () => void;
          readonly io: unknown;
          readonly export: unknown;
          readonly dialogProducedDirs: ReadonlySet<string>;
          readonly openDirectoryInShell: (dir: string) => Promise<void>;
          readonly pickDirectories: (allowMultiple: boolean) => Promise<readonly string[]>;
          readonly getStorageInfo: () => unknown;
          readonly changeDataDir: (targetDir: string) => { readonly relaunch: true };
          readonly onAppearanceThemeChange: (intent: 'light' | 'dark' | 'system') => void;
        }) => void
      >(),
  };
  // app.ts 模块加载即执行 bootstrapMain，此时须保证 whenReady / getAppPath 立即可用
  m.whenReady.mockResolvedValue(undefined);
  m.getAppPath.mockImplementation(() => '/mock-app-path');
  // userData 指向真实临时目录：dataDir 的 ensureDataDir 递归建目录可安全落盘（测试结束后由系统回收）
  m.getPath.mockImplementation(() => mkdtempSync(path.join(tmpdir(), 'lt-app-userdata-')));
  // 开库桩：返回带 close/pragma 桩的句柄对象（选项展开保留 file 字段供既有断言复用），
  // 供 will-quit 优雅关库与 checkpoint 供给闭包用例断言
  m.openDatabase.mockImplementation((options) => ({
    ...options,
    close: m.dbClose,
    pragma: m.dbPragma,
  }));
  // vfs 工厂桩：单元测试不触原生 SQLite（真实行为由集成测试与 E2E 覆盖）
  m.createVfsService.mockImplementation(() => vfsStub);
  // 搜索工厂桩：同上，产物标记对象仅供注入链路断言（工厂本身会立刻 prepare 语句，禁触真库）
  m.createSearchService.mockImplementation(() => searchStub);
  // 导入服务工厂桩：同上（M5 批次⑥）
  m.createImportService.mockImplementation(() => ioStub);
  // 导出服务工厂桩：同上（M5 批次⑥ Task 13）
  m.createExportService.mockImplementation(() => exportServiceStub);
  // 目录选择弹窗桩默认「用户取消」：具体用例内覆写返回值
  m.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  // context-menu「检查元素」弹出桩（Task 9）：buildFromTemplate 产物须带 popup 方法，
  // 否则右键 handler 内 `.popup(...)` 对 undefined 取属性抛错
  m.menuBuildFromTemplate.mockImplementation(() => ({ popup: m.menuPopup }));
  // getAllWindows 默认无窗口：broadcast 遍历空集（具体窗口断言在对应用例内覆写返回值）
  m.getAllWindows.mockImplementation(() => []);
  // BrowserWindow 以 new 调用，桩实现必须用 function 声明（箭头函数不可构造）
  m.BrowserWindow.mockImplementation(function () {
    return {
      loadURL: m.loadURL,
      on: m.winOn,
      close: m.winClose,
      webContents: {
        on: m.wcOn,
        send: m.wcSend,
        inspectElement: m.wcInspectElement,
        setWindowOpenHandler: m.setWindowOpenHandler,
        session: { setPermissionRequestHandler: m.setPermissionRequestHandler },
      },
    };
  });
  // vfsStub/searchStub/ioStub 供用例断言 deps 与工厂产物同一引用；
  // BackupServiceStub 以 vi.mock 工厂注入（backup 模块替换），backupStubs 供用例取实例
  return Object.assign(m, {
    vfsStub,
    searchStub,
    ioStub,
    exportServiceStub,
    nodeFsStub,
    nodeExportFsStub,
    BackupServiceStub,
    backupStubs,
  });
});

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: mocks.registerSchemesAsPrivileged,
    handle: mocks.protocolHandle,
  },
  app: {
    whenReady: mocks.whenReady,
    on: mocks.appOn,
    exit: mocks.appExit,
    quit: mocks.appQuit,
    relaunch: mocks.appRelaunch,
    getAppPath: mocks.getAppPath,
    getPath: mocks.getPath,
  },
  // 静态方法 getAllWindows 挂在构造器上（broadcast 遍历窗口用，宪法 B.3-4）
  BrowserWindow: Object.assign(mocks.BrowserWindow, { getAllWindows: mocks.getAllWindows }),
  // 目录选择弹窗（M5 批次⑥ io:pick-directory 供给闭包消费）
  dialog: { showOpenDialog: mocks.showOpenDialog },
  // nativeTheme（M6 自绘标题栏 overlay 配色解析：system 意图 → shouldUseDarkColors）
  nativeTheme: mocks.nativeTheme,
  // shell.openPath（M5 批次⑥ Task 13：导出完成后「打开目录」供给闭包消费）
  shell: { openPath: mocks.shellOpenPath },
  // 应用菜单装配面（M4 spec §5.2）：bootstrapMain 建窗后 installApplicationMenu 一次
  Menu: {
    buildFromTemplate: mocks.menuBuildFromTemplate,
    setApplicationMenu: mocks.menuSetApplicationMenu,
  },
}));
vi.mock('../../../src/main/ipc', () => ({ registerIpcHandlers: mocks.registerIpcHandlers }));
vi.mock('../../../src/main/store/db', () => ({ openDatabase: mocks.openDatabase }));
vi.mock('../../../src/main/store/migrate', () => ({ runMigrations: mocks.runMigrations }));
vi.mock('../../../src/main/vfs/vfsService', () => ({
  createVfsService: mocks.createVfsService,
}));
vi.mock('../../../src/main/search/searchService', () => ({
  createSearchService: mocks.createSearchService,
}));
vi.mock('../../../src/main/io/importService', () => ({
  createImportService: mocks.createImportService,
  nodeFs: mocks.nodeFsStub,
}));
vi.mock('../../../src/main/io/exportService', () => ({
  createExportService: mocks.createExportService,
  nodeExportFs: mocks.nodeExportFsStub,
}));
vi.mock('../../../src/main/backup/backupService', () => ({
  BackupService: mocks.BackupServiceStub,
}));

import { bootstrapMain } from '../../../src/main/app';
import { handleAppResource } from '../../../src/main/protocol/appProtocol';
import { DATA_DIR_POINTER_FILE, resolveDataDir } from '../../../src/main/store/dataDir';
import { IPC } from '../../../src/shared/ipc';
import { AppError } from '../../../src/shared/result';

// 等待 whenReady().then 微任务链执行完毕（宏任务边界足够让全部 then 回调落地）
async function flushReadyChain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 取出 window-all-closed 监听器；未注册视为装配缺陷直接失败 */
function windowAllClosedHandler(): () => void {
  const call = mocks.appOn.mock.calls.find(([event]) => event === 'window-all-closed');
  if (call === undefined) {
    throw new Error('bootstrapMain 未注册 window-all-closed 监听');
  }
  return call[1];
}

/** 取出 will-quit 监听器；未注册视为装配缺陷直接失败 */
function willQuitHandler(): () => void {
  const call = mocks.appOn.mock.calls.find(([event]) => event === 'will-quit');
  if (call === undefined) {
    throw new Error('bootstrapMain 未注册 will-quit 监听');
  }
  return call[1];
}

/** 临时替换 process.platform 后执行断言，结束后恢复原值 */
function withPlatform(platform: NodeJS.Platform, run: () => void): void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

describe('主进程装配 bootstrapMain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VITE_DEV_SERVER_URL;
    mocks.whenReady.mockResolvedValue(undefined);
    mocks.backupStubs.length = 0;
    mocks.nativeTheme.shouldUseDarkColors = false; // 主题桩逐用例复位，防跨用例泄漏
    // BrowserWindow 以 new 调用，桩实现必须用 function 声明（箭头函数不可构造）
    mocks.BrowserWindow.mockImplementation(function () {
      return {
        loadURL: mocks.loadURL,
        on: mocks.winOn,
        close: mocks.winClose,
        webContents: {
          on: mocks.wcOn,
          send: mocks.wcSend,
          inspectElement: mocks.wcInspectElement,
          setWindowOpenHandler: mocks.setWindowOpenHandler,
          session: { setPermissionRequestHandler: mocks.setPermissionRequestHandler },
        },
      };
    });
  });

  it('生产模式：注册 app 特权 scheme，ready 后挂协议处理器，IPC 白名单仅 app://bundle 并加载产物页', async () => {
    bootstrapMain();
    await flushReadyChain();

    // scheme 必须以 standard+secure 注册，senderFrame origin 校验依赖该语义；
    // vfs:// 特权声明：standard 供相对 URL 解析、supportFetchAPI 供沙箱 fetch、
    // stream 供媒体 Range/206 渐进读取、corsEnabled 供跨源 fetch 的 scheme 级白名单
    // （缺它则一切跨源 fetch('vfs://…') 网络栈前即被拒，M3 spec §2.4）
    expect(mocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'app', privileges: { standard: true, secure: true } },
      {
        scheme: 'vfs',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true,
        },
      },
    ]);
    // 协议处理器必须挂载真实的 handleAppResource（防误接桩实现）
    expect(mocks.protocolHandle).toHaveBeenCalledWith('app', handleAppResource);
    // vfs:// handler 经工厂闭包装配（惰性语句装配，工厂不触库），挂载在 'vfs' 通道
    expect(mocks.protocolHandle).toHaveBeenCalledWith('vfs', expect.any(Function));
    // 生产环境 origin 白名单仅含 app 协议（B.5-6）；vfs/search 服务工厂与广播实现一并注入
    expect(mocks.registerIpcHandlers).toHaveBeenCalledTimes(1);
    const ipcDeps = mocks.registerIpcHandlers.mock.calls[0]?.[0];
    expect(ipcDeps?.allowedOrigins).toEqual(['app://bundle']);
    expect(ipcDeps?.vfs).toBe(mocks.vfsStub);
    expect(ipcDeps?.search).toBe(mocks.searchStub);
    // 设置服务走真实现（仅读 userData 下几 KB JSON，不触 SQLite）：断言注入链路完整（M3 spec §5）
    expect(ipcDeps?.settings).toEqual(expect.anything());
    expect(ipcDeps?.broadcast).toEqual(expect.any(Function));
    // 导入服务与目录选择供给一并注入（M5 批次⑥ Task 12）
    expect(ipcDeps?.io).toBe(mocks.ioStub);
    expect(ipcDeps?.pickDirectories).toEqual(expect.any(Function));
    // 数据目录域两供给注入（M6 批次③）：布局查询与迁移编排闭包
    expect(ipcDeps?.getStorageInfo).toEqual(expect.any(Function));
    expect(ipcDeps?.changeDataDir).toEqual(expect.any(Function));
    // close 拦截 guard 接线（M4 spec §2.3）：未放行的首次 close 一律拦截
    // 并经窗口自身 webContents 下发 confirm-close 命令（渲染层确认链入口）
    const closeCall = mocks.winOn.mock.calls.find(([event]) => event === 'close');
    if (closeCall === undefined) {
      throw new Error('窗口未注册 close 拦截 guard');
    }
    const closeListener = closeCall[1] as (event: { preventDefault: () => void }) => void;
    const blocked = { preventDefault: vi.fn() };
    closeListener(blocked);
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.wcSend).toHaveBeenCalledWith(IPC.shellCommand, { type: 'confirm-close' });
    // requestClose 真实现（M4 spec §2.3，Task 1 占位升级）：置放行标记后
    // 触发主窗口 close 重入（guard 确认链主进程侧收口）
    ipcDeps?.requestClose();
    expect(mocks.winClose).toHaveBeenCalledTimes(1);
    // 放行标记已置位：再次 close 不再拦截（直通，窗口得以真正关闭）
    const passed = { preventDefault: vi.fn() };
    closeListener(passed);
    expect(passed.preventDefault).not.toHaveBeenCalled();
    // vfs 服务由开库句柄构建（装配顺序：开库 → 迁移 → 服务工厂 → IPC 注册）
    expect(mocks.createVfsService).toHaveBeenCalledWith(mocks.openDatabase.mock.results[0]?.value);
    // 搜索服务同一开库句柄构建（M2 spec §7.3：单例连接，服务禁自行开连接）
    expect(mocks.createSearchService).toHaveBeenCalledWith(
      mocks.openDatabase.mock.results[0]?.value,
    );
    // 数据目录与开库迁移接线（spec §2.1/§3）：备份目录真实落盘，库文件收敛在 userData/LearningText 布局内
    expect(mocks.getPath).toHaveBeenCalledWith('userData');
    const userDataDir = mocks.getPath.mock.results[0]?.value;
    expect(userDataDir).toBeDefined();
    expect(existsSync(path.join(userDataDir ?? '', 'LearningText', 'backups'))).toBe(true);
    expect(mocks.openDatabase).toHaveBeenCalledWith({
      file: path.join(userDataDir ?? '', 'LearningText', 'learningtext.db'),
    });
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1);
    // 窗口安全默认值显式断言，防 B.5-1 回归
    const options = mocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // 自绘标题栏（M6 spec §2.2）：hidden 形态恒启用；非 darwin 平台（测试进程 win32）
    // 附加 overlay，初始配色由设置意图经 nativeTheme 解析（system + 亮色 → light 套色）
    expect(options).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#f1f5f9', symbolColor: '#0f172a', height: 40 },
    });
    expect(mocks.loadURL).toHaveBeenCalledWith('app://bundle/index.html');
    // 应用菜单装配一次（M4 spec §5.2：模板构建与菜单设置各一次，命令经 shell:command 下发）
    expect(mocks.menuSetApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it('开发模式：origin 白名单含 dev server，窗口加载 dev server 地址', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    bootstrapMain();
    await flushReadyChain();

    expect(mocks.registerIpcHandlers).toHaveBeenCalledTimes(1);
    const devDeps = mocks.registerIpcHandlers.mock.calls[0]?.[0];
    expect(devDeps?.allowedOrigins).toEqual(['http://localhost:5173', 'app://bundle']);
    expect(mocks.loadURL).toHaveBeenCalledWith('http://localhost:5173');
  });

  it('whenReady 失败时记录错误并以退出码 1 结束进程（B.3-1 禁带伤运行）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.whenReady.mockRejectedValue(new Error('模拟 ready 失败'));
    try {
      bootstrapMain();
      await flushReadyChain();
      expect(mocks.appExit).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('window-all-closed：非 darwin 平台直接退出应用', () => {
    bootstrapMain();
    withPlatform('win32', windowAllClosedHandler());
    expect(mocks.appQuit).toHaveBeenCalledTimes(1);
  });

  it('window-all-closed：darwin 平台保持应用运行（macOS 惯例）', () => {
    bootstrapMain();
    withPlatform('darwin', windowAllClosedHandler());
    expect(mocks.appQuit).not.toHaveBeenCalled();
  });

  it('will-quit 优雅关库：开库成功后触发 db.close，开库前 fail-fast 路径不关库不抛错（spec §2.2 / A.4-1）', async () => {
    bootstrapMain();
    const handler = willQuitHandler();
    // ready 链尚未落地：db 未赋值（fail-fast 开库前路径），关库可选链短路为无操作，
    // 不得因 close 二次抛错
    expect(() => handler()).not.toThrow();
    expect(mocks.dbClose).not.toHaveBeenCalled();
    // 装配完成后（开库成功）再次触发退出：必须执行优雅关库（干净关闭自动 checkpoint）
    await flushReadyChain();
    handler();
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });

  it('will-quit 关库失败：记录 error 日志且异常不向外传播（不中断退出流程）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // close 抛错仅本次生效（mockImplementationOnce，避免向后续用例泄漏失败实现）
    mocks.dbClose.mockImplementationOnce(() => {
      throw new Error('模拟关库失败');
    });
    try {
      bootstrapMain();
      await flushReadyChain();
      const handler = willQuitHandler();
      expect(() => handler()).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith('[main] 关闭数据库失败', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('窗口装配注册 B.5-4/5 安全基线三件套', async () => {
    bootstrapMain();
    await flushReadyChain();

    // 三件套必须全部注册（宪法 B.5-4/5）
    expect(mocks.wcOn).toHaveBeenCalledWith('will-navigate', expect.any(Function));
    expect(mocks.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.setPermissionRequestHandler).toHaveBeenCalledWith(expect.any(Function));

    // window.open 回调必须返回 deny
    const openCall = mocks.setWindowOpenHandler.mock.calls.at(-1);
    if (openCall === undefined) {
      throw new Error('setWindowOpenHandler 未注册回调');
    }
    const openHandler = openCall[0] as () => { action: string };
    expect(openHandler()).toEqual({ action: 'deny' });

    // 权限请求回调必须拒绝（按 Electron 三参签名注入 callback，断言默认拒权）
    const permCall = mocks.setPermissionRequestHandler.mock.calls.at(-1);
    if (permCall === undefined) {
      throw new Error('setPermissionRequestHandler 未注册回调');
    }
    const permHandler = permCall[0] as (
      wc: unknown,
      permission: string,
      callback: (allow: boolean) => void,
    ) => void;
    const spy = vi.fn();
    permHandler(undefined, 'media', spy);
    expect(spy).toHaveBeenCalledWith(false);
  });

  it('will-navigate 按 origin 白名单拦截：白名单内放行，外部 origin 调 preventDefault（B.5-4）', async () => {
    bootstrapMain();
    await flushReadyChain();
    const call = mocks.wcOn.mock.calls.find(([event]) => event === 'will-navigate');
    if (call === undefined) {
      throw new Error('will-navigate 监听器未注册');
    }
    const listener = call[1] as (event: { preventDefault: () => void }, url: string) => void;
    const allowedEv = { preventDefault: vi.fn() };
    const blockedEv = { preventDefault: vi.fn() };
    // 应用自身产物页（app://bundle）在白名单内，不拦截
    listener(allowedEv, 'app://bundle/index.html');
    expect(allowedEv.preventDefault).not.toHaveBeenCalled();
    // 外部 https 站点一律拦截
    listener(blockedEv, 'https://evil.example.com/phish');
    expect(blockedEv.preventDefault).toHaveBeenCalledTimes(1);
  });

  // —— 自绘标题栏（M6 spec §2.2）——
  it('自绘标题栏：system 意图经 nativeTheme 解析初始 overlay 配色（暗色偏好 → dark 套色）', async () => {
    mocks.nativeTheme.shouldUseDarkColors = true;
    bootstrapMain();
    await flushReadyChain();
    const options = mocks.BrowserWindow.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1e293b', symbolColor: '#f8fafc', height: 40 },
    });
  });

  it('自绘标题栏：darwin 平台不设 titleBarOverlay（窗口控制钮归系统红绿灯）', async () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      bootstrapMain();
      await flushReadyChain();
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
    const options = mocks.BrowserWindow.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options.titleBarStyle).toBe('hidden');
    expect(options).not.toHaveProperty('titleBarOverlay');
  });

  it('onAppearanceThemeChange 注入实现：主题变更遍历窗口更新 overlay 配色，无 overlay 能力窗口静默跳过', async () => {
    bootstrapMain();
    await flushReadyChain();
    const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0];
    if (deps === undefined) {
      throw new Error('registerIpcHandlers 未被调用');
    }
    const setOverlayA = vi.fn<(overlay: unknown) => void>();
    mocks.getAllWindows.mockReturnValue([
      { webContents: { send: vi.fn() }, setTitleBarOverlay: setOverlayA },
      // 无 setTitleBarOverlay 的窗口（mac / overlay 未激活形态）：调用抛错须被静默吞掉
      { webContents: { send: vi.fn() } },
    ]);
    expect(() => deps.onAppearanceThemeChange('dark')).not.toThrow();
    expect(setOverlayA).toHaveBeenCalledWith({
      color: '#1e293b',
      symbolColor: '#f8fafc',
      height: 40,
    });
    // system 意图经 nativeTheme 解析（亮色桩 → light 套色）
    deps.onAppearanceThemeChange('system');
    expect(setOverlayA).toHaveBeenLastCalledWith({
      color: '#f1f5f9',
      symbolColor: '#0f172a',
      height: 40,
    });
  });

  it('broadcast 注入实现：遍历全部窗口经 vfs:changed 发送树变更事件（宪法 B.3-4）', async () => {
    bootstrapMain();
    await flushReadyChain();
    const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0];
    if (deps === undefined) {
      throw new Error('registerIpcHandlers 未被调用');
    }
    const event = { type: 'created' as const, node: { id: 5 } };
    const sendA = vi.fn<(channel: string, payload: unknown) => void>();
    const sendB = vi.fn<(channel: string, payload: unknown) => void>();
    mocks.getAllWindows.mockReturnValue([
      { webContents: { send: sendA } },
      { webContents: { send: sendB } },
    ]);
    deps.broadcast(event);
    // 通道固定为 vfs:changed、载荷原样透传；每个存活窗口各收到一次
    expect(sendA).toHaveBeenCalledWith(IPC.vfsChanged, event);
    expect(sendB).toHaveBeenCalledWith(IPC.vfsChanged, event);
  });

  // context-menu「检查元素」（FR-RENDER-05，Task 9）：原生 popup 不可被 Playwright 驱动——
  // 交互验收降级为单测断言 handler 行为（与 beforeunload 同理的既定处置，spec §9.1-7）
  describe('context-menu 检查元素', () => {
    it('右键构建「检查元素」菜单弹出，点击以 params 坐标调用 inspectElement', async () => {
      bootstrapMain();
      await flushReadyChain();
      const call = mocks.wcOn.mock.calls.find(([event]) => event === 'context-menu');
      if (call === undefined) {
        throw new Error('context-menu 监听器未注册');
      }
      const listener = call[1] as (_event: unknown, params: { x: number; y: number }) => void;
      listener(undefined, { x: 12, y: 34 });
      // 应用菜单装配已占一次 buildFromTemplate，右键弹出为第二次；取最后一次（context-menu 模板）
      expect(mocks.menuBuildFromTemplate).toHaveBeenCalledTimes(2);
      const template = mocks.menuBuildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
        label: string;
        click: () => void;
      }>;
      expect(template[0]?.label).toBe('检查元素');
      expect(mocks.menuPopup).toHaveBeenCalledWith({ window: expect.anything() });
      template[0]?.click();
      expect(mocks.wcInspectElement).toHaveBeenCalledTimes(1);
      expect(mocks.wcInspectElement).toHaveBeenCalledWith(12, 34);
    });
  });

  // —— 备份服务装配与还原编排（M5 批次③ Task 9）——
  describe('备份服务装配与还原编排', () => {
    interface IpcDeps {
      readonly restoreBackup: (fileName: string) => void;
      readonly requestRelaunch: () => void;
    }

    async function bootstrapWithBackup(): Promise<{
      deps: IpcDeps;
      stub: NonNullable<(typeof mocks.backupStubs)[number]>;
      userDataDir: string;
    }> {
      bootstrapMain();
      await flushReadyChain();
      const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0] as unknown as IpcDeps;
      const stub = mocks.backupStubs[0];
      const userDataDir = mocks.getPath.mock.results[0]?.value ?? '';
      if (stub === undefined) {
        throw new Error('备份服务未被装配');
      }
      return { deps, stub, userDataDir };
    }

    it('备份服务按 dataDir 布局装配：backupsDir/dbFile 注入，每日自动备份按设置开关触发一次', async () => {
      const { stub, userDataDir } = await bootstrapWithBackup();
      expect(stub.deps.backupsDir).toBe(path.join(userDataDir, 'LearningText', 'backups'));
      expect(stub.deps.dbFile).toBe(path.join(userDataDir, 'LearningText', 'learningtext.db'));
      // todayIsoDate 由 app 层以本地时区日期串传入（服务不摸钟），开关取设置域缓存（默认开）
      expect(stub.autoBackupIfNeeded).toHaveBeenCalledTimes(1);
      expect(stub.autoBackupIfNeeded).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        true,
      );
    });

    it('checkpoint 供给闭包：常规路径对当前库执行 TRUNCATE 冲刷（A.4-9）', async () => {
      const { stub } = await bootstrapWithBackup();
      stub.deps.checkpoint();
      expect(mocks.dbPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
    });

    it('onDone 供给闭包：遍历全部窗口以 backup:done 发送备份文件名（宪法 B.3-4 同型广播）', async () => {
      const { stub } = await bootstrapWithBackup();
      const sendA = vi.fn<(channel: string, payload: unknown) => void>();
      const sendB = vi.fn<(channel: string, payload: unknown) => void>();
      mocks.getAllWindows.mockReturnValue([
        { webContents: { send: sendA } },
        { webContents: { send: sendB } },
      ]);
      stub.deps.onDone('lt-20260921-080000.db');
      expect(sendA).toHaveBeenCalledWith(IPC.backupDone, 'lt-20260921-080000.db');
      expect(sendB).toHaveBeenCalledWith(IPC.backupDone, 'lt-20260921-080000.db');
    });

    it('restoreBackup 编排：替换点（checkpoint 调用）改为干净关闭释放文件锁，不重开不重启', async () => {
      const { deps, stub } = await bootstrapWithBackup();
      // 服务固定时序：替换点前调用 deps.checkpoint——供给闭包此刻消费 swap 标记执行关库
      stub.restore.mockImplementation((fileName: string) => {
        if (fileName === 'lt-20260921-080000.db') stub.deps.checkpoint();
      });
      deps.restoreBackup('lt-20260921-080000.db');
      expect(stub.restore).toHaveBeenCalledWith('lt-20260921-080000.db');
      // 干净关闭已执行（自带最终 checkpoint），库未重开（relaunch 由 IPC 层随后触发）
      expect(mocks.dbClose).toHaveBeenCalledTimes(1);
      expect(mocks.openDatabase).toHaveBeenCalledTimes(1);
      // 防御路径：同一进程生命周期内二次还原（正常被 relaunch 收场，不会发生）——
      // 库句柄已空时关库与 TRUNCATE 两分支均须安全跳过
      deps.restoreBackup('lt-20260921-080000.db');
      stub.deps.checkpoint();
      expect(mocks.dbClose).toHaveBeenCalledTimes(1);
      expect(mocks.dbPragma).not.toHaveBeenCalled();
    });

    it('restoreBackup 编排：替换点前失败（如备份损坏）不关库不重开，错误外抛', async () => {
      const { deps, stub } = await bootstrapWithBackup();
      stub.restore.mockImplementation(() => {
        throw new AppError('E_BACKUP_CORRUPT', '备份文件已损坏，无法还原');
      });
      expect(() => deps.restoreBackup('lt-20260920-080000.db')).toThrowError(AppError);
      expect(mocks.dbClose).not.toHaveBeenCalled();
      expect(mocks.openDatabase).toHaveBeenCalledTimes(1);
    });

    it('restoreBackup 编排：替换点后极端失败重开原库，错误外抛（rename 原子，原库未损）', async () => {
      // 重开原库的 error 留痕属预期路径：静音以保证测试输出无杂音
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const { deps, stub } = await bootstrapWithBackup();
        stub.restore.mockImplementation(() => {
          stub.deps.checkpoint(); // 已到替换点：库被干净关闭
          throw new Error('模拟替换阶段 IO 失败');
        });
        expect(() => deps.restoreBackup('lt-20260921-080000.db')).toThrowError(Error);
        expect(mocks.dbClose).toHaveBeenCalledTimes(1);
        expect(mocks.openDatabase).toHaveBeenCalledTimes(2);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('requestRelaunch 注入实现：app.relaunch 注册重启意图后以退出码 0 退出（D11：服务不直接 relaunch）', async () => {
      const { deps } = await bootstrapWithBackup();
      deps.requestRelaunch();
      expect(mocks.appRelaunch).toHaveBeenCalledTimes(1);
      expect(mocks.appExit).toHaveBeenCalledWith(0);
    });
  });

  // —— 导入服务装配与目录选择供给（M5 批次⑥ Task 12）——
  describe('导入服务装配与目录选择供给', () => {
    interface IpcDeps {
      readonly pickDirectories: (allowMultiple: boolean) => Promise<readonly string[]>;
    }

    /** 取 showOpenDialog 末次调用的末位实参（OpenDialogOptions；带窗/不带窗重载通吃） */
    function lastDialogOptions(): { properties: string[] } {
      const call = mocks.showOpenDialog.mock.calls.at(-1);
      const options = call?.[call.length - 1];
      return options as { properties: string[] };
    }

    async function bootstrapWithIo(): Promise<{
      deps: IpcDeps;
      ioDeps: {
        readonly db: unknown;
        readonly fs: unknown;
        readonly onProgress: (progress: unknown) => void;
      };
    }> {
      bootstrapMain();
      await flushReadyChain();
      const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0] as unknown as IpcDeps;
      const ioDeps = mocks.createImportService.mock.calls[0]?.[0] as {
        readonly db: unknown;
        readonly fs: unknown;
        readonly onProgress: (progress: unknown) => void;
      };
      if (ioDeps === undefined) {
        throw new Error('导入服务未被装配');
      }
      return { deps, ioDeps };
    }

    it('导入服务按开库句柄装配：db 与 onProgress 注入（onProgress 遍历窗口 io:progress 广播）', async () => {
      const { ioDeps } = await bootstrapWithIo();
      expect(ioDeps.db).toBe(mocks.openDatabase.mock.results[0]?.value);
      // fs 适配器以同一标记对象注入（nodeFs 契约形态由服务单元/集成测试覆盖）
      expect(ioDeps.fs).toBe(mocks.nodeFsStub);
      const sendA = vi.fn<(channel: string, payload: unknown) => void>();
      mocks.getAllWindows.mockReturnValue([{ webContents: { send: sendA } }]);
      const progress = { importId: 1, phase: 'writing', done: 1, total: 1, currentPath: '/a' };
      ioDeps.onProgress(progress);
      expect(sendA).toHaveBeenCalledWith(IPC.ioProgress, progress);
    });

    it('pickDirectories 注入实现：主进程 dialog.showOpenDialog（目录模式），多选开关透传', async () => {
      const { deps } = await bootstrapWithIo();
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/a', 'D:/b'] });
      await expect(deps.pickDirectories(true)).resolves.toEqual(['D:/a', 'D:/b']);
      // options 恒为末位实参（带窗 owner 与不带窗两种重载通吃）
      const options = lastDialogOptions();
      expect(options.properties).toContain('openDirectory');
      expect(options.properties).toContain('multiSelections');
      // 用户取消返回空数组（渲染层以空清单识别取消，不发起导入）
      mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      await expect(deps.pickDirectories(false)).resolves.toEqual([]);
      const singleOptions = lastDialogOptions();
      expect(singleOptions.properties).toContain('openDirectory');
      expect(singleOptions.properties).not.toContain('multiSelections');
    });
  });

  // —— 导出服务装配与打开目录供给（M5 批次⑥ Task 13）——
  describe('导出服务装配与打开目录供给', () => {
    interface Task13Deps {
      readonly export: unknown;
      readonly dialogProducedDirs: ReadonlySet<string>;
      readonly openDirectoryInShell: (dir: string) => Promise<void>;
      readonly pickDirectories: (allowMultiple: boolean) => Promise<readonly string[]>;
    }

    async function bootstrapWithTask13(): Promise<{
      deps: Task13Deps;
      exportDeps: {
        readonly db: unknown;
        readonly vfs: unknown;
        readonly fs: unknown;
        readonly onProgress: (progress: unknown) => void;
      };
    }> {
      bootstrapMain();
      await flushReadyChain();
      const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0] as unknown as Task13Deps;
      const exportDeps = mocks.createExportService.mock.calls[0]?.[0] as {
        readonly db: unknown;
        readonly vfs: unknown;
        readonly fs: unknown;
        readonly onProgress: (progress: unknown) => void;
      };
      if (exportDeps === undefined) {
        throw new Error('导出服务未被装配');
      }
      return { deps, exportDeps };
    }

    it('导出服务按开库句柄/vfs/fs 装配：db 与 fs 注入（onProgress 遍历窗口 io:progress 广播）', async () => {
      const { deps, exportDeps } = await bootstrapWithTask13();
      expect(deps.export).toBe(mocks.exportServiceStub);
      expect(exportDeps.db).toBe(mocks.openDatabase.mock.results[0]?.value);
      expect(exportDeps.vfs).toBe(mocks.vfsStub);
      expect(exportDeps.fs).toBe(mocks.nodeExportFsStub);
      const sendA = vi.fn<(channel: string, payload: unknown) => void>();
      mocks.getAllWindows.mockReturnValue([{ webContents: { send: sendA } }]);
      const progress = { exportId: 1, phase: 'writing', done: 1, total: 1, currentPath: 'a' };
      exportDeps.onProgress(progress);
      expect(sendA).toHaveBeenCalledWith(IPC.ioProgress, progress);
    });

    it('pickDirectories 将对话框产出登记入白名单登记簿（Task 13 导出/openPath 校验事实来源）；数据根启动期已登记（M6 批次③）', async () => {
      const { deps } = await bootstrapWithTask13();
      // 启动期登记（M6 spec §4）：当前数据根（<userData>/LearningText）先行入册——
      // 设置页「打开数据目录」的 openPath 登记簿校验由此直达
      const dataRoot = path.join(mocks.getPath.mock.results[0]?.value ?? '', 'LearningText');
      expect(deps.dialogProducedDirs.size).toBe(1);
      expect(deps.dialogProducedDirs.has(dataRoot)).toBe(true);
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:/picked'] });
      await deps.pickDirectories(false);
      expect(deps.dialogProducedDirs.has('D:/picked')).toBe(true);
      // 取消（空清单）不登记任何串
      mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      await deps.pickDirectories(false);
      expect(deps.dialogProducedDirs.size).toBe(2);
    });

    it('openDirectoryInShell 注入实现：shell.openPath 空串语义成功；错误描述串转异常上抛', async () => {
      const { deps } = await bootstrapWithTask13();
      mocks.shellOpenPath.mockResolvedValue('');
      await expect(deps.openDirectoryInShell('D:/picked')).resolves.toBeUndefined();
      mocks.shellOpenPath.mockResolvedValue('目录不存在');
      await expect(deps.openDirectoryInShell('D:/picked')).rejects.toThrow('目录不存在');
    });
  });

  // —— 数据目录迁移编排（M6 批次③ storage:change-data-dir 供给闭包，琢段补测）——
  describe('数据目录迁移编排（storage:change-data-dir 供给闭包）', () => {
    interface MigrationDeps {
      readonly restoreBackup: (fileName: string) => void;
      readonly changeDataDir: (targetDir: string) => { readonly relaunch: true };
      readonly getStorageInfo: () => {
        readonly root: string;
        readonly dbFile: string;
        readonly backupsDir: string;
        readonly settingsFile: string;
        readonly custom: boolean;
      };
    }

    async function bootstrapWithMigration(): Promise<{
      deps: MigrationDeps;
      userDataDir: string;
    }> {
      bootstrapMain();
      await flushReadyChain();
      const deps = mocks.registerIpcHandlers.mock.calls[0]?.[0] as unknown as MigrationDeps;
      const userDataDir = mocks.getPath.mock.results[0]?.value ?? '';
      return { deps, userDataDir };
    }

    it('成功编排：TRUNCATE 冲刷 → 干净关库 → 全量复制（db/settings/marker）→ 指针落盘 → relaunch+exit(0)', async () => {
      const { deps, userDataDir } = await bootstrapWithMigration();
      const layout = resolveDataDir(userDataDir);
      // 源数据预置：openDatabase 为桩不落盘，复制语义由真实 fs 断言（settingsDir 由
      // 装配期 ensureDataDir 建立所需父层，recursive 兜底）
      mkdirSync(layout.settingsDir, { recursive: true });
      writeFileSync(layout.dbFile, 'db-bytes', 'utf8');
      writeFileSync(path.join(layout.settingsDir, 'settings.json'), '{}', 'utf8');
      writeFileSync(layout.markerFile, '{}', 'utf8');
      const targetDir = path.join(userDataDir, 'target');
      mkdirSync(targetDir, { recursive: true });
      const result = deps.changeDataDir(targetDir);
      expect(result).toEqual({ relaunch: true });
      // 关库链：TRUNCATE 冲刷（A.4-9 复制前 checkpoint）+ 干净关闭，不重开（重启即收场）
      expect(mocks.dbPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
      expect(mocks.dbClose).toHaveBeenCalledTimes(1);
      expect(mocks.openDatabase).toHaveBeenCalledTimes(1);
      // 复制完整性与指针指向（下次启动从新位置打开，spec §5.2）
      const newRoot = path.join(targetDir, 'LearningText');
      expect(readFileSync(path.join(newRoot, 'learningtext.db'), 'utf8')).toBe('db-bytes');
      expect(readFileSync(path.join(newRoot, 'settings', 'settings.json'), 'utf8')).toBe('{}');
      expect(readFileSync(path.join(newRoot, 'last-backup.json'), 'utf8')).toBe('{}');
      expect(readFileSync(path.join(userDataDir, DATA_DIR_POINTER_FILE), 'utf8')).toContain(
        'target',
      );
      // 结果即重启（D11 同款：relaunch + 退出码 0）
      expect(mocks.appRelaunch).toHaveBeenCalledTimes(1);
      expect(mocks.appExit).toHaveBeenCalledWith(0);
    });

    it('迁移前置还原挂起标记互斥消费（构造性不可达防御分支）：按常规 TRUNCATE 处理不中断', async () => {
      const { deps, userDataDir } = await bootstrapWithMigration();
      const stub = mocks.backupStubs[0];
      if (stub === undefined) {
        throw new Error('备份服务未被装配');
      }
      const layout = resolveDataDir(userDataDir);
      mkdirSync(layout.settingsDir, { recursive: true });
      writeFileSync(layout.dbFile, 'db-bytes', 'utf8');
      const targetDir = path.join(userDataDir, 'target');
      mkdirSync(targetDir, { recursive: true });
      // 还原编排把替换点标记挂起（stub.restore 不触 checkpoint——模拟标记残留的防御路径）
      deps.restoreBackup('lt-20260921-080000.db');
      deps.changeDataDir(targetDir);
      // 迁移 checkpoint 消费挂起标记后仍走常规 TRUNCATE（单标记语义），迁移照常完成重启
      expect(mocks.dbPragma).toHaveBeenCalledTimes(1);
      expect(mocks.dbPragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');
      expect(mocks.dbClose).toHaveBeenCalledTimes(1);
      expect(mocks.appRelaunch).toHaveBeenCalledTimes(1);
    });

    it('getStorageInfo 供给闭包：返回当前数据目录布局与自定义标记（设置页「数据与存储」展示面）', async () => {
      const { deps, userDataDir } = await bootstrapWithMigration();
      const layout = resolveDataDir(userDataDir);
      expect(deps.getStorageInfo()).toEqual({
        root: layout.root,
        dbFile: layout.dbFile,
        backupsDir: layout.backupDir,
        settingsFile: layout.settingsFile,
        // 全新装配无指针文件：出厂数据根（custom=false）
        custom: false,
      });
    });

    it('关库后复制失败（源 db 缺失）→ 清理新目录残留、不写指针、照常重启（spec D9 失败语义）', async () => {
      const { deps, userDataDir } = await bootstrapWithMigration();
      // openDatabase 桩不落盘：dbFile 物理缺失 → 关库完成后首个 copy 抛 ENOENT 入失败路径
      const targetDir = path.join(userDataDir, 'target');
      mkdirSync(targetDir, { recursive: true });
      deps.changeDataDir(targetDir);
      // 新目录残留已清理、指针未落盘（旧指针完好），重启语义照常（失败代价是重启非数据损坏）
      expect(existsSync(path.join(targetDir, 'LearningText'))).toBe(false);
      expect(existsSync(path.join(userDataDir, DATA_DIR_POINTER_FILE))).toBe(false);
      expect(mocks.dbClose).toHaveBeenCalledTimes(1);
      expect(mocks.appRelaunch).toHaveBeenCalledTimes(1);
      expect(mocks.appExit).toHaveBeenCalledWith(0);
    });
  });
});
