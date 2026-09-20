/**
 * 主进程装配入口（宪法 A.5-1 / B.3-1）：
 * 注册协议 scheme（必须在 app ready 前）→ ready 后注册协议处理器与 IPC → 创建窗口。
 * 生产加载 app://bundle/index.html（禁 file://，B.5-2）；开发加载 Vite dev server。
 * 装配语句收敛为可导出的 bootstrapMain，供单元测试以 vi.mock('electron') 驱动；
 * 模块加载时立即执行一次，生产行为不变。
 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import { app, BrowserWindow, Menu, dialog, protocol } from 'electron';
import { handleAppResource } from './protocol/appProtocol';
import { createVfsProtocolHandler } from './protocol/vfsProtocol';
import { registerIpcHandlers } from './ipc';
import { isOriginAllowed } from './security';
import { openDatabase } from './store/db';
import { runMigrations } from './store/migrate';
import { ensureDataDir, resolveDataDir } from './store/dataDir';
import { createVfsService } from './vfs/vfsService';
import { createSearchService } from './search/searchService';
import { createSettingsService } from './settings/settingsService';
import { createImportService, nodeFs } from './io/importService';
import { IPC } from '../shared/ipc';
import type { VfsChangedBroadcast } from '../shared/vfs-contract';
import type { ImportProgress } from '../shared/io-contract';
import { attachWindowCloseGuard, installApplicationMenu } from './menu/menu';
import { BackupService } from './backup/backupService';
import { toLocalIsoDate } from '../shared/time';
import type { BrowserWindow as BrowserWindowType, OpenDialogOptions } from 'electron';

const APP_ORIGIN = 'app://bundle';

/**
 * 创建主窗口并按运行模式加载页面，同时装配窗口安全基线三件套（宪法 B.5-4/5）
 * 与 close 拦截 guard（M4 spec §2.3）。
 * @param devServerUrl Vite dev server 地址（来源：主进程环境变量 VITE_DEV_SERVER_URL，
 *   仅主进程读取，A.2-2）；undefined 表示生产模式，加载 app:// 产物页。
 * @param allowedOrigins 导航放行的 origin 白名单（与 IPC 校验同一份，来源：
 *   whenReady 内按运行模式计算的 allowed，B.5-6）。
 * @param allow guard 放行标记（与 requestClose 共享同一对象引用）：false 时首次
 *   close 一律拦截并下发 confirm-close 命令，置 true 后重入 close 直通。
 * @returns 窗口实例（供 winRef 持有，requestClose 经其触发 close 重入）。
 */
