// 主进程装配单元测试：以 vi.mock('electron') 驱动 bootstrapMain（宪法 A.5-1 / B.3-1），
// 断言 scheme 注册、协议挂载、IPC origin 白名单、窗口安全默认值与 fail-fast 退出路径。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const m = {
    registerSchemesAsPrivileged: vi.fn<(schemes: unknown[]) => void>(),
    protocolHandle:
      vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>(),
    whenReady: vi.fn<() => Promise<void>>(),
    appOn: vi.fn<(event: string, listener: () => void) => void>(),
    appExit: vi.fn<(code?: number) => void>(),
    appQuit: vi.fn<() => void>(),
    getAppPath: vi.fn<() => string>(),
    BrowserWindow: vi.fn<(options: unknown) => { loadURL: (url: string) => Promise<void> }>(),
    loadURL: vi.fn<(url: string) => Promise<void>>(),
    registerIpcHandlers: vi.fn<(deps: { allowedOrigins: readonly string[] }) => void>(),
  };
  // app.ts 模块加载即执行 bootstrapMain，此时须保证 whenReady / getAppPath 立即可用
  m.whenReady.mockResolvedValue(undefined);
  m.getAppPath.mockImplementation(() => '/mock-app-path');
  // BrowserWindow 以 new 调用，桩实现必须用 function 声明（箭头函数不可构造）
  m.BrowserWindow.mockImplementation(function () {
    return { loadURL: m.loadURL };
  });
  return m;
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
  },
  BrowserWindow: mocks.BrowserWindow,
}));
vi.mock('../../../src/main/ipc', () => ({ registerIpcHandlers: mocks.registerIpcHandlers }));

import { bootstrapMain } from '../../../src/main/app';
import { handleAppResource } from '../../../src/main/protocol/appProtocol';

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
      return { loadURL: mocks.loadURL };
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
    // 生产环境 origin 白名单仅含 app 协议（B.5-6）
    expect(mocks.registerIpcHandlers).toHaveBeenCalledWith({ allowedOrigins: ['app://bundle'] });
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

    expect(mocks.registerIpcHandlers).toHaveBeenCalledWith({
      allowedOrigins: ['http://localhost:5173', 'app://bundle'],
    });
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
});
