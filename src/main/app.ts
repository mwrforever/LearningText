/**
 * 主进程装配入口（宪法 A.5-1 / B.3-1）：
 * 注册协议 scheme（必须在 app ready 前）→ ready 后注册协议处理器与 IPC → 创建窗口。
 * 生产加载 app://bundle/index.html（禁 file://，B.5-2）；开发加载 Vite dev server。
 */
import path from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { handleAppResource } from './protocol/appProtocol';
import { registerIpcHandlers } from './ipc';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ORIGIN = 'app://bundle';

// standard+secure 使 app:// 拥有正常 origin（senderFrame origin 校验依赖此语义）
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true } },
]);

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'LearningText',
    webPreferences: {
      // 宪法 B.5-1：默认值显式写出，防回归（审计可查）
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  // 开发模式加载 dev server，生产加载 app:// 自定义协议（禁 loadURL 任意外部 URL）
  if (DEV_SERVER_URL !== undefined) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadURL(APP_ORIGIN + '/index.html');
  }
}

app
  .whenReady()
  .then(() => {
    protocol.handle('app', handleAppResource);
    // origin 白名单：开发 = dev server + app 协议；生产 = 仅 app 协议（B.5-6）
    const allowed =
      DEV_SERVER_URL !== undefined ? [new URL(DEV_SERVER_URL).origin, APP_ORIGIN] : [APP_ORIGIN];
    registerIpcHandlers({ allowedOrigins: allowed });
    createMainWindow();
  })
  .catch((e: unknown) => {
    // 装配失败禁止带伤运行（B.3-1）
    console.error('[main] 装配失败，进程退出', e);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
