/**
 * 外壳命令契约（宪法 A.7-5 单一来源，M4 spec §5.2 D5）：主→渲染命令可辨识联合；
 * confirm-close 为 close 拦截后的渲染层确认链入口（spec §2.3）；
 * quick-open 为菜单「快速打开」下发（M5 批次① Task 6，浮层开关命令）；
 * global-search 为菜单「全局搜索」下发（M5 批次① Task 7，树栏 search 态切入命令）；
 * open-settings 为菜单「设置…」下发（M5 批次③ Task 8，全屏覆盖设置页开启命令）。
 */
export type ShellCommand =
  | { readonly type: 'new-file' }
  | { readonly type: 'new-dir' }
  | { readonly type: 'save' }
  | { readonly type: 'confirm-close' }
  | { readonly type: 'quick-open' }
  | { readonly type: 'global-search' }
  | { readonly type: 'open-settings' };
