// 设置表单钳制纯函数（M5 批次③ Task 8）：字号/去抖/自动保存三域的边界与越界行为。
// 三域均为整数闭区间（settings-contract zod 同域）：先整数化再钳制，保证写入值恒过 schema。
import { describe, expect, it } from 'vitest';
import {
  clampAutoSave,
  clampDebounce,
  clampFontSize,
} from '../../../src/renderer/src/features/settings/settingsFormModel';

describe('settingsFormModel 表单值钳制（纯函数）', () => {
  it('clampFontSize 12–24：界内保持、越界钳到边界、小数就近取整', () => {
    expect(clampFontSize(12)).toBe(12);
    expect(clampFontSize(24)).toBe(24);
    expect(clampFontSize(18)).toBe(18);
    expect(clampFontSize(11)).toBe(12);
    expect(clampFontSize(30)).toBe(24);
    expect(clampFontSize(13.6)).toBe(14);
    expect(clampFontSize(13.4)).toBe(13);
  });

  it('clampDebounce 100–2000：界内保持、越界钳到边界、小数就近取整', () => {
    expect(clampDebounce(100)).toBe(100);
    expect(clampDebounce(2000)).toBe(2000);
    expect(clampDebounce(300)).toBe(300);
    expect(clampDebounce(50)).toBe(100);
    expect(clampDebounce(5000)).toBe(2000);
    expect(clampDebounce(299.6)).toBe(300);
  });

  it('clampAutoSave 1000–60000：界内保持、越界钳到边界、小数就近取整', () => {
    expect(clampAutoSave(1000)).toBe(1000);
    expect(clampAutoSave(60000)).toBe(60000);
    expect(clampAutoSave(3000)).toBe(3000);
    expect(clampAutoSave(999)).toBe(1000);
    expect(clampAutoSave(120000)).toBe(60000);
    expect(clampAutoSave(2999.4)).toBe(2999);
  });
});
