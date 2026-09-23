/**
 * 应用内更新域 IPC 契约（2026-09-23 M9 批次，FR-UPDATE-01；宪法 A.7-5 单一来源）：
 * 通道名常量见 shared/ipc.ts，本文件持有请求 schema 与状态联合（UpdateState）的唯一定义。
 * 四个通道（get-state / check / download / install）全部无参（null 载荷先例同 settings:get）；
 * 状态经 update:state 广播推送（状态机归属主进程服务，渲染层只呈现）。
 */
import { z } from 'zod';

/**
 * 应用内更新能力判定输入（纯数据，主进程装配期求值后传入纯函数 resolveUpdateCapability）：
 * 不满足条件的形态必须显式降级为 unsupported 状态而非静默失败——开发形态（未打包）无
 * app-update.yml、macOS 未签名无法完成 Squirrel 替换、Linux 非 AppImage 形态无法就地替换。
 */
export interface UpdateCapabilityInput {
  /** 是否打包形态启动（app.isPackaged；开发形态恒不可更新） */
  readonly isPackaged: boolean;
  /** 运行平台（process.platform 原样） */
  readonly platform: string;
  /**
   * Linux AppImage 运行形态的镜像挂载路径（process.env.APPIMAGE）：
   * Electron 仅在以 AppImage 启动时注入该环境变量，解包目录形态下为 undefined
   */
  readonly appImagePath: string | undefined;
}

/** 不支持应用内更新的原因：dev=开发形态；platform=平台形态受限（未签名 macOS / 非 AppImage 的 Linux） */
export type UpdateUnsupportedReason = 'dev' | 'platform';

/** 能力判定结果（可辨识联合，A.1-4）：enabled=false 必带原因，渲染层据此给克制说明 */
export type UpdateCapability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: UpdateUnsupportedReason };

/**
 * 更新状态（主进程 → 渲染层的唯一状态形态，可辨识联合按 kind 判别，A.1-4）：
 * idle 未检查 / checking 检查中 / up-to-date 已是最新 / available 有新版本待用户确认 /
 * downloading 下载中（percent 0–100 取整）/ downloaded 已下载待重启安装 /
 * error 检查或下载失败（不阻断主功能，周期检查会自动重试）/ unsupported 本形态不支持。
 * currentVersion 为当前应用版本号（无 v 前缀，package.json 形态），供设置页与标签文案直接用。
 */
export type UpdateState =
  | { readonly kind: 'idle'; readonly currentVersion: string }
  | { readonly kind: 'checking'; readonly currentVersion: string }
  | { readonly kind: 'up-to-date'; readonly currentVersion: string; readonly checkedAt: string }
  | { readonly kind: 'available'; readonly currentVersion: string; readonly version: string }
  | {
      readonly kind: 'downloading';
      readonly currentVersion: string;
      readonly version: string;
      readonly percent: number;
    }
  | { readonly kind: 'downloaded'; readonly currentVersion: string; readonly version: string }
  | { readonly kind: 'error'; readonly currentVersion: string; readonly message: string }
  | {
      readonly kind: 'unsupported';
      readonly currentVersion: string;
      readonly reason: UpdateUnsupportedReason;
    };

/**
 * 无参通道载荷 schema（get-state / check / download / install 四通道共用）：
 * 固定 null 照 settings:get 先例；校验失败统一映射 E_IPC_BAD_PAYLOAD（A.7-5）。
 */
export const UpdateRequestSchema = z.null();
export type UpdateRequest = null;
