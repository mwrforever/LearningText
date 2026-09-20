// 滚动保留纯函数（M5 批次③ Task 9）：文件名 lt-YYYYMMDD-HHMMSS.db 字典序 = 时间序，
// selectBackupsToPrune 返回超出保留份数的最旧名单；isAutoBackupDue 以「本地日期不同」判定到期。
import { describe, expect, it } from 'vitest';
import { isAutoBackupDue, selectBackupsToPrune } from '../../../src/main/backup/retention';

describe('selectBackupsToPrune 滚动保留名单', () => {
  it('份数未超保留上限（≤7）不剪任何文件', () => {
    const names = [
      'lt-20260915-080000.db',
      'lt-20260916-080000.db',
      'lt-20260917-080000.db',
      'lt-20260918-080000.db',
      'lt-20260919-080000.db',
      'lt-20260920-080000.db',
      'lt-20260921-080000.db',
    ];
    expect(selectBackupsToPrune(names, 7)).toEqual([]);
  });

  it('10 份超出保留 7 份：剪除最旧 3 份', () => {
    const names = [
      'lt-20260912-080000.db',
      'lt-20260913-080000.db',
      'lt-20260914-080000.db',
      'lt-20260915-080000.db',
      'lt-20260916-080000.db',
      'lt-20260917-080000.db',
      'lt-20260918-080000.db',
      'lt-20260919-080000.db',
      'lt-20260920-080000.db',
      'lt-20260921-080000.db',
    ];
    expect(selectBackupsToPrune(names, 7)).toEqual([
      'lt-20260912-080000.db',
      'lt-20260913-080000.db',
      'lt-20260914-080000.db',
    ]);
  });

  it('乱序输入按字典序即时间序排序：剪除名单恰为字典序最旧者（约定断言）', () => {
    const shuffled = [
      'lt-20260920-080000.db',
      'lt-20260912-080000.db',
      'lt-20260917-080000.db',
      'lt-20260913-080000.db',
      'lt-20260919-080000.db',
      'lt-20260914-080000.db',
      'lt-20260918-080000.db',
      'lt-20260915-080000.db',
      'lt-20260921-080000.db',
      'lt-20260916-080000.db',
    ];
    // 时间戳段在文件名中按年月日时分秒高位在前，字典序比较与时间先后一致
    expect(selectBackupsToPrune(shuffled, 7)).toEqual([
      'lt-20260912-080000.db',
      'lt-20260913-080000.db',
      'lt-20260914-080000.db',
    ]);
  });

  it('边界：keep=0 全部剪除；空输入恒返回空名单', () => {
    const names = ['lt-20260920-080000.db', 'lt-20260921-080000.db'];
    expect(selectBackupsToPrune(names, 0)).toEqual(names);
    expect(selectBackupsToPrune([], 7)).toEqual([]);
  });
});

describe('isAutoBackupDue 每日自动备份到期判定', () => {
  it('同日已有备份（日期相同）不到期', () => {
    expect(isAutoBackupDue('2026-09-21', '2026-09-21')).toBe(false);
  });

  it('跨日（最近备份日期早于今天）到期', () => {
    expect(isAutoBackupDue('2026-09-22', '2026-09-21')).toBe(true);
  });

  it('首次启动（无历史备份记录 null）即到期', () => {
    expect(isAutoBackupDue('2026-09-21', null)).toBe(true);
  });
});
