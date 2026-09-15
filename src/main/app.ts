/**
 * 主进程装配入口（宪法 A.5-1 / B.3-1）：
 * 注册协议 scheme（必须在 app ready 前）→ ready 后注册协议处理器与 IPC → 创建窗口。
 * 生产加载 app://bundle/index.html（禁 file://，B.5-2）；开发加载 Vite dev server。
 * 装配语句收敛为可导出的 bootstrapMain，供单元测试以 vi.mock('electron') 驱动；
 * 模块加载时立即执行一次，生产行为不变。
 */
import path from 'node:path';
import { app, BrowserWindow, protocol } from 'electron';
import { handleAppResource } from './protocol/appProtocol';
import { registerIpcHandlers } from './ipc';

const APP_ORIGIN = 'app://bundle';

/**
 * 创建主窗口并按运行模式加载页面。
 * @param devServerUrl Vite dev server 地址（来源：主进程环境变量 VITE_DEV_SERVER_URL，
 *   仅主进程读取，A.2-2）；undefined 表示生产模式，加载 app:// 产物页。
 */
function createMainWindow(devServerUrl: string | undefined): void {
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
  if (devServerUrl !== undefined) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadURL(APP_ORIGIN + '/index.html');
  }
}

/**
 * 执行主进程装配（整个生命周期仅调用一次）。
 * 消费 electron app 生命周期；装配失败（ready 阶段抛错）时记录错误并退出进程（fail-fast）。
 */
export function bootstrapMain(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  // standard+secure 使 app:// 拥有正常 origin（senderFrame origin 校验依赖此语义）
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true } },
  ]);

  app
    .whenReady()
    .then(() => {
      protocol.handle('app', handleAppResource);
      // origin 白名单：开发 = dev server + app 协议；生产 = 仅 app 协议（B.5-6）
      const allowed =
        devServerUrl !== undefined ? [new URL(devServerUrl).origin, APP_ORIGIN] : [APP_ORIGIN];
      registerIpcHandlers({ allowedOrigins: allowed });
      createMainWindow(devServerUrl);
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
}

// 模块加载即装配：Electron 主进程入口仅此一次，scheme 注册必须先于 app ready
bootstrapMain();
