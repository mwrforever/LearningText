/**
 * 自绘标题栏常量（M6 spec §2.2 / 裁决 D12）：titleBarOverlay 不支持 CSS 变量，
 * 亮暗两套 overlay 颜色以字面值集中此处，与 theme.css 的 muted/foreground 语义 token
 * 取值保持一致——任一侧改动必须同步另一侧（注释即同步契约）。
 */

/** 标题栏高度（px）：overlay 控制钮区高度与渲染层 lt-titlebar 行高共用此值 */
export const TITLEBAR_HEIGHT = 40;

export interface TitleBarOverlayColors {
  readonly color: string;
  readonly symbolColor: string;
  readonly height: number;
}

/** 亮色 overlay：bg = muted（#f1f5f9）、前景 = foreground（#0f172a），同 theme.css light */
export const TITLEBAR_OVERLAY_LIGHT: TitleBarOverlayColors = {
  color: '#f1f5f9',
  symbolColor: '#0f172a',
  height: TITLEBAR_HEIGHT,
};

/** 暗色 overlay：bg = muted（#1e293b）、前景 = foreground（#f8fafc），同 theme.css dark */
export const TITLEBAR_OVERLAY_DARK: TitleBarOverlayColors = {
  color: '#1e293b',
  symbolColor: '#f8fafc',
  height: TITLEBAR_HEIGHT,
};

/** 按解析主题取 overlay 颜色（主进程窗口创建与主题切换联动共用） */
export function titleBarOverlayFor(resolved: 'light' | 'dark'): TitleBarOverlayColors {
  return resolved === 'dark' ? TITLEBAR_OVERLAY_DARK : TITLEBAR_OVERLAY_LIGHT;
}
