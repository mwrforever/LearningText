/**
 * 主题解析器（M5 批次③ Task 8，spec §4.3 D10 纯函数层）：用户意图三态 → 实际主题二值。
 * settings 只持久化意图（不存解析结果）；system 态由装配层（Workspace 主题 effect）以
 * matchMedia('(prefers-color-scheme: dark)') 实时查询后传入，解析结果驱动 documentElement
 * 的 .dark 类切换与 CodeMirror one-dark 语法主题联动。
 */

/** 用户主题意图：light/dark 为显式选择，system 跟随系统偏好（appearance.theme 契约同域） */
export type ThemeIntent = 'light' | 'dark' | 'system';

/**
 * 解析实际主题（纯函数，无 IO/无 DOM 副作用）。
 * @param intent 用户意图（settings appearance.theme 持久化值）
 * @param systemPrefersDark 装配层实时查询的系统暗色偏好（仅 system 态消费）
 * @returns 实际主题：显式意图直返，system 按系统偏好映射
 */
export function resolveTheme(intent: ThemeIntent, systemPrefersDark: boolean): 'light' | 'dark' {
  if (intent === 'system') return systemPrefersDark ? 'dark' : 'light';
  return intent;
}
