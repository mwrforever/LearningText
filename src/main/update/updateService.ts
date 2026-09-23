/**
 * 应用内更新状态机服务（2026-09-23 M9 批次，FR-UPDATE-01）：包装 electron-updater 的
 * 事件流为八态可辨识联合（UpdateState，shared/update-contract 单一来源），全部状态变更
 * 经 onState 推送（app 层装配为 update:state 广播）且 getState() 可读，状态机归属主进程、
 * 渲染层只呈现。自动下载 / 退出静默安装一律关闭（构造期翻转 updater 开关）——下载与安装
 * 必须经用户确认（update:download / update:install 通道）才发生。
 *
 * 职责切分（照 BackupService 先例）：本服务不摸窗口（onState 供给广播）、不摸应用生命周期
 * （start/dispose 由装配层驱动）、不摸 electron-updater 本体（UpdaterLike 注入，单测以假体
 * 驱动全部分支）。检查节奏：启动延迟首查避开启动争抢，此后按固定周期静默检查；能力关闭的
 * 形态不排任何定时器、不发任何网络请求。
 */
import { toLocalIsoTime } from '../../shared/time';
import type { UpdateCapability, UpdateState } from '../../shared/update-contract';

/** 启动后首查延迟（毫秒）：避开开库 / 建窗 / 首帧的启动争抢后再发起网络检查 */
const STARTUP_DELAY_MS = 5000;
/** 周期检查间隔（毫秒）：每 4 小时静默检查一次（用户也可经 update:check 随时手动触发） */
const CHECK_INTERVAL_MS = 14_400_000;

/** electron-updater update-available / update-downloaded 事件载荷中本服务消费的字段 */
export interface UpdaterUpdateInfo {
  readonly version: string;
}

/** electron-updater download-progress 事件载荷中本服务消费的字段（百分数 0–100） */
export interface UpdaterProgressInfo {
  readonly percent: number;
}

/**
 * electron-updater 能力窄接口（DI 缝）：事件名与载荷形态对齐 electron-updater 实际契约，
 * 生产实现经 electronUpdaterAdapter 适配，测试以假体驱动。on 按事件名重载窄化签名，
 * 使服务侧事件处理获得精确的载荷类型（宽签名到窄签名的适配收敛在适配器一处）。
 */
export interface UpdaterLike {
  /** 是否自动下载：服务构造期强制置 false（下载须经用户确认） */
  autoDownload: boolean;
  /** 下载完成后是否退出时自动安装：服务构造期强制置 false（安装须经用户确认） */
  autoInstallOnAppQuit: boolean;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'checking-for-update', listener: () => void): void;
  on(event: 'update-available', listener: (info: UpdaterUpdateInfo) => void): void;
  on(event: 'update-not-available', listener: () => void): void;
  on(event: 'download-progress', listener: (progress: UpdaterProgressInfo) => void): void;
  on(event: 'update-downloaded', listener: (info: UpdaterUpdateInfo) => void): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

/** 更新服务对外能力（IPC 四通道与装配层 start/dispose 的消费面） */
export interface UpdateService {
  /** 当前状态（渲染层挂载期首拉 update:get-state 用） */
  getState(): UpdateState;
  /**
   * 立即检查更新：返回本次检查的终态（available / up-to-date / error）；能力关闭返回
   * 当前态且不发网络请求；checking 进行中重入返回当前态（防抖）。
   */
  check(): Promise<UpdateState>;
  /** 开始下载：仅 available 态有效（其余原样返回），同步返回 downloading 新态 */
  download(): UpdateState;
  /** 重启并安装：仅 downloaded 态执行 quitAndInstall，其余 no-op */
  install(): void;
  /** 排程定时检查：能力关闭不排任何定时器；装配层在窗口创建后调用一次 */
  start(): void;
  /** 释放定时器（成对释放、幂等）：装配层在 will-quit 调用 */
  dispose(): void;
}

/**
 * 创建更新状态机服务。
 * @param deps.currentVersion 当前应用版本号（app.getVersion()，无 v 前缀）
 * @param deps.capability 能力判定结果（装配期 resolveUpdateCapability 产出）
 * @param deps.updater electron-updater 适配（UpdaterLike）
 * @param deps.onState 状态推送供给（app 层装配为 update:state 遍历窗口广播）
 * @param deps.now 时钟供给（默认系统时刻；单测注入固定时刻驱动 checkedAt）
 * @param deps.startupDelayMs 启动首查延迟（默认 STARTUP_DELAY_MS）
 * @param deps.checkIntervalMs 周期检查间隔（默认 CHECK_INTERVAL_MS）
 */
