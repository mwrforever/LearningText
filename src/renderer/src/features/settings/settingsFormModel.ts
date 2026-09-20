/**
 * 设置表单钳制纯函数（M5 批次③ Task 8）：滑块/输入的原始值 → 契约域。三域均为整数闭
 * 区间（与 settings-contract zod 同域），先就近取整再钳制，保证写入值恒过 schema 校验；
 * 纯函数无 IO，供 SettingsPage 表单层即改即存前钳制与单元测试共用。
 */

/** 就近取整后按 [min, max] 闭区间钳制（整数化先于钳制，边界值必为整数） */
function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

/** 编辑器字号钳制：12–24 整数（appearance.editorFontSize 契约域） */
export function clampFontSize(v: number): number {
  return clampToRange(v, 12, 24);
}

/** 预览去抖钳制：100–2000 ms 整数（preview.debounceMs 契约域） */
export function clampDebounce(v: number): number {
  return clampToRange(v, 100, 2000);
}

/** 自动保存间隔钳制：1000–60000 ms 整数（editor.autoSaveMs 契约域） */
export function clampAutoSave(v: number): number {
  return clampToRange(v, 1000, 60000);
}
