// 应用内更新状态机服务单元测试（M9 批次，FR-UPDATE-01）：以 UpdaterLike 假体驱动全部
// 状态转移与防御分支——构造期关闭自动行为、check 终态三来源（事件优先 / promise 兜底 /
// 失败转 error）、防重入、下载与安装的非法态 no-op、百分数钳制、定时器排程与成对释放。
// 假定时器驱动 start/dispose；时钟注入固定时刻驱动 checkedAt。
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createUpdateService, type UpdaterLike } from '../../../src/main/update/updateService';
import { toLocalIsoTime } from '../../../src/shared/time';
import type { UpdateCapability, UpdateState } from '../../../src/shared/update-contract';

/** UpdaterLike 假体：事件经 emit 手动派发（注册表捕获），检查/下载可编程 */
interface UpdaterStub extends UpdaterLike {
  emit(event: string, ...args: unknown[]): void;
  checkForUpdates: Mock<() => Promise<unknown>>;
  downloadUpdate: Mock<() => Promise<unknown>>;
  quitAndInstall: Mock<() => void>;
}

function makeUpdaterStub(): UpdaterStub {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const stub = {
    // 预置 true：断言构造期被服务强制翻转（自动下载/静默安装的唯一关闭点）
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
  // 宽 on 实现到窄重载接口的测试期适配（makeVfsStub 同款先例）
  return stub as unknown as UpdaterStub;
}

const FIXED_NOW = new Date('2026-09-23T10:00:00');

function makeService(
  overrides: {
    capability?: UpdateCapability;
    updater?: UpdaterStub;
    now?: () => Date;
    startupDelayMs?: number;
    checkIntervalMs?: number;
  } = {},
): {
  service: ReturnType<typeof createUpdateService>;
  updater: UpdaterStub;
  onState: Mock<(state: UpdateState) => void>;
} {
  const updater = overrides.updater ?? makeUpdaterStub();
  const onState = vi.fn<(state: UpdateState) => void>();
  const service = createUpdateService({
    currentVersion: '0.1.1',
    capability: overrides.capability ?? { enabled: true },
    updater,
    onState,
    now: overrides.now ?? (() => FIXED_NOW),
    startupDelayMs: overrides.startupDelayMs,
    checkIntervalMs: overrides.checkIntervalMs,
  });
  return { service, updater, onState };
}

/** 令一次「发现新版本」检查：checkForUpdates 执行期间同步派发 update-available */
function stubAvailableCheck(updater: UpdaterStub, version: string): void {
  updater.checkForUpdates.mockImplementation(() => {
    updater.emit('update-available', { version });
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('初始化与构造期', () => {
  it('能力开启：初始态 idle，初始态不广播（渲染层经 get-state 首拉）', () => {
    const { service, onState } = makeService();
    expect(service.getState()).toEqual({ kind: 'idle', currentVersion: '0.1.1' });
    expect(onState).not.toHaveBeenCalled();
  });

  it('能力关闭：初始态 unsupported 携原因（渲染层据此收敛更新入口）', () => {
    const { service } = makeService({ capability: { enabled: false, reason: 'platform' } });
    expect(service.getState()).toEqual({
      kind: 'unsupported',
      currentVersion: '0.1.1',
      reason: 'platform',
    });
  });

  it('构造期强制关闭自动下载与退出静默安装（下载/安装须经用户确认的唯一关闭点）', () => {
    const { updater } = makeService();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});

describe('check 终态来源', () => {
  it('能力关闭：直接返回当前态且不发起网络请求', async () => {
    const { service, updater } = makeService({ capability: { enabled: false, reason: 'dev' } });
    await expect(service.check()).resolves.toEqual({
      kind: 'unsupported',
      currentVersion: '0.1.1',
      reason: 'dev',
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('检查中发现新版本：返回 available 终态并记录版本号', async () => {
    const { service, updater } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await expect(service.check()).resolves.toEqual({
      kind: 'available',
      currentVersion: '0.1.1',
      version: '9.9.9',
    });
  });

  it('已是最新：返回 up-to-date 终态且 checkedAt 取注入时钟的本地 ISO 串', async () => {
    const { service, updater } = makeService();
    updater.checkForUpdates.mockImplementation(() => {
      updater.emit('update-not-available');
      return Promise.resolve(null);
    });
    await expect(service.check()).resolves.toEqual({
      kind: 'up-to-date',
      currentVersion: '0.1.1',
      checkedAt: toLocalIsoTime(FIXED_NOW),
    });
  });

  it('promise 结束仍无结论事件：按 up-to-date 兜底（以事件为准、promise 兜底，不滞留 checking）', async () => {
    const { service } = makeService();
    // 上游 resolve 但未派发任何 update-* / error 事件：兜底兑现
    await expect(service.check()).resolves.toEqual({
      kind: 'up-to-date',
      currentVersion: '0.1.1',
      checkedAt: toLocalIsoTime(FIXED_NOW),
    });
    expect(service.getState().kind).toBe('up-to-date');
  });

  it('未注入时钟时使用系统时刻（缺省 now 供给链路；checkedAt 为本地 ISO 形态）', async () => {
    // 绕过 makeService（其恒注入固定时钟）：直驱工厂验证 deps.now 缺省分支
    const updater = makeUpdaterStub();
    const service = createUpdateService({
      currentVersion: '0.1.1',
      capability: { enabled: true },
      updater,
      onState: vi.fn<(state: UpdateState) => void>(),
    });
    await expect(service.check()).resolves.toEqual({
      kind: 'up-to-date',
      currentVersion: '0.1.1',
      checkedAt: toLocalIsoTime(new Date()),
    });
  });

  it('promise reject（无 error 事件）：转 error 态并收敛为单行 message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { service, updater } = makeService();
      updater.checkForUpdates.mockRejectedValue(new Error('网络超时\n请稍后重试'));
      await expect(service.check()).resolves.toEqual({
        kind: 'error',
        currentVersion: '0.1.1',
        message: '网络超时 请稍后重试',
      });
      expect(errorSpy).toHaveBeenCalledWith('[update] 检查更新失败', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('非 Error 形态的 reject：message 取 String 形态（防御性收敛）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { service, updater } = makeService();
      updater.checkForUpdates.mockRejectedValue('裸字符串失败');
      await expect(service.check()).resolves.toEqual({
        kind: 'error',
        currentVersion: '0.1.1',
        message: '裸字符串失败',
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('error 事件先至、promise 后 reject：error 态只广播一次（同因去重）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { service, updater, onState } = makeService();
      updater.checkForUpdates.mockImplementation(() => {
        updater.emit('error', new Error('manifest 不可达'));
        return Promise.reject(new Error('manifest 不可达'));
      });
      const result = await service.check();
      expect(result).toEqual({
        kind: 'error',
        currentVersion: '0.1.1',
        message: 'manifest 不可达',
      });
      const errorPushes = onState.mock.calls.filter(([state]) => state.kind === 'error');
      expect(errorPushes).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('检查进行中重入：返回当前 checking 态，不产生并发请求', async () => {
    const { service, updater } = makeService();
    let release!: (value: unknown) => void;
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = service.check();
    // 挂起期间重入：立即返回 checking 当前态
    await expect(service.check()).resolves.toEqual({ kind: 'checking', currentVersion: '0.1.1' });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    release(null);
    await first;
  });

  it('checking 期间到达的 checking-for-update 事件：同态去重不重复广播', async () => {
    const { service, updater, onState } = makeService();
    let release!: (value: unknown) => void;
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.check();
    const pushesBefore = onState.mock.calls.length;
    updater.emit('checking-for-update');
    expect(onState.mock.calls.length).toBe(pushesBefore);
    release(null);
    await pending;
  });

  it('空闲态到达的 checking-for-update 事件（无 check 在途）：照常转移 checking', () => {
    const { service, updater, onState } = makeService();
    updater.emit('checking-for-update');
    expect(service.getState()).toEqual({ kind: 'checking', currentVersion: '0.1.1' });
    expect(onState).toHaveBeenCalledWith({ kind: 'checking', currentVersion: '0.1.1' });
  });
});

describe('download 与进度', () => {
  it('非 available 态调用：no-op 原样返回，不触发下载', () => {
    const { service, updater } = makeService();
    const state = service.download();
    expect(state).toEqual({ kind: 'idle', currentVersion: '0.1.1' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('available 态调用：同步返回 downloading 新态（percent 0，全态携带当前版本），下载不阻塞调用', async () => {
    const { service, updater } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await service.check();
    const state = service.download();
    expect(state).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '9.9.9',
      percent: 0,
    });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('下载进度四舍五入取整并钳制 0–100（超界收敛、非有限数按 0）', async () => {
    const { service, updater } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await service.check();
    service.download();
    updater.emit('download-progress', { percent: 33.4 });
    expect(service.getState()).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '9.9.9',
      percent: 33,
    });
    updater.emit('download-progress', { percent: 150 });
    expect(service.getState()).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '9.9.9',
      percent: 100,
    });
    updater.emit('download-progress', { percent: -5 });
    expect(service.getState()).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '9.9.9',
      percent: 0,
    });
    updater.emit('download-progress', { percent: Number.NaN });
    expect(service.getState()).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '9.9.9',
      percent: 0,
    });
  });

  it('异常序列防御：未发现版本即收到进度事件，版本号回退当前版本（不产出空版本态）', () => {
    const { service, updater } = makeService();
    updater.emit('download-progress', { percent: 10 });
    expect(service.getState()).toEqual({
      kind: 'downloading',
      currentVersion: '0.1.1',
      version: '0.1.1',
      percent: 10,
    });
  });

  it('下载失败（promise reject）：转 error 态，不产生未处理的 promise rejection', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { service, updater } = makeService();
      stubAvailableCheck(updater, '9.9.9');
      await service.check();
      updater.downloadUpdate.mockRejectedValue(new Error('磁盘已满'));
      service.download();
      // 微任务排空：catch 收口必须落地（若有 unhandled rejection，vitest 会置失败）
      await vi.advanceTimersByTimeAsync(0);
      expect(service.getState()).toEqual({
        kind: 'error',
        currentVersion: '0.1.1',
        message: '磁盘已满',
      });
      expect(errorSpy).toHaveBeenCalledWith('[update] 下载更新失败', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('downloading/downloaded 态门禁（正确性审查 Major 2 回归守卫）', () => {
  it('downloaded 态下 check() 不发请求、不打回 available——搁置后「重启以完成更新」语义不回退', async () => {
    const { service, updater } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await service.check();
    service.download();
    updater.emit('update-downloaded', { version: '9.9.9' });
    updater.checkForUpdates.mockClear();
    const current = await service.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(current.kind).toBe('downloaded');
    expect(service.getState().kind).toBe('downloaded');
  });

  it('downloading 态下 check() 同样短路（下载中途周期检查不产生并发请求、不打断进度）', async () => {
    const { service, updater } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await service.check();
    service.download();
    updater.checkForUpdates.mockClear();
    await service.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(service.getState().kind).toBe('downloading');
  });
});

describe('downloaded 与 install', () => {
  it('update-downloaded 事件：转移 downloaded 态（携新版本与当前版本）', async () => {
    const { service, updater, onState } = makeService();
    stubAvailableCheck(updater, '9.9.9');
    await service.check();
    service.download();
    updater.emit('update-downloaded', { version: '9.9.9' });
    expect(service.getState()).toEqual({
      kind: 'downloaded',
      currentVersion: '0.1.1',
      version: '9.9.9',
    });
    expect(onState).toHaveBeenLastCalledWith({
      kind: 'downloaded',
      currentVersion: '0.1.1',
      version: '9.9.9',
    });
  });

  it('非 downloaded 态 install：no-op 不触发 quitAndInstall（防非法态调用）', () => {
    const { service, updater } = makeService();
    service.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('downloaded 态 install：执行 quitAndInstall（调用后进程即将退出）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const { service, updater } = makeService();
      stubAvailableCheck(updater, '9.9.9');
      await service.check();
      service.download();
      updater.emit('update-downloaded', { version: '9.9.9' });
      service.install();
      expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe('error 事件（独立于 check 的失败路径）', () => {
  it('多行错误消息剥换行为单行，error 留痕含原始异常', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { service, updater } = makeService();
      updater.emit('error', new Error('第一行\n第二行\r\n第三行'));
      expect(service.getState()).toEqual({
        kind: 'error',
        currentVersion: '0.1.1',
        message: '第一行 第二行 第三行',
      });
      expect(errorSpy).toHaveBeenCalledWith('[update] 更新流程失败', expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('start 与 dispose 定时器生命周期', () => {
  it('能力关闭：start 不排任何定时器（无网络、无计时行为）', () => {
    const { service } = makeService({ capability: { enabled: false, reason: 'dev' } });
    service.start();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('能力开启：启动延迟后首查、此后按周期检查；dispose 成对释放且幂等', async () => {
    const { service, updater } = makeService({ startupDelayMs: 5000, checkIntervalMs: 60_000 });
    service.start();
    expect(vi.getTimerCount()).toBe(2);
    // 首查前不发起请求（避开启动争抢）
    await vi.advanceTimersByTimeAsync(4999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // 周期到期再查一次；检查失败不抛出（promise reject 由服务内收敛）
    updater.checkForUpdates.mockRejectedValue(new Error('离线'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    // 成对释放：清空两个句柄；重复 dispose 幂等
    service.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => service.dispose()).not.toThrow();
  });

  it('默认节奏：启动后 5s 首查、每 4 小时一次（缺省参数兜底，周期自 start 起算）', async () => {
    const { service, updater } = makeService();
    service.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    // 周期定时器与首查定时器同时在 start 排程：距上次推进已过 5s，距周期触发还差 4h - 5s
    await vi.advanceTimersByTimeAsync(14_400_000 - 5000 - 1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('未 start 直接 dispose：句柄为空时安全跳过（will-quit 与 start 前路径）', () => {
    const { service } = makeService();
    expect(() => service.dispose()).not.toThrow();
  });
});
