// preload 桥单元测试：仅暴露具名 api、ping 与 vfs 十通道与 search/settings/vfs:get/shell
// 通道走类型化通道、广播订阅剥离 event 首参（宪法 A.7-4 / B.5 桥接面最小化）
import { describe, expect, it, vi } from 'vitest';

/** exposeInMainWorld 注册到渲染层的 api 形态（与 src/shared/window-api.ts 契约对应） */
interface ExposedApi {
  ping(): Promise<unknown>;
  listChildren(request: unknown): Promise<unknown>;
  createNode(request: unknown): Promise<unknown>;
  readFile(request: unknown): Promise<unknown>;
  writeFile(request: unknown): Promise<unknown>;
  renameNode(request: unknown): Promise<unknown>;
  moveNode(request: unknown): Promise<unknown>;
  trashNode(request: unknown): Promise<unknown>;
  restoreNode(request: unknown): Promise<unknown>;
  purgeNode(request: unknown): Promise<unknown>;
  listTrashed(request: unknown): Promise<unknown>;
  resolvePath(request: unknown): Promise<unknown>;
  searchQuery(request: unknown): Promise<unknown>;
  settingsGet(request: unknown): Promise<unknown>;
  settingsSet(request: unknown): Promise<unknown>;
  getNode(request: unknown): Promise<unknown>;
  forceClose(request: unknown): Promise<unknown>;
  backupCreate(request: unknown): Promise<unknown>;
  backupList(request: unknown): Promise<unknown>;
  backupRestore(request: unknown): Promise<unknown>;
  importNodes(request: unknown): Promise<unknown>;
  cancelImport(request: unknown): Promise<unknown>;
  pickDirectory(request: unknown): Promise<unknown>;
  onShellCommand(callback: (event: unknown) => void): () => void;
  onVfsChanged(callback: (event: unknown) => void): () => void;
  onBackupDone(callback: (event: unknown) => void): () => void;
  onIoProgress(callback: (event: unknown) => void): () => void;
}

/** invoke 类通道的包装方法名（ping 与四个订阅通道单独用例覆盖） */
type InvokeMethod = Exclude<
  keyof ExposedApi,
  'ping' | 'onVfsChanged' | 'onShellCommand' | 'onBackupDone' | 'onIoProgress'
