/**
 * preload 桥（宪法 B.1 / A.7-3）：仅按通道暴露具名包装函数，
 * 禁暴露 ipcRenderer 本体、禁透传原始回调（B.5 / 安全清单 #20）。
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { Result } from '../shared/result';
import type { WindowApi } from '../shared/window-api';

const api: WindowApi = {
  ping: (): Promise<Result<{ pong: true }>> => ipcRenderer.invoke(IPC.systemPing, null),
};

contextBridge.exposeInMainWorld('api', api);
