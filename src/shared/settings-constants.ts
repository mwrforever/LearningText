/**
 * 设置域纯常量（宪法 A.7-5 单一来源）：无 zod 依赖的独立模块。
 * 拆分原因（M5 D28 主 chunk 裁剪）：渲染层工作台仅消费布局出厂默认——常量与 zod schema
 * 同文件会把 zod 运行时整链拖入渲染端 bundle；渲染端零 schema 运行时（契约校验归主进程
 * handler，A.7）。类型仅经 `import type` 引用（编译期擦除，不构成运行时环）。
 */
import type { SettingsData, ShellLayout, ShellLayoutV3 } from './settings-contract';

/** 设置 schema 版本号：v1（M3）→ v2（M4 additive）→ v3（M5 additive 四域）→ v4（M6 shell.layout 改型侧栏形态）；不识别版本回退默认值 */
export const SETTINGS_SCHEMA_VERSION = 4;

/** 侧栏布局出厂默认（M6 spec §2.7）：侧栏展开 1/4 宽，活动视图 = 资源树 */
export const DEFAULT_LAYOUT: ShellLayout = {
  sidebarCollapsed: false,
  sidebarWidthRatio: 0.25,
  activityView: 'tree',
};

/** v3 遗留布局出厂默认（迁移链 v1→v2 专用）：三栏全展开，树 1/4、预览 0.4 */
export const DEFAULT_LAYOUT_V3: ShellLayoutV3 = {
  treeCollapsed: false,
  editorCollapsed: false,
  previewCollapsed: false,
  treeWidthRatio: 0.25,
  previewWidthRatio: 0.4,
};

/** 出厂默认设置（文件缺失/损坏/版本不识别时的回退值） */
export const DEFAULT_SETTINGS: SettingsData = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  preview: { debounceMs: 300 },
  editor: { autoSaveMs: 3000 },
  shell: { layout: DEFAULT_LAYOUT },
  appearance: { theme: 'system', editorFontSize: 14 },
  backup: { autoEnabled: true },
  recent: { opened: [] },
  workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
};
