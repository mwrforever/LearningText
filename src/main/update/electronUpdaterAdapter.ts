/**
 * electron-updater 适配器（2026-09-23 M9 批次，FR-UPDATE-01）：把 electron-updater 导出的
 * autoUpdater（宽 on 签名）适配为 updateService 消费的 UpdaterLike 窄接口。适配职责两件事：
 * ① autoDownload / autoInstallOnAppQuit 以存取器转发——createUpdateService 构造期的
 * 「关闭自动行为」赋值必须落到底层实例才真实生效；② 宽 on 与窄重载 on 的签名转换收敛在
 * 此一处，服务侧不感知 electron-updater 的宽签名形态（A.7-4 桥接面最小化）。
 */
import { autoUpdater as electronAutoUpdater } from 'electron-updater';
import type { UpdaterLike } from './updateService';

/**
 * electron-updater autoUpdater 的最小消费面（宽签名视图）：on 为
 * (event: string, listener: (...args: unknown[]) => void) 形态，事件名与载荷形态的真实
 * 契约由 electron-updater 的 AppUpdater 类型保证，本接口只声明适配所需的成员。
 */
export interface ElectronUpdaterLike {
  /** 是否自动下载（转发 createUpdateService 构造期的强制关闭赋值） */
  autoDownload: boolean;
  /** 下载完成后是否退出时自动安装（同上） */
  autoInstallOnAppQuit: boolean;
  /** 宽签名事件订阅：事件名/载荷契约见 UpdaterLike 的重载注记 */
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

/**
 * 把宽签名 autoUpdater 适配为 UpdaterLike。
 * @param autoUpdater electron-updater 实例（生产为真实 autoUpdater，测试为宽签名假体）
 * @returns 事件名与载荷形态与 UpdaterLike 重载一一对应的窄接口适配
 */
export function createElectronUpdaterAdapter(autoUpdater: ElectronUpdaterLike): UpdaterLike {
  const adapter = {
    // 存取器转发（非值拷贝）：服务侧对开关的读写必须直达底层实例，
    // 否则「构造期关闭自动下载/静默安装」只改了包装对象、真实自动行为照旧
    get autoDownload(): boolean {
      return autoUpdater.autoDownload;
    },
    set autoDownload(value: boolean) {
      autoUpdater.autoDownload = value;
    },
    get autoInstallOnAppQuit(): boolean {
      return autoUpdater.autoInstallOnAppQuit;
    },
    set autoInstallOnAppQuit(value: boolean) {
      autoUpdater.autoInstallOnAppQuit = value;
    },
    on: (event: string, listener: (...args: unknown[]) => void): void => {
      autoUpdater.on(event, listener);
    },
    checkForUpdates: (): Promise<unknown> => autoUpdater.checkForUpdates(),
    downloadUpdate: (): Promise<unknown> => autoUpdater.downloadUpdate(),
    quitAndInstall: (): void => {
      autoUpdater.quitAndInstall();
    },
  };
  // A.1-5 受控窄化（掌握超集信息）：adapter 的 on 为宽签名透传，而 electron-updater 的
  // 事件名（checking-for-update / update-available / update-not-available / download-progress /
  // update-downloaded / error）与载荷形态（UpdateInfo.version / ProgressInfo.percent / Error）
  // 恰为 UpdaterLike 六个重载签名描述的超集——窄化仅是类型面收敛，无运行时转换，
  // 载荷形状由 electron-updater 官方契约保证（形态相异即上游破坏性变更，升级时核对）。
  return adapter as UpdaterLike;
}

/**
 * 装配期加载真实 electron-updater 并过适配器。
 * @returns 包裹真实 autoUpdater 的 UpdaterLike（更新检查元数据来自随包 app-update.yml）
 */
export function loadElectronUpdater(): UpdaterLike {
  // 静态 import（模块顶部）+ 本函数桥接：electron-updater 以惰性 getter 暴露 autoUpdater，
  // import 本身不实例化更新器（无网络、无 IO），首次消费在 createUpdateService 构造期；
  // AppUpdater 实例是 ElectronUpdaterLike 的超集（事件名与载荷的超集关系，A.1-5 同上），
  // 直接经适配器窄化，不做运行时形态校验。
  return createElectronUpdaterAdapter(electronAutoUpdater);
}
