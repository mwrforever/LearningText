/**
 * 外壳命令契约（宪法 A.7-5 单一来源，M4 spec §5.2 D5）：主→渲染命令可辨识联合；
 * confirm-close 为 close 拦截后的渲染层确认链入口（spec §2.3）；
 * quick-open 为菜单「快速打开」下发（M5 批次① Task 6，浮层开关命令）；
 * global-search 为菜单「全局搜索」下发（M5 批次① Task 7，树栏 search 态切入命令）；
 * open-settings 为菜单「设置…」下发（M5 批次③ Task 8，全屏覆盖设置页开启命令）；
 * import 为菜单「导入…」下发（M5 批次⑥ Task 12，目录选择 → 策略确认 → io:import 链入口）；
 * import-html 为「导入 HTML 文件」下发（M7：树工具栏/菜单/Ctrl+N/欢迎页共用，文件选择 →
 * 导入确认浮层 → io:import 单文件链入口——空文件创建入口退役，导入即建）；
 * export 为菜单「导出…」下发（M5 批次⑥ Task 13，目录选择 → io:export → 完成动作链入口）；
 * paste-import 为「粘贴导入」下发（M9 批次 FR-IO-03：主进程读剪贴板文件清单直接导入当前
 * 落点；Ctrl/Cmd+V 由渲染层在资源树视图内作用域监听承载——原生菜单 accelerator 会全局
 * 劫持编辑器/画布内的粘贴语义，故菜单项不注册键位）。
 */
import { z } from 'zod';

export type ShellCommand =
  | { readonly type: 'import-html' }
  | { readonly type: 'new-dir' }
  | { readonly type: 'save' }
  | { readonly type: 'confirm-close' }
  | { readonly type: 'quick-open' }
  | { readonly type: 'global-search' }
  | { readonly type: 'open-settings' }
  | { readonly type: 'import' }
  | { readonly type: 'export' }
  | { readonly type: 'paste-import' };

/**
 * shell:open-path 请求：在系统文件管理器中打开目录（shell.openPath）。
 * dir 仅接受主进程 dialog 产出的目录串——ipc 层按「当次会话目录选择登记簿」校验，
 * 渲染层伪造/透传用户可控串直达 shell 的边界在此钉死（B.5-4 openExternal 白名单的
 * 同源纪律：openPath 非 openExternal 不涉 URL 白名单，但入参信任边界同样必须收敛）。
 */
export const OpenPathRequestSchema = z.strictObject({ dir: z.string().min(1) });
export type OpenPathRequest = z.infer<typeof OpenPathRequestSchema>;
