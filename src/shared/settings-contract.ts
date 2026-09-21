/**
 * 设置域 IPC 契约（宪法 A.7-5 单一来源，M4 spec §7 D4 / M5 批次③ / M6 v4）：
 * schemaVersion 4 在 v3 之上改型 shell.layout——三栏布局（树/编辑器/预览折叠与双比例）
 * 退役为单侧栏形态（侧栏折叠 + 单比例 + 活动视图记忆，M6 spec §2.7）；其余六域零改动。
 * 迁移例程为纯函数，由 settingsService 启动装载期执行（v3 读入 → shell.layout 改型 →
 * 原子回写；v2/v1 经既有链式迁移后续迁 v4）。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD。
 */
import { z } from 'zod';
// 纯常量落 zod-free 模块（M5 D28 主 chunk 裁剪）：schema/迁移例程在运行时消费版本号与布局默认，
// 经本文件聚合 re-export 维持域契约聚合出口（宪法 A.7-5 单一来源）
import { DEFAULT_LAYOUT_V3, SETTINGS_SCHEMA_VERSION } from './settings-constants';

export {
  DEFAULT_LAYOUT,
  DEFAULT_LAYOUT_V3,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
} from './settings-constants';

/**
 * 侧栏布局态（M6 spec §2.7）：侧栏折叠 + 宽度比例 + 活动视图记忆。
 * v3 的编辑器/预览折叠与预览比例随「单画布模型」退役（编辑区自适应占余，无折叠语义）。
 */
export const ShellLayoutSchema = z.strictObject({
  sidebarCollapsed: z.boolean(),
  sidebarWidthRatio: z.number().min(0.15).max(0.6),
  activityView: z.enum(['tree', 'search', 'trash']),
});
export type ShellLayout = z.infer<typeof ShellLayoutSchema>;

/** v3 遗留布局形态（迁移入口专用）：三栏折叠 + 树/预览宽度比例 */
export const ShellLayoutSchemaV3 = z.strictObject({
  treeCollapsed: z.boolean(),
  editorCollapsed: z.boolean(),
  previewCollapsed: z.boolean(),
  treeWidthRatio: z.number().min(0.15).max(0.6),
  previewWidthRatio: z.number().min(0.15).max(0.6),
});
export type ShellLayoutV3 = z.infer<typeof ShellLayoutSchemaV3>;

