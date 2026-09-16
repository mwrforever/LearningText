// preload 桥单元测试：仅暴露具名 api 且 ping 走类型化通道（宪法 A.7-4 / B.5 桥接面最小化）
import { describe, expect, it, vi } from 'vitest';

/** exposeInMainWorld 注册到渲染层的 api 形态（与 src/shared/window-api.ts 契约对应） */
interface ExposedApi {
  ping(): Promise<unknown>;
}

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: ExposedApi) => void>(),
  invoke: vi.fn<(channel: string, payload: unknown) => Promise<unknown>>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { invoke: mocks.invoke },
}));

import { IPC } from '../../../src/shared/ipc';
import '../../../src/preload/index';

// preload 模块加载即完成注册，这里在加载后立即捕获注册参数（不依赖跨测试的调用历史）
const registration = mocks.exposeInMainWorld.mock.calls[0];
if (registration === undefined) {
  throw new Error('preload 未向 contextBridge 注册 api');
}
const bridgeName = registration[0];
const exposedApi = registration[1];

describe('preload 桥注册', () => {
  it('以具名 api 暴露契约全量成员（禁暴露 ipcRenderer 本体与多余通道）', () => {
    expect(bridgeName).toBe('api');
    expect(Object.keys(exposedApi)).toEqual([
      'ping',
      'listChildren',
      'createNode',
      'readFile',
      'writeFile',
      'renameNode',
      'moveNode',
      'trashNode',
      'restoreNode',
      'purgeNode',
      'resolvePath',
      'onVfsChanged',
    ]);
  });

  it('ping 经 system:ping 通道调用主进程且载荷为 null，结果原样回传', async () => {
    const result = { ok: true, value: { pong: true } };
    mocks.invoke.mockResolvedValue(result);

    await expect(exposedApi.ping()).resolves.toBe(result);

    expect(mocks.invoke).toHaveBeenCalledWith(IPC.systemPing, null);
  });
});
