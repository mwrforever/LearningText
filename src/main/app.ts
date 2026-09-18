/**
 * 主进程装配入口（宪法 A.5-1 / B.3-1）：
 * 注册协议 scheme（必须在 app ready 前）→ ready 后注册协议处理器与 IPC → 创建窗口。
 * 生产加载 app://bundle/index.html（禁 file://，B.5-2）；开发加载 Vite dev server。
 * 装配语句收敛为可导出的 bootstrapMain，供单元测试以 vi.mock('electron') 驱动；
 * 模块加载时立即执行一次，生产行为不变。
 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import { app, BrowserWindow, protocol } from 'electron';
import { handleAppResource } from './protocol/appProtocol';
import { registerIpcHandlers } from './ipc';
import { isOriginAllowed } from './security';
import { openDatabase } from './store/db';
import { runMigrations } from './store/migrate';
import { ensureDataDir, resolveDataDir } from './store/dataDir';
import { createVfsService } from './vfs/vfsService';
import { createSearchService } from './search/searchService';
import { createSettingsService } from './settings/settingsService';
import { IPC } from '../shared/ipc';
import type { VfsChangedBroadcast } from '../shared/vfs-contract';

const APP_ORIGIN = 'app://bundle';

/**
 * 创建主窗口并按运行模式加载页面，同时装配窗口安全基线三件套（宪法 B.5-4/5）。
 * @param devServerUrl Vite dev server 地址（来源：主进程环境变量 VITE_DEV_SERVER_URL，
 *   仅主进程读取，A.2-2）；undefined 表示生产模式，加载 app:// 产物页。
 * @param allowedOrigins 导航放行的 origin 白名单（与 IPC 校验同一份，来源：
 *   whenReady 内按运行模式计算的 allowed，B.5-6）。
 */
function createMainWindow(
  devServerUrl: string | undefined,
  allowedOrigins: readonly string[],
): void {
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
  // 宪法 B.5-4：导航按 origin 白名单拦截（isOriginAllowed 内部用 URL 解析器）
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOriginAllowed(url, allowedOrigins)) {
      event.preventDefault();
    }
  });
  // 宪法 B.5-4：一律 deny window.open
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 宪法 B.5-5：权限请求默认全部拒绝
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
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
 * 消费 electron app 生命周期（window-all-closed 退出、will-quit 优雅关库）；
 * 装配失败（ready 阶段抛错）时记录错误并退出进程（fail-fast）。
 */
export function bootstrapMain(): void {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  // 数据库连接句柄：仅在 whenReady 内开库成功后赋值；开库前的 fail-fast 路径保持
  // undefined，will-quit 关库以可选链短路、不二次抛错（宪法 A.4-1/A.5-1）
  let db: Database.Database | undefined;
  // standard+secure 使 app:// 拥有正常 origin（senderFrame origin 校验依赖此语义）
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true } },
  ]);

  app
    .whenReady()
    .then(() => {
      // 数据目录解析与开库迁移（spec §2.1/§3）：本 then 块即 try 域，任一步抛错
      // 都落入下方 catch 分支 app.exit(1)（fail-fast，B.3-1 禁带伤运行）
      const layout = resolveDataDir(app.getPath('userData'));
      ensureDataDir(layout);
      db = openDatabase({ file: layout.dbFile });
      // 迁移失败抛错 → catch 分支 app.exit(1)（fail-fast，B.3-1）
      runMigrations(db);
      protocol.handle('app', handleAppResource);
      // origin 白名单：开发 = dev server + app 协议；生产 = 仅 app 协议（B.5-6）
      const allowed =
        devServerUrl !== undefined ? [new URL(devServerUrl).origin, APP_ORIGIN] : [APP_ORIGIN];
      const vfs = createVfsService(db);
      // 搜索服务与 VFS 同源单例连接（服务禁自行开连接，spec §7.3）
      const search = createSearchService(db);
      // 设置服务：路径由 dataDir 布局给定（spec §5），损坏回退默认不阻断（A.5-1 例外域）
      const settings = createSettingsService({ settingsFile: layout.settingsFile });
      const broadcast = (payload: VfsChangedBroadcast): void => {
        // 事务提交成功后由 handler 调用；遍历全部窗口广播（宪法 B.3-4）
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC.vfsChanged, payload);
        }
      };
      registerIpcHandlers({ allowedOrigins: allowed, vfs, search, settings, broadcast });
      createMainWindow(devServerUrl, allowed);
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

  // 退出前优雅关库（spec §2.2 / 宪法 A.4-1/A.5-1）：干净关闭令 SQLite 自动执行
  // 最终 WAL checkpoint 并清理 -wal/-shm。关库失败仅记录日志、不中断退出流程；
  // 开库前的 fail-fast 路径 db 为 undefined，可选链短路为无操作、不二次抛错。
  app.on('will-quit', () => {
    try {
      db?.close();
    } catch (e) {
      console.error('[main] 关闭数据库失败', e);
    }
  });
}

// 模块加载即装配：Electron 主进程入口仅此一次，scheme 注册必须先于 app ready
bootstrapMain();