export function createUpdateService(deps: {
  readonly currentVersion: string;
  readonly capability: UpdateCapability;
  readonly updater: UpdaterLike;
  readonly onState: (state: UpdateState) => void;
  readonly now?: () => Date;
  readonly startupDelayMs?: number;
  readonly checkIntervalMs?: number;
}): UpdateService {
  const { currentVersion, capability, updater, onState } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const startupDelayMs = deps.startupDelayMs ?? STARTUP_DELAY_MS;
  const checkIntervalMs = deps.checkIntervalMs ?? CHECK_INTERVAL_MS;

  // 初始态：能力开启从未检查（idle）；能力关闭按原因降级（unsupported），渲染层据此收敛入口
  let state: UpdateState = capability.enabled
    ? { kind: 'idle', currentVersion }
    : { kind: 'unsupported', currentVersion, reason: capability.reason };
  console.info(
    `[update] 更新服务初始化：${describe(state)}（能力 ${capability.enabled ? '开启' : `关闭（${capability.reason}）`}）`,
  );

  // available 发现的新版本号：download-progress 事件（载荷无版本号）转移时复用该记录；
  // 未发现即推进的异常序列下回退为当前版本号（占位语义，正常流不可达）
  let pendingVersion = currentVersion;

  // 定时器句柄（成对释放）；will-quit 与 start 前均可能为空，释放前判空
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * 本次 check 的 deferred 兑现标记：终端事件（update-* / error）先到则置位（以事件为准），
   * promise 结束仍未置位则按 up-to-date 兜底兑现（promise 兜底）——checkForUpdates() 的
   * resolve 与终端事件的到达顺序无契约保证，兜底保证 check() 必返回终态且状态机不滞留
   * checking。标记只在 check() 入口重置，事件侧重复置位被幂等语义吸收。
   */
  let checkSettled = true;

  /** 统一状态转移：变更前记 info（全局 §二 核心业务状态变更），推送后向渲染层广播 */
  function setState(next: UpdateState): void {
    console.info(`[update] 状态变更：${describe(state)} → ${describe(next)}`);
    state = next;
    onState(next);
  }

  /** 状态的单行业务描述（日志用，含版本号便于排查） */
  function describe(s: UpdateState): string {
    if (s.kind === 'downloading')
      return `downloading（新版本 ${s.version}，${s.percent}%，当前 ${s.currentVersion}）`;
    if (s.kind === 'available' || s.kind === 'downloaded')
      return `${s.kind}（新版本 ${s.version}，当前 ${s.currentVersion}）`;
    if (s.kind === 'up-to-date') return `up-to-date（检查于 ${s.checkedAt}）`;
    if (s.kind === 'error') return `error（${s.message}）`;
    if (s.kind === 'unsupported') return `unsupported（${s.reason}）`;
    return `${s.kind}（当前 ${s.currentVersion}）`;
  }

  /** 异常 → 面向状态机 message 字段的单行文案：剥换行防渲染层文案破碎，保留关键信息 */
  function messageOf(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  }

  /** download-progress 百分数收敛：四舍五入取整并钳制 0–100，非有限数按 0 处理 */
  function clampPercent(raw: number): number {
    if (!Number.isFinite(raw)) return 0;
    return Math.min(100, Math.max(0, Math.round(raw)));
  }

  /** 检查失败统一收口转 error 态：error 不阻断主功能，周期检查会自动重试 */
  function toErrorState(error: unknown): void {
    // error 事件先至（state 已是 error）再遇 promise reject 时跳过，避免同因重复广播
    if (state.kind === 'error') return;
    setState({ kind: 'error', currentVersion, message: messageOf(error) });
  }

  /** 失败即本次检查的结论：置位 deferred，防止被 up-to-date 兜底覆盖 error 终态 */
  function failCheck(error: unknown): void {
    toErrorState(error);
    checkSettled = true;
  }

  // —— 构造期一次性开关翻转与事件订阅（先关自动行为再订阅，杜绝窗口期自动下载）——
  // 自动下载/静默安装违反「下载与安装须经用户确认」的产品口径，此处是唯一关闭点
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on('checking-for-update', () => {
    // check() 入口已先行推送 checking（checkForUpdates() 内部通常再发一次同名事件）：
    // 已在 checking 则跳过，避免同态重复广播与重复日志
    if (state.kind === 'checking') return;
    setState({ kind: 'checking', currentVersion });
  });
  updater.on('update-available', (info) => {
    pendingVersion = info.version;
    setState({ kind: 'available', currentVersion, version: info.version });
    checkSettled = true;
  });
  updater.on('update-not-available', () => {
    setState({ kind: 'up-to-date', currentVersion, checkedAt: toLocalIsoTime(now()) });
    checkSettled = true;
  });
  updater.on('download-progress', (progress) => {
    setState({
      kind: 'downloading',
      currentVersion,
      version: pendingVersion,
      percent: clampPercent(progress.percent),
    });
  });
  updater.on('update-downloaded', (info) => {
    pendingVersion = info.version;
    setState({ kind: 'downloaded', currentVersion, version: info.version });
  });
  updater.on('error', (error) => {
    console.error('[update] 更新流程失败', error);
    setState({ kind: 'error', currentVersion, message: messageOf(error) });
    checkSettled = true;
  });

  /**
   * 立即检查更新。
   * @returns 本次检查的终态；能力关闭、检查已在途或下载进行中/已完成时返回当前态
   * （不发请求、不重入、不打回可用态）
   */
  async function check(): Promise<UpdateState> {
    // 能力关闭：直接返回当前态（unsupported），绝不发起网络请求
    if (!capability.enabled) return state;
    // 防重入：检查已在途，返回当前态（渲染层连点「检查更新」不产生并发请求）
    if (state.kind === 'checking') return state;
    // 下载进行中/已完成不检查：后台周期检查经 update-available 事件会把 downloading/
    // downloaded 合法地打回 available——用户下载完成后搁置，chip 从「重启以完成更新」
    // 无动作回退为「更新到 vX」且 install() 失效（正确性审查 Major 2，无用户动作的
    // 状态机回退）。重新检查以用户主动「检查更新」在 error/up-to-date 态触发即可
    if (state.kind === 'downloading' || state.kind === 'downloaded') return state;
    checkSettled = false;
    setState({ kind: 'checking', currentVersion });
    try {
      await updater.checkForUpdates();
    } catch (error: unknown) {
      console.error('[update] 检查更新失败', error);
      // 失败即结论：failCheck 同时置位 deferred，error 终态不被下方 up-to-date 兜底覆盖
      failCheck(error);
    }
    // 以事件为准、promise 兜底：终端事件已置位（checkSettled）则 state 即本次检查终态；
    // 未置位说明上游未发出任何结论事件（含 error），按 up-to-date 兜底——保证返回值必为
    // 终态、状态机不滞留 checking（推送的 up-to-date 即「视为已检查」语义）
    if (!checkSettled) {
      setState({ kind: 'up-to-date', currentVersion, checkedAt: toLocalIsoTime(now()) });
    }
    return state;
  }

  /** 开始下载已发现的新版本（仅 available 态有效，其余 no-op 原样返回） */
  function download(): UpdateState {
    // 仅 available 态可下载：防重复点击（非 available 重复触发）与非法态调用
    if (state.kind !== 'available') return state;
    pendingVersion = state.version;
    setState({ kind: 'downloading', currentVersion, version: state.version, percent: 0 });
    // 故意不 await：下载是长任务，进度经 download-progress 事件推送（契约：同步返回新态）；
    // catch 收口转 error 态，杜绝未处理的 promise rejection（异步纪律）
    void updater.downloadUpdate().catch((error: unknown) => {
      console.error('[update] 下载更新失败', error);
      toErrorState(error);
    });
    return state;
  }

  /** 重启并安装已下载的新版本（仅 downloaded 态执行，其余 no-op） */
  function install(): void {
    // 仅下载完成态执行：非 downloaded 态调用 quitAndInstall 要么抛错（无已下载包可装）
    // 要么无意义（下载中 / 未检查），统一 no-op 让渲染层按当前态收敛入口
    if (state.kind !== 'downloaded') return;
    console.info(`[update] 用户确认重启安装 ${state.version}（当前 ${currentVersion}）`);
    updater.quitAndInstall();
  }

  /** 排程定时检查（装配层窗口创建后调用一次；能力关闭不排任何定时器） */
  function start(): void {
    // 能力关闭不排任何定时器：dev / 受限形态不产生任何更新相关网络与计时行为
    if (!capability.enabled) return;
    startupTimer = setTimeout(() => {
      void check();
    }, startupDelayMs);
    intervalTimer = setInterval(() => {
      // check() 内部已收口全部异常，void 仅为显式声明「不等待、不外抛」
      void check();
    }, checkIntervalMs);
    console.info(
      `[update] 周期检查已排程：启动后 ${String(startupDelayMs)}ms 首查，此后每 ${String(checkIntervalMs)}ms 一次`,
    );
  }

  /** 释放定时器（成对释放且幂等：句柄为空时跳过，重复调用安全） */
  function dispose(): void {
    if (startupTimer !== undefined) {
      clearTimeout(startupTimer);
      startupTimer = undefined;
    }
    if (intervalTimer !== undefined) {
      clearInterval(intervalTimer);
      intervalTimer = undefined;
    }
  }

  return { getState: (): UpdateState => state, check, download, install, start, dispose };
}
