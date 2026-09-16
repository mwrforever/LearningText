// 主进程装配单元测试：以 vi.mock('electron') 驱动 bootstrapMain（宪法 A.5-1 / B.3-1），
// 断言 scheme 注册、协议挂载、IPC 注入（origin 白名单 + vfs 服务工厂 + 广播实现）、
// 窗口安全默认值与 fail-fast 退出路径。
// 数据目录/开库/迁移/vfs 工厂接线：electron getPath 返回真实临时目录（dataDir 布局走真实现），
// db/migrate/vfsService 以桩替换（单元测试不触原生 SQLite，真实行为由集成测试与 E2E 覆盖）。
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // vfs 服务桩标记对象：断言注入链路（工厂产物原样进入 registerIpcHandlers deps）
  const vfsStub = { __vfsServiceStub: true } as const;
  const m = {
    registerSchemesAsPrivileged: vi.fn<(schemes: unknown[]) => void>(),
    protocolHandle:
      vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>(),
    whenReady: vi.fn<() => Promise<void>>(),
    appOn: vi.fn<(event: string, listener: () => void) => void>(),
    appExit: vi.fn<(code?: number) => void>(),
    appQuit: vi.fn<() => void>(),
    getAppPath: vi.fn<() => string>(),
    getPath: vi.fn<(name: string) => string>(),
    openDatabase: vi.fn<(options: { readonly file: string }) => { readonly file: string }>(),
    runMigrations: vi.fn<(db: unknown) => void>(),
    createVfsService: vi.fn<(db: unknown) => typeof vfsStub>(),
    getAllWindows:
      vi.fn<() => Array<{ webContents: { send: (channel: string, payload: unknown) => void } }>>(),
    BrowserWindow: vi.fn<(options: unknown) => { loadURL: (url: string) => Promise<void> }>(),
    loadURL: vi.fn<(url: string) => Promise<void>>(),
    wcOn: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
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
          readonly broadcast: (event: unknown) => void;
        }) => void
      >(),
  };
  // app.ts 模块加载即执行 bootstrapMain，此时须保证 whenReady / getAppPath 立即可用
  m.whenReady.mockResolvedValue(undefined);
  m.getAppPath.mockImplementation(() => '/mock-app-path');
  // userData 指向真实临时目录：dataDir 的 ensureDataDir 递归建目录可安全落盘（测试结束后由系统回收）
  m.getPath.mockImplementation(() => mkdtempSync(path.join(tmpdir(), 'lt-app-userdata-')));
  // 开库桩：原样返回选项对象充当句柄，供 runMigrations 调用参数断言
  m.openDatabase.mockImplementation((options) => options);
  // vfs 工厂桩：单元测试不触原生 SQLite（真实行为由集成测试与 E2E 覆盖）
  m.createVfsService.mockImplementation(() => vfsStub);
  // getAllWindows 默认无窗口：broadcast 遍历空集（具体窗口断言在对应用例内覆写返回值）
  m.getAllWindows.mockImplementation(() => []);
  // BrowserWindow 以 new 调用，桩实现必须用 function 声明（箭头函数不可构造）
  m.BrowserWindow.mockImplementation(function () {
    return {
      loadURL: m.loadURL,
      webContents: {
        on: m.wcOn,
        setWindowOpenHandler: m.setWindowOpenHandler,
        session: { setPermissionRequestHandler: m.setPermissionRequestHandler },
      },
    };
  });
  // vfsStub 供用例断言 deps.vfs 与工厂产物同一引用
  return Object.assign(m, { vfsStub });
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
    getAppPath: mocks.getAppPath,
    getPath: mocks.getPath,
  },
  // 静态方法 getAllWindows 挂在构造器上（broadcast 遍历窗口用，宪法 B.3-4）
  BrowserWindow: Object.assign(mocks.BrowserWindow, { getAllWindows: mocks.getAllWindows }),
}));
vi.mock('../../../src/main/ipc', () => ({ registerIpcHandlers: mocks.registerIpcHandlers }));
vi.mock('../../../src/main/store/db', () => ({ openDatabase: mocks.openDatabase }));
vi.mock('../../../src/main/store/migrate', () => ({ runMigrations: mocks.runMigrations }));
vi.mock('../../../src/main/vfs/vfsService', () => ({
  createVfsService: mocks.createVfsService,
}));

import { bootstrapMain } from '../../../src/main/app';
import { handleAppResource } from '../../../src/main/protocol/appProtocol';
import { IPC } from '../../../src/shared/ipc';

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
    // BrowserWindow 以 new 调用，桩实现必须用 function 声明（箭头函数不可构造）
    mocks.BrowserWindow.mockImplementation(function () {
      return {
        loadURL: mocks.loadURL,
        webContents: {
          on: mocks.wcOn,
          setWindowOpenHandler: mocks.setWindowOpenHandler,
          session: { setPermissionRequestHandler: mocks.setPermissionRequestHandler },
        },
      };
    });
  });

  it('生产模式：注册 app 特权 scheme，ready 后挂协议处理器，IPC 白名单仅 app://bundle 并加载产物页', async () => {
    bootstrapMain();
    await flushReadyChain();

    // scheme 必须以 standard+secure 注册，senderFrame origin 校验依赖该语义
    expect(mocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'app', privileges: { standard: true, secure: true } },
    ]);
    // 协议处理器必须挂载真实的 handleAppResource（防误接桩实现）
    expect(mocks.protocolHandle).toHaveBeenCalledWith('app', handleAppResource);
    // 生产环境 origin 白名单仅含 app 协议（B.5-6）；vfs 服务工厂与广播实现一并注入（M1）
    expect(mocks.registerIpcHandlers).toHaveBeenCalledTimes(1);
    const ipcDeps = mocks.registerIpcHandlers.mock.calls[0]?.[0];
    expect(ipcDeps?.allowedOrigins).toEqual(['app://bundle']);
    expect(ipcDeps?.vfs).toBe(mocks.vfsStub);
    expect(ipcDeps?.broadcast).toEqual(expect.any(Function));
    // vfs 服务由开库句柄构建（装配顺序：开库 → 迁移 → 服务工厂 → IPC 注册）
    expect(mocks.createVfsService).toHaveBeenCalledWith(mocks.openDatabase.mock.results[0]?.value);
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
    expect(mocks.loadURL).toHaveBeenCalledWith('app://bundle/index.html');
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
});
