/**
 * preload 桥（宪法 B.1 / A.7-3）：仅按通道暴露具名包装函数，
 * 禁暴露 ipcRenderer 本体、禁透传原始回调（B.5 / 安全清单 #20）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type { Result } from '../shared/result';
import type { ShellCommand } from '../shared/shell-contract';
import type { VfsChangedBroadcast } from '../shared/vfs-contract';
import type { IoProgress } from '../shared/io-contract';
import type { WindowApi } from '../shared/window-api';

const api: WindowApi = {
  // 平台标识（M6 spec §2.2）：contextBridge 原语直传，渲染层据此做菜单/控制钮平台差异
  platform: process.platform,
  ping: (): Promise<Result<{ pong: true }>> => ipcRenderer.invoke(IPC.systemPing, null),
  // —— VFS 域（M1）：invoke 转发即最终形态，zod 校验与业务逻辑在主进程 handler ——
  listChildren: (request) => ipcRenderer.invoke(IPC.vfsList, request),
  createNode: (request) => ipcRenderer.invoke(IPC.vfsCreate, request),
  readFile: (request) => ipcRenderer.invoke(IPC.vfsRead, request),
  writeFile: (request) => ipcRenderer.invoke(IPC.vfsWrite, request),
  renameNode: (request) => ipcRenderer.invoke(IPC.vfsRename, request),
  moveNode: (request) => ipcRenderer.invoke(IPC.vfsMove, request),
  trashNode: (request) => ipcRenderer.invoke(IPC.vfsTrash, request),
  restoreNode: (request) => ipcRenderer.invoke(IPC.vfsRestore, request),
  purgeNode: (request) => ipcRenderer.invoke(IPC.vfsPurge, request),
  // 无参通道沿 settingsGet 先例固定发 null（回收站列表，M5 批次②）
  listTrashed: () => ipcRenderer.invoke(IPC.vfsListTrashed, null),
  resolvePath: (request) => ipcRenderer.invoke(IPC.vfsResolve, request),
  searchQuery: (request) => ipcRenderer.invoke(IPC.searchQuery, request),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet, null),
  settingsSet: (request) => ipcRenderer.invoke(IPC.settingsSet, request),
  getNode: (request) => ipcRenderer.invoke(IPC.vfsGet, request),
  // 无参通道沿 settingsGet 先例固定发 null（状态栏文档计数，M6 spec §2.6）
  countNodes: () => ipcRenderer.invoke(IPC.vfsCount, null),
  forceClose: () => ipcRenderer.invoke(IPC.shellForceClose, null),
  // —— 备份域（M5 批次③）：create/list 无参通道沿 settingsGet 先例固定发 null ——
  backupCreate: () => ipcRenderer.invoke(IPC.backupCreate, null),
  backupList: () => ipcRenderer.invoke(IPC.backupList, null),
  backupRestore: (request) => ipcRenderer.invoke(IPC.backupRestore, request),
  // —— 导入域（M5 批次⑥）：invoke 长任务 + 取消寻址 + 目录选择供给 ——
  importNodes: (request) => ipcRenderer.invoke(IPC.ioImport, request),
  cancelImport: (request) => ipcRenderer.invoke(IPC.ioCancel, request),
  pickDirectory: (request) => ipcRenderer.invoke(IPC.ioPickDirectory, request),
  // —— 导出域（M5 批次⑥ Task 13）：invoke 长任务 + 打开目录完成动作 ——
  exportNodes: (request) => ipcRenderer.invoke(IPC.ioExport, request),
  // openPath 白名单边界（B.5-4 精神）：dir 仅接受主进程 dialog 产出的目录串，主进程
  // handler 按当次会话登记簿校验，伪造串不达 shell（包装为纯透传，校验在主进程侧）
  openPath: (request) => ipcRenderer.invoke(IPC.shellOpenPath, request),
  // —— 数据目录域（M6 批次③）：get-info 无参沿 null 先例；change 为 invoke 长动作 ——
  getDataDirInfo: () => ipcRenderer.invoke(IPC.storageGetInfo, null),
  changeDataDir: (request) => ipcRenderer.invoke(IPC.storageChangeDataDir, request),
  /** 订阅 io 进度广播（导入/导出可辨识联合按 kind 区分）：同 onBackupDone 先例，退订成对 */
  onIoProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, value: IoProgress): void => callback(value);
    ipcRenderer.on(IPC.ioProgress, listener);
    return () => ipcRenderer.removeListener(IPC.ioProgress, listener);
  },
  /** 订阅外壳命令：同 onVfsChanged 先例，包装内部消化 ipcRenderer */
  onShellCommand: (callback) => {
    const listener = (_event: IpcRendererEvent, value: ShellCommand): void => callback(value);
    ipcRenderer.on(IPC.shellCommand, listener);
    return () => ipcRenderer.removeListener(IPC.shellCommand, listener);
  },
  /** 订阅树变更广播：包装内部消化 ipcRenderer 并返回取消订阅函数（禁透传原始回调） */
  onVfsChanged: (callback) => {
    // 剥离 event 首参后仅回传业务载荷，渲染层不感知 ipcRenderer
    const listener = (_event: IpcRendererEvent, value: VfsChangedBroadcast): void =>
      callback(value);
    ipcRenderer.on(IPC.vfsChanged, listener);
    return () => ipcRenderer.removeListener(IPC.vfsChanged, listener);
  },
  /** 订阅备份完成广播（载荷为备份文件名）：同 onVfsChanged 先例，退订成对 */
  onBackupDone: (callback) => {
    const listener = (_event: IpcRendererEvent, value: string): void => callback(value);
    ipcRenderer.on(IPC.backupDone, listener);
    return () => ipcRenderer.removeListener(IPC.backupDone, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