function createMainWindow(
  devServerUrl: string | undefined,
  allowedOrigins: readonly string[],
  allow: { value: boolean },
): BrowserWindowType {
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
  // 右键「检查元素」（FR-RENDER-05，M4 spec §5.3）：inspectElement 自动命中命中点所在
  // 沙箱 iframe；全窗口生效不做区域细分（YAGNI）。原生 popup 不可被 Playwright 驱动——
  // 交互验收降级为单测断言 handler 行为（与 beforeunload 同理的既定处置）。
  win.webContents.on('context-menu', (_event, params) => {
    void Menu.buildFromTemplate([
      {
        label: '检查元素',
        click: () => {
          win.webContents.inspectElement(params.x, params.y);
        },
      },
    ]).popup({ window: win });
  });
  // close 拦截 guard（M4 spec §2.3）：未放行的首次 close 转发渲染层确认链
  attachWindowCloseGuard(win, allow);
  // 开发模式加载 dev server，生产加载 app:// 自定义协议（禁 loadURL 任意外部 URL）
  if (devServerUrl !== undefined) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadURL(APP_ORIGIN + '/index.html');
  }
  return win;
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
    // vfs://：standard 是相对 URL 解析的地基（非 standard 静默失败，spec §2.4 钉死）；
    // supportFetchAPI 供沙箱 connect-src vfs: 的 fetch；stream 供媒体渐进读取（Range/206）
    {
      scheme: 'vfs',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // corsEnabled 是跨源 fetch 的 scheme 级白名单：Blink 的 CORS scheme 白名单不认
        // 未声明该特权的自定义 scheme，缺它则一切跨源 fetch('vfs://…') 在进入网络栈前
        // 即被拒（Task 8 E2E console 实证："Cross origin requests are only supported for
        // protocol schemes: http, https…"），响应侧 ACAO:*（spec §2.3）无从生效——
        // 主页面 app://bundle 与沙箱 null origin 的 fetch 均依赖此特权（spec §2.4 勘误同提交）
        corsEnabled: true,
      },
    },
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
      // vfs:// 只读资源出口：handler 惰性装配语句（首请求才触库），挂载仍处
      // 开库 → 迁移 → 协议注册 → 建窗的 B.3-1 顺序内
      protocol.handle('vfs', createVfsProtocolHandler({ db }));
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
      // guard 放行标记（forceClose 唯一写点）：requestClose 置位后重入 close 直通
      const allowClose = { value: false };
      // 窗口句柄引用：闭包捕获须先于 registerIpcHandlers 声明（requestClose 引用 winRef）
      const winRef: { current: BrowserWindowType | null } = { current: null };
      // 还原替换点标记（restoreBackup 唯一置位点）：BackupService 固定时序走到 checkpoint
      // 调用 = 全部校验已过、即将 rename 覆盖——此刻须已释放库文件锁（见 checkpoint 供给注）。
      // 「swap 标记」为内存态闭包标志，随进程消亡，无持久化文件（评审 Minor 4 澄清）
      const restoreSwapPending = { value: false };
      // 备份服务（M5 批次③）：checkpoint 供给实现双语义——常规建份路径 TRUNCATE 冲刷 WAL
      // （A.4-9 空闲时刻 checkpoint + 复制）；还原替换点改走干净关闭释放文件锁（Windows 下
      // 打开中的库文件 rename 覆盖/删除一律 EPERM/EBUSY，实测见 Task 9 报告），而干净关闭
      // 自带最终 checkpoint 并清理 -wal/-shm，是替换前一致性准备的最强形态。
      // onDone 即 backup:done 广播（遍历全部窗口，宪法 B.3-4 同型广播面）
      const backup = new BackupService({
        backupsDir: layout.backupDir,
        dbFile: layout.dbFile,
        checkpoint: () => {
          if (restoreSwapPending.value) {
            restoreSwapPending.value = false;
            const closing = db;
            db = undefined;
            closing?.close();
            return;
          }
          db?.pragma('wal_checkpoint(TRUNCATE)');
        },
        onDone: (fileName) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.backupDone, fileName);
          }
        },
      });
      // 导入服务（M5 批次⑥ Task 12）：fs 走生产适配器（node:fs 同步原语，扫描/读取均在
      // 分批事务的预算外路径承载——A.5-4/D15）；onProgress 即 io:progress 广播（遍历全部
      // 窗口，服务侧保证事务提交后调用——宪法 B.3-4 同型广播面）。开库已成功（fail-fast
      // 已过），此刻 db 必为已赋值句柄（与上方 vfs/search 工厂同一窄化依据）
      const io = createImportService({
        db,
        fs: nodeFs,
        onProgress: (progress: ImportProgress) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.ioProgress, progress);
          }
        },
      });
      // 目录选择供给（io:pick-directory，Task 13 复用）：dialog.showOpenDialog 异步弹出
      // （不阻塞主进程事件循环），目录模式；multiple 区分导入多选与导出单选；取消返回空数组。
      // 不绑定主窗 owner：单窗应用下系统对话框恒前台，省去「窗未建/已关」分支（渲染端发起
      // invoke 时窗口必已存在，owner 判空属死分支）
      const pickDirectories = async (allowMultiple: boolean): Promise<readonly string[]> => {
        // 显式标注 Electron 契约类型（条件分支的窄字面量数组合并后需按契约定型）
        const options: OpenDialogOptions = {
          title: '选择文件夹',
          properties: allowMultiple ? ['openDirectory', 'multiSelections'] : ['openDirectory'],
        };
        const result = await dialog.showOpenDialog(options);
        if (result.canceled) return [];
        return result.filePaths;
      };
      /**
       * 还原编排（照 requestClose 先例的依赖注入，D11：服务不摸连接不摸生命周期）：
       * 置替换点标记后进入服务——存在性/integrity 校验等失败发生在替换点之前，库未关、
       * 错误照常上抛由 handler 转 Result（渲染层 toast 呈现）；关库后的极端失败（rename
       * 阶段 IO 错误）原库未损（rename 原子，失败即未发生），重开原库恢复服务后外抛。
       */
      const restoreBackup = (fileName: string): void => {
        try {
          restoreSwapPending.value = true;
          backup.restore(fileName);
        } catch (error: unknown) {
          restoreSwapPending.value = false;
          if (db === undefined) {
            db = openDatabase({ file: layout.dbFile });
            console.error('[main] 还原失败后已重开原库（建议重启应用以完全恢复服务）', error);
          }
          throw error;
        }
      };
      registerIpcHandlers({
        allowedOrigins: allowed,
        vfs,
        search,
        settings,
        broadcast,
        // guard 确认链主进程侧（M4 spec §2.3）：置放行标记后主动触发 close 重入，
        // close 事件二次进入时经 allowClose 直通、窗口得以真正关闭
        requestClose: () => {
          allowClose.value = true;
          winRef.current?.close();
        },
        backup,
        restoreBackup,
        // 还原成功响应 { relaunch: true } 后重启（D11：服务不直接 relaunch）
        requestRelaunch: () => {
          app.relaunch();
          app.exit(0);
        },
        // 导入域（M5 批次⑥）：导入服务与目录选择供给一并注入
        io,
        pickDirectories,
      });
      winRef.current = createMainWindow(devServerUrl, allowed, allowClose);
      // 应用菜单装配（M4 spec §5.2）：窗口创建后一次（命令经 shell:command 下发渲染层）
      installApplicationMenu();
      // 每日自动备份（M5 批次③）：装配完成后判定一次（窗口先行创建，复制不阻塞首帧）；
      // 到期判定与建份失败容错均在服务内（warn 不阻断启动）
      backup.autoBackupIfNeeded(toLocalIsoDate(new Date()), settings.get().backup.autoEnabled);
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
