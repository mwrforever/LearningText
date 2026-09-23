/**
 * 应用内更新能力判定（2026-09-23 M9 批次，FR-UPDATE-01）：纯函数，装配期依据运行形态
 * 环境事实（是否打包 / 平台 / AppImage 挂载路径）求值一次，结果注入更新服务并经
 * update:get-state 通道透出。不满足条件的形态显式降级为 unsupported（渲染层据此给克制
 * 说明并隐藏更新入口），而非让更新流程在半途抛错——降级是「知情不可用」，不是静默失败。
 */
import type { UpdateCapability, UpdateCapabilityInput } from '../../shared/update-contract';

/**
 * 判定当前运行形态是否具备应用内更新能力。
 * @param input.isPackaged app.isPackaged：开发形态（electron . 直启）恒不可更新——
 *   无 app-update.yml（electron-builder 随包发布的更新检查元数据），electron-updater
 *   初始化即抛「app-update.yml 不存在」，必须前置拦截。
 * @param input.platform process.platform 原样；darwin 与 linux 有各自的形态限制分支。
 * @param input.appImagePath process.env.APPIMAGE：Electron 仅在以 AppImage 启动时注入，
 *   解包目录 / deb / rpm 形态为 undefined 或空串——这些形态没有可就地替换的单一文件目标。
 * @returns enabled=false 必带 reason（'dev' 开发形态 / 'platform' 平台形态受限）
 */
export function resolveUpdateCapability(input: UpdateCapabilityInput): UpdateCapability {
  const { isPackaged, platform, appImagePath } = input;
  // 开发形态：无 app-update.yml，更新检查必失败——dev 分支优先于平台判定
  if (!isPackaged) return { enabled: false, reason: 'dev' };
  // macOS：当前安装包未签名，Squirrel.Mac 替换阶段必须校验代码签名，未签名包替换必失败
  // ——签名链路落地前显式降级，禁止让用户走到「下载完成后安装崩溃」的半途失败
  if (platform === 'darwin') return { enabled: false, reason: 'platform' };
  // Linux 仅 AppImage 形态可就地替换（electron-updater 以 APPIMAGE 路径为替换目标）：
  // undefined 或空串都视为非 AppImage 形态
  if (platform === 'linux' && !appImagePath) return { enabled: false, reason: 'platform' };
  // 其余形态（win NSIS / linux AppImage）：electron-updater 官方支持的替换路径
  return { enabled: true };
}
