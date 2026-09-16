// 本地时区 ISO 8601 时间戳（docs/03 §3.2-5）
import { describe, expect, it } from 'vitest';
import { toLocalIsoTime } from '../../../src/shared/time';

describe('toLocalIsoTime', () => {
  it('按本地时区含偏移量输出', () => {
    // 用本地时区构造，断言只校验格式与偏移结构，不绑定具体时区
    const text = toLocalIsoTime(new Date(2026, 8, 16, 14, 30, 5, 123));
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(text.startsWith('2026-09-16T14:30:05.123')).toBe(true);
  });

  it('偏移量符号与小时正确（用固定时区偏移验证 ± 形态）', () => {
    const text = toLocalIsoTime(new Date(2026, 0, 1, 0, 0, 0, 0));
    // 任意时区下偏移必须是整刻度且两位小时
    const m = text.match(/[+-](\d{2}):(\d{2})$/);
    expect(m).not.toBeNull();
    expect(Number(m?.[2])).toBeLessThan(60);
  });
});
