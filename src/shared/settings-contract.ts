/**
 * 设置域 IPC 契约（宪法 A.7-5 单一来源，spec §5 D4）：M3 仅承载预览去抖一键，
 * M5 完整设置页在 SettingsSchema 上扩域分组键；schemaVersion 为旧文件迁移闸。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD。
 */
import { z } from 'zod';

/** 设置 schema 版本号（spec §5）：文件首字段；不识别版本回退默认值（M5 引入迁移例程后升版本位） */
export const SETTINGS_SCHEMA_VERSION = 1;

export const SettingsSchema = z.strictObject({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  /** 预览域分组（后续 editor.* 与 app.* 各自成组，避免扁平键撞名） */
  preview: z.strictObject({
    /** 编辑→写库去抖毫秒（FR-RENDER-03）：100–2000 闭区间，默认 300（评审定调：过短在词中频繁触发） */
    debounceMs: z.number().int().min(100).max(2000),
  }),
});
export type SettingsData = z.infer<typeof SettingsSchema>;

/** settings:get 请求形态：无参通道沿 system:ping 先例传 null（preload 包装侧固定） */
export const SettingsGetRequestSchema = z.null();

/** 出厂默认设置（文件缺失/损坏/版本不识别时的回退值，spec §5） */
export const DEFAULT_SETTINGS: SettingsData = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  preview: { debounceMs: 300 },
};
