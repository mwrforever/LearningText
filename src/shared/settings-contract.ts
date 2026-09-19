/**
 * 设置域 IPC 契约（宪法 A.7-5 单一来源，M4 spec §7 D4）：schemaVersion 2 在 v1（M3 仅
 * preview.debounceMs）之上 additive 扩展 editor.autoSaveMs 与 shell.layout；迁移例程在
 * settingsService 启动装载期执行（v1 读入 → 补默认域 → 原子回写）。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD。
 */
import { z } from 'zod';

/** 设置 schema 版本号：v1（M3）→ v2（M4 additive）；不识别版本回退默认值 */
export const SETTINGS_SCHEMA_VERSION = 2;

/** 三栏布局态（M4 spec §5.1）：折叠三态 + 树/预览宽度比例（编辑器自适应占余） */
export const ShellLayoutSchema = z.strictObject({
  treeCollapsed: z.boolean(),
  editorCollapsed: z.boolean(),
  previewCollapsed: z.boolean(),
  treeWidthRatio: z.number().min(0.15).max(0.6),
  previewWidthRatio: z.number().min(0.15).max(0.6),
});
export type ShellLayout = z.infer<typeof ShellLayoutSchema>;

/** 布局出厂默认：全展开，树 1/4、预览 0.4（编辑器自适应） */
export const DEFAULT_LAYOUT: ShellLayout = {
  treeCollapsed: false,
  editorCollapsed: false,
  previewCollapsed: false,
  treeWidthRatio: 0.25,
  previewWidthRatio: 0.4,
};

export const SettingsSchema = z.strictObject({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  /** 预览域：编辑→写库去抖（FR-RENDER-03），M3 既有 */
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
  /** 编辑器域（M4）：自动保存最长相邻写间隔（FR-EDIT-02「默认 3s」的精确语义） */
  editor: z.strictObject({
    autoSaveMs: z.number().int().min(1000).max(60000),
  }),
  /** 外壳域（M4）：三栏折叠与宽度记忆（FR-SHELL-01） */
  shell: z.strictObject({ layout: ShellLayoutSchema }),
});
export type SettingsData = z.infer<typeof SettingsSchema>;

/** v1 遗留 schema（迁移入口专用；v1 校验失败不告警，交由 v2 尝试与迁移链） */
export const SettingsSchemaV1 = z.strictObject({
  schemaVersion: z.literal(1),
  preview: z.strictObject({
    debounceMs: z.number().int().min(100).max(2000),
  }),
});
export type SettingsDataV1 = z.infer<typeof SettingsSchemaV1>;

/** v1 → v2 迁移：preview 保留用户值，editor/shell 补出厂默认（M4 spec §7） */
export function migrateV1ToV2(legacy: SettingsDataV1): SettingsData {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preview: legacy.preview,
    editor: { autoSaveMs: 3000 },
    shell: { layout: DEFAULT_LAYOUT },
  };
}

/** settings:get 请求形态：无参通道沿 system:ping 先例传 null（preload 包装侧固定） */
export const SettingsGetRequestSchema = z.null();

/** 出厂默认设置（文件缺失/损坏/版本不识别时的回退值） */
export const DEFAULT_SETTINGS: SettingsData = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  preview: { debounceMs: 300 },
  editor: { autoSaveMs: 3000 },
  shell: { layout: DEFAULT_LAYOUT },
};
