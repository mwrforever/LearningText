// 主题解析器（M5 批次③ Task 8）：三态意图 → 实际主题的全分支纯函数断言。
// light/dark 为显式意图直返（不感知系统偏好）；system 经 systemPrefersDark 入参解析。
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../../src/renderer/src/features/settings/themeResolver';

describe('resolveTheme 主题解析（纯函数）', () => {
  it('light 意图直返 light，不受系统偏好影响', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('dark 意图直返 dark，不受系统偏好影响', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('system 意图跟随系统：系统暗色解析为 dark、系统亮色解析为 light', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
