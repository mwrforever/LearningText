// electron-updater 适配器单元测试（M9 批次，FR-UPDATE-01）：宽签名 autoUpdater 视图到
// UpdaterLike 窄接口的转换面——开关存取器转发（构造期关闭自动行为必须落到底层实例）、
// 六事件订阅转发与载荷透传、三个动作转发；loadElectronUpdater 以 vi.mock 拦截
// 'electron-updater' 模块（静态 import 形态，拦截机制经静态 import 保证）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const wide = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
      checkForUpdates: vi.fn(() => Promise.resolve(null)),
      downloadUpdate: vi.fn(() => Promise.resolve(null)),
      quitAndInstall: vi.fn(),
    },
  };
});

vi.mock('electron-updater', () => ({ autoUpdater: wide.autoUpdater }));

import {
  createElectronUpdaterAdapter,
  loadElectronUpdater,
  type ElectronUpdaterLike,
} from '../../../src/main/update/electronUpdaterAdapter';

/** 宽签名假体构造器（含 emit 便利方法，驱动事件转发断言） */
function makeWide(): ElectronUpdaterLike & {
  emit(event: string, ...args: unknown[]): void;
  quitAndInstall: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const stub = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.(...args);
    },
  };
  return stub as unknown as ElectronUpdaterLike & {
    emit(event: string, ...args: unknown[]): void;
    quitAndInstall: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  wide.listeners.clear();
  vi.clearAllMocks();
});

describe('createElectronUpdaterAdapter', () => {
  it('autoDownload / autoInstallOnAppQuit 存取器双向转发（服务侧赋值必须落到底层实例）', () => {
    const target = makeWide();
    const adapter = createElectronUpdaterAdapter(target);
    expect(adapter.autoDownload).toBe(true);
    adapter.autoDownload = false;
    expect(target.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(true);
    adapter.autoInstallOnAppQuit = false;
    expect(target.autoInstallOnAppQuit).toBe(false);
  });

  it('六个事件订阅按名转发，载荷原样透传（update-available / update-downloaded 携版本）', () => {
    const target = makeWide();
    const adapter = createElectronUpdaterAdapter(target);
    const available = vi.fn();
    const progress = vi.fn();
    const downloaded = vi.fn();
    const notAvailable = vi.fn();
    const checking = vi.fn();
    const error = vi.fn();
    adapter.on('update-available', available);
    adapter.on('download-progress', progress);
    adapter.on('update-downloaded', downloaded);
    adapter.on('update-not-available', notAvailable);
    adapter.on('checking-for-update', checking);
    adapter.on('error', error);
    target.emit('update-available', { version: '9.9.9' });
    target.emit('download-progress', { percent: 42 });
    target.emit('update-downloaded', { version: '9.9.9' });
    target.emit('update-not-available');
    target.emit('checking-for-update');
    target.emit('error', new Error('网络失败'));
    expect(available).toHaveBeenCalledWith({ version: '9.9.9' });
    expect(progress).toHaveBeenCalledWith({ percent: 42 });
    expect(downloaded).toHaveBeenCalledWith({ version: '9.9.9' });
    expect(notAvailable).toHaveBeenCalledTimes(1);
    expect(checking).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.any(Error));
  });

  it('checkForUpdates / downloadUpdate / quitAndInstall 动作转发', async () => {
    const target = makeWide();
    const adapter = createElectronUpdaterAdapter(target);
    await expect(adapter.checkForUpdates()).resolves.toBeNull();
    await expect(adapter.downloadUpdate()).resolves.toBeNull();
    adapter.quitAndInstall();
    expect(target.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(target.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(target.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('loadElectronUpdater', () => {
  it('包裹 electron-updater 导出的 autoUpdater（vi.mock 拦截静态 import 验证接线）', async () => {
    const updater = loadElectronUpdater();
    // 动作与开关直达被 mock 的 autoUpdater 实例：接线为同一底层对象
    updater.autoDownload = false;
    expect(wide.autoUpdater.autoDownload).toBe(false);
    updater.autoInstallOnAppQuit = false;
    expect(wide.autoUpdater.autoInstallOnAppQuit).toBe(false);
    await expect(updater.checkForUpdates()).resolves.toBeNull();
    expect(wide.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.quitAndInstall();
    expect(wide.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
