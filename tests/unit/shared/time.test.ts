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

  it('西半球偏移（getTimezoneOffset 为正）输出负偏移形态', () => {
    // 以 Date 子类覆写 getTimezoneOffset 模拟 UTC-5（西半球为正偏移输入），
    // 不依赖宿主机时区，保证三平台 CI 上符号分支均可覆盖
    class UtcMinusFive extends Date {
      override getTimezoneOffset(): number {
        return 300; // 西半球 getTimezoneOffset 为正，ISO 形态应为 -05:00
      }
    }
    const text = toLocalIsoTime(new UtcMinusFive(2026, 0, 15, 10, 30, 5, 0));
    expect(text.startsWith('2026-01-15T10:30:05.000')).toBe(true);
    expect(text.endsWith('-05:00')).toBe(true);
  });
});
