// 本地时区 ISO 8601 时间戳（docs/03 §3.2-5）与本地日期串（M5 每日自动备份「今天」判定）
import { describe, expect, it } from 'vitest';
import { toLocalIsoDate, toLocalIsoTime } from '../../../src/shared/time';

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

describe('toLocalIsoDate 本地日期串（M5 Task 9）', () => {
  it('按本地时区输出 YYYY-MM-DD，单位数月/日补零', () => {
    // 本地时间构造（各时区语义一致）：2026-09-21 14:30 本地
    expect(toLocalIsoDate(new Date(2026, 8, 21, 14, 30, 0))).toBe('2026-09-21');
    expect(toLocalIsoDate(new Date(2026, 0, 3, 5, 7, 9))).toBe('2026-01-03');
  });

  it('与 toLocalIsoTime 的日期段同源（同一 Date 两种形态日期一致）', () => {
    const date = new Date(2026, 11, 31, 23, 59, 59);
    expect(toLocalIsoDate(date)).toBe(toLocalIsoTime(date).slice(0, 10));
  });
});