/** 外观域（M5 批次③）：UI 主题三态 + 源码编辑器字号（12–24 整数闭区间，M6 起仅作用 CM） */
export const AppearanceSchema = z.strictObject({
  theme: z.enum(['light', 'dark', 'system']),
  editorFontSize: z.number().int().min(12).max(24),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

/** 备份域（M5 批次③）：每日滚动备份开关（A.4-2 WAL NORMAL 持久性由备份补偿，默认开启） */
export const BackupSettingsSchema = z.strictObject({ autoEnabled: z.boolean() });
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

/** 最近打开条目（M5 批次③）：openedAt 为 ISO 8601 本地时区形态（shared/time.ts 既有格式） */
export const RecentEntrySchema = z.strictObject({
  nodeId: z.number().int(),
  virtualPath: z.string().min(1),
  name: z.string().min(1),
  openedAt: z.string().min(1),
});
export type RecentEntry = z.infer<typeof RecentEntrySchema>;

/** 最近打开域（M5 批次③）：最多保留 20 条 */
export const RecentSchema = z.strictObject({ opened: z.array(RecentEntrySchema).max(20) });
export type Recent = z.infer<typeof RecentSchema>;

/** 工作区会话域（M5 批次③）：打开标签集 + 激活标签（未开标签为 null）+ 启动恢复开关 */
export const WorkspaceSettingsSchema = z.strictObject({
  tabNodeIds: z.array(z.number().int()),
  activeTabNodeId: z.number().int().nullable(),
  restoreOnStart: z.boolean(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const SettingsSchema = z.strictObject({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  /** 预览域：编辑→写库去抖（FR-RENDER-03），M3 既有（M6 起语义为保存/刷新去抖，键名不变） */
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
  /** 编辑器域（M4）：自动保存最长相邻写间隔（FR-EDIT-02「默认 3s」的精确语义） */
  editor: z.strictObject({
    autoSaveMs: z.number().int().min(1000).max(60000),
  }),
  /** 外壳域（M6 v4 改型）：侧栏折叠/宽度/活动视图记忆（FR-SHELL-01 修订版） */
  shell: z.strictObject({ layout: ShellLayoutSchema }),
  /** 外观域（M5）：主题 + 源码编辑器字号 */
  appearance: AppearanceSchema,
  /** 备份域（M5）：每日滚动备份开关 */
  backup: BackupSettingsSchema,
  /** 最近打开域（M5）：最近打开文档条目（≤20 条） */
  recent: RecentSchema,
  /** 工作区会话域（M5）：标签集与启动恢复 */
  workspace: WorkspaceSettingsSchema,
});
export type SettingsData = z.infer<typeof SettingsSchema>;

/** v3 遗留 schema（迁移入口专用）：v3 全域形态（三栏布局 + 四新域），v4 校验失败时尝试 */
export const SettingsSchemaV3 = z.strictObject({
  schemaVersion: z.literal(3),
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
  editor: z.strictObject({
    autoSaveMs: z.number().int().min(1000).max(60000),
  }),
  shell: z.strictObject({ layout: ShellLayoutSchemaV3 }),
  appearance: AppearanceSchema,
  backup: BackupSettingsSchema,
  recent: RecentSchema,
  workspace: WorkspaceSettingsSchema,
});
export type SettingsDataV3 = z.infer<typeof SettingsSchemaV3>;

/** v2 遗留 schema（迁移入口专用；v2 校验失败不告警，交由 v1 尝试与迁移链） */
export const SettingsSchemaV2 = z.strictObject({
  schemaVersion: z.literal(2),
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
  editor: z.strictObject({
    autoSaveMs: z.number().int().min(1000).max(60000),
  }),
  shell: z.strictObject({ layout: ShellLayoutSchemaV3 }),
});
export type SettingsDataV2 = z.infer<typeof SettingsSchemaV2>;

/** v1 遗留 schema（迁移入口专用；装载链按 v4→v3→v2→v1 顺序尝试，v1 为末级入口，仍不中即 warn 回退默认值） */
export const SettingsSchemaV1 = z.strictObject({
  schemaVersion: z.literal(1),
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
});
export type SettingsDataV1 = z.infer<typeof SettingsSchemaV1>;

/** v1 → v2 迁移：preview 保留用户值，editor/shell 补出厂默认（M4 spec §7）；返回 v2 形态，由调用方沿迁移链续迁 */
export function migrateV1ToV2(legacy: SettingsDataV1): SettingsDataV2 {
  return {
    schemaVersion: 2,
    preview: legacy.preview,
    editor: { autoSaveMs: 3000 },
    shell: { layout: DEFAULT_LAYOUT_V3 },
  };
}

/** v2 → v3 迁移（M5 批次③）：preview/editor/shell 保留用户值，四新域补出厂默认——只补默认不改旧值，既有用户偏好零损失 */
export function migrateV2ToV3(legacy: SettingsDataV2): SettingsDataV3 {
  return {
    schemaVersion: 3,
    preview: legacy.preview,
    editor: legacy.editor,
    shell: legacy.shell,
    appearance: { theme: 'system', editorFontSize: 14 },
    backup: { autoEnabled: true },
    recent: { opened: [] },
    workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
  };
}

/**
 * v3 → v4 迁移（M6 spec §2.7）：六域用户值原样保留，shell.layout 改型为侧栏形态——
 * 树栏比例/折叠平移为侧栏比例/折叠（语义同源），活动视图回落资源树；
 * 编辑器/预览折叠与预览比例退役丢弃（单画布模型下无对象，M5 用户布局记忆不保此三项）。
 */
export function migrateV3ToV4(legacy: SettingsDataV3): SettingsData {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preview: legacy.preview,
    editor: legacy.editor,
    shell: {
      layout: {
        sidebarCollapsed: legacy.shell.layout.treeCollapsed,
        sidebarWidthRatio: legacy.shell.layout.treeWidthRatio,
        activityView: 'tree',
      },
    },
    appearance: legacy.appearance,
    backup: legacy.backup,
    recent: legacy.recent,
    workspace: legacy.workspace,
  };
}

/** settings:get 请求形态：无参通道沿 system:ping 先例传 null（preload 包装侧固定） */
export const SettingsGetRequestSchema = z.null();
