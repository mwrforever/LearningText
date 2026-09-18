// 设置契约边界（spec §5 D4）：schemaVersion 字面量 1、debounceMs 闭区间 100–2000、strict 多余字段拒
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
} from '../../../src/shared/settings-contract';

describe('设置契约 schema', () => {
  it('默认值合法且版本号一致', () => {
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SETTINGS.preview.debounceMs).toBe(300); // 评审定调：100ms 词中频繁触发
  });

  it('debounceMs 闭区间与整数约束：99/2001/小数拒，100/2000 收', () => {
    const ok = (ms: number) => ({ schemaVersion: 1, preview: { debounceMs: ms } });
    expect(SettingsSchema.safeParse(ok(100)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(2000)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(99)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(2001)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(100.5)).success).toBe(false);
  });

  it('schemaVersion 非 1 / 缺 preview / 多余字段一律拒（M5 迁移前的版本闸）', () => {
    expect(
      SettingsSchema.safeParse({ schemaVersion: 2, preview: { debounceMs: 300 } }).success,
    ).toBe(false);
    expect(SettingsSchema.safeParse({ schemaVersion: 1 }).success).toBe(false);
    expect(
      SettingsSchema.safeParse({ schemaVersion: 1, preview: { debounceMs: 300, extra: 1 } })
        .success,
    ).toBe(false);
  });
});