>;

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(name: string, api: ExposedApi) => void>(),
  invoke: vi.fn<(channel: string, payload: unknown) => Promise<unknown>>(),
  on: vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>(),
  removeListener:
    vi.fn<(channel: string, listener: (event: unknown, payload: unknown) => void) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.removeListener },
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
      'listTrashed',
      'resolvePath',
      'searchQuery',
      'settingsGet',
      'settingsSet',
      'getNode',
      'forceClose',
      'backupCreate',
      'backupList',
      'backupRestore',
      'importNodes',
      'cancelImport',
      'pickDirectory',
      'onIoProgress',
      'onShellCommand',
      'onVfsChanged',
      'onBackupDone',
    ]);
  });

  it('ping 经 system:ping 通道调用主进程且载荷为 null，结果原样回传', async () => {
    const result = { ok: true, value: { pong: true } };
    mocks.invoke.mockResolvedValue(result);

    await expect(exposedApi.ping()).resolves.toBe(result);

    expect(mocks.invoke).toHaveBeenCalledWith(IPC.systemPing, null);
  });

  it('invoke 类通道的包装：通道名常量与载荷原样透传（不感知通道字符串）', async () => {
    const payload = { nodeId: 3 };
    // searchQuery 载荷取 search 形（M2 deferred 顺手清：通道语义与载荷形态对应）
    const searchPayload = { keyword: '指数' };
    // 通道名必须取自 shared 常量，方法与通道一一对应（契约 window-api.ts）；
    // settingsGet/forceClose 无参沿 system:ping 先例固定发 null，其余通道载荷原样透传
    const channelCases: Array<[InvokeMethod, string, unknown]> = [
      ['listChildren', IPC.vfsList, payload],
      ['createNode', IPC.vfsCreate, payload],
      ['readFile', IPC.vfsRead, payload],
      ['writeFile', IPC.vfsWrite, payload],
      ['renameNode', IPC.vfsRename, payload],
      ['moveNode', IPC.vfsMove, payload],
      ['trashNode', IPC.vfsTrash, payload],
      ['restoreNode', IPC.vfsRestore, payload],
      ['purgeNode', IPC.vfsPurge, payload],
      // 无参通道沿 settingsGet 先例固定发 null（回收站列表，M5 批次②）
      ['listTrashed', IPC.vfsListTrashed, null],
      ['resolvePath', IPC.vfsResolve, payload],
      ['searchQuery', IPC.searchQuery, searchPayload],
      ['settingsGet', IPC.settingsGet, null],
      ['settingsSet', IPC.settingsSet, payload],
      ['getNode', IPC.vfsGet, payload],
      ['forceClose', IPC.shellForceClose, null],
      // 备份域（M5 批次③）：create/list 无参通道沿 settingsGet 先例固定发 null，restore 透传请求
      ['backupCreate', IPC.backupCreate, null],
      ['backupList', IPC.backupList, null],
      ['backupRestore', IPC.backupRestore, { fileName: 'lt-20260921-080000.db' }],
      // 导入域（M5 批次⑥）：导入请求透传、取消按 importId 寻址、目录选择带多选开关
      [
        'importNodes',
        IPC.ioImport,
        { sourcePaths: ['D:/notes'], targetParentId: 1, conflict: 'skip' },
      ],
      ['cancelImport', IPC.ioCancel, { importId: 1 }],
      ['pickDirectory', IPC.ioPickDirectory, { multiple: true }],
    ];
    mocks.invoke.mockResolvedValue({ ok: true, value: null });
    for (const [method, channel, request] of channelCases) {
      await exposedApi[method](request);
      expect(mocks.invoke).toHaveBeenCalledWith(channel, request);
    }
  });

  it('onVfsChanged 订阅：剥离 event 首参仅回传业务载荷，退订移除同一监听器', () => {
    const callback = vi.fn<(event: unknown) => void>();
    const unsubscribe = exposedApi.onVfsChanged(callback);
    // 订阅固定挂在 vfs:changed 广播通道上
    const onCall = mocks.on.mock.calls[0];
    expect(onCall?.[0]).toBe(IPC.vfsChanged);
    const listener = onCall?.[1];
    if (listener === undefined) {
      throw new Error('onVfsChanged 未注册监听器');
    }
    // 模拟主进程广播：首个参数为 IpcRendererEvent 形态，必须被剥离后不透传；
    // 载荷为 { rev, event } 包装形态（M3 spec §4.2 防撕裂）
    listener({ sender: 'ipc-event' }, { rev: 1, event: { type: 'created', node: { id: 1 } } });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ rev: 1, event: { type: 'created', node: { id: 1 } } });
    // 退订必须移除同一个监听器实例，避免泄漏
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.vfsChanged, listener);
  });

  it('onShellCommand 订阅：剥离 event 首参仅回传命令载荷，退订移除同一监听器', () => {
    const callback = vi.fn<(command: unknown) => void>();
    const unsubscribe = exposedApi.onShellCommand(callback);
    // 订阅固定挂在 shell:command 通道上；取末次注册规避与 onVfsChanged 用例的调用历史叠加
    const onCall = mocks.on.mock.calls.at(-1);
    expect(onCall?.[0]).toBe(IPC.shellCommand);
    const listener = onCall?.[1];
    if (listener === undefined) {
      throw new Error('onShellCommand 未注册监听器');
    }
    // 模拟主进程命令推送：首个参数为 IpcRendererEvent 形态，必须被剥离后不透传
    listener({ sender: 'ipc-event' }, { type: 'save' });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ type: 'save' });
    // 退订必须移除同一个监听器实例，避免泄漏
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.shellCommand, listener);
  });

  it('onBackupDone 订阅：剥离 event 首参仅回传备份文件名，退订移除同一监听器', () => {
    const callback = vi.fn<(event: unknown) => void>();
    const unsubscribe = exposedApi.onBackupDone(callback);
    // 订阅固定挂在 backup:done 广播通道上（M5 批次③）
    const onCall = mocks.on.mock.calls.at(-1);
    expect(onCall?.[0]).toBe(IPC.backupDone);
    const listener = onCall?.[1];
    if (listener === undefined) {
      throw new Error('onBackupDone 未注册监听器');
    }
    // 模拟主进程广播：首个参数为 IpcRendererEvent 形态，必须被剥离后不透传
    listener({ sender: 'ipc-event' }, 'lt-20260921-080000.db');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('lt-20260921-080000.db');
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.backupDone, listener);
  });

  it('onIoProgress 订阅：剥离 event 首参仅回传导入进度载荷，退订移除同一监听器', () => {
    const callback = vi.fn<(event: unknown) => void>();
    const unsubscribe = exposedApi.onIoProgress(callback);
    // 订阅固定挂在 io:progress 广播通道上（M5 批次⑥）
    const onCall = mocks.on.mock.calls.at(-1);
    expect(onCall?.[0]).toBe(IPC.ioProgress);
    const listener = onCall?.[1];
    if (listener === undefined) {
      throw new Error('onIoProgress 未注册监听器');
    }
    // 模拟主进程进度广播：首个参数为 IpcRendererEvent 形态，必须被剥离后不透传
    const payload = { importId: 1, phase: 'writing', done: 200, total: 250, currentPath: 'a.txt' };
    listener({ sender: 'ipc-event' }, payload);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.ioProgress, listener);
  });
});
