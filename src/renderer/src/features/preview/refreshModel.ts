/**
 * 预览刷新 rev 状态机（M3 spec §4.2 防撕裂，纯函数可单测）：
 * latest=已见广播最大 rev；loaded=发起重载时锁定的 rev；onload 比对追平。
 */
export interface RevState {
  readonly latest: number;
  readonly loaded: number;
}

export const initialRevState: RevState = { latest: 0, loaded: 0 };

/** 广播到达：只记版本不决策（是否重载由事件形态在组件侧判定） */
export function onBroadcast(s: RevState, rev: number): RevState {
  return rev > s.latest ? { ...s, latest: rev } : s;
}

/** 重载发起：锁定当前已见最新（此后到达的广播构成落后） */
export function onReloadStart(s: RevState): RevState {
  return { ...s, loaded: s.latest };
}

/** load 完成：落后即 catchUp（由调用侧重发 replace 并推进 loaded 至 latest） */
export function onLoadDone(s: RevState): { readonly state: RevState; readonly catchUp: boolean } {
  if (s.loaded < s.latest) return { state: onReloadStart(s), catchUp: true };
  return { state: s, catchUp: false };
}
