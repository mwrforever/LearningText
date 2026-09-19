// 设置契约边界（M4 spec §7 D4）：schemaVersion 2、debounceMs 100–2000、autoSaveMs 1000–60000、
// layout 比例 0.15–0.6、strict 多余字段拒；v1→v2 迁移补默认域
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
  SettingsSchemaV1,
  migrateV1ToV2,
} from '../../../src/shared/settings-contract';

describe('设置契约 schema（v2）', () => {
  it('默认值合法且版本号一致：autoSaveMs 默认 3000、布局默认全展开', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(DEFAULT_SETTINGS.editor.autoSaveMs).toBe(3000);
    expect(DEFAULT_SETTINGS.shell.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('autoSaveMs 闭区间与整数约束：999/60001/小数拒，1000/60000 收', () => {
    const ok = (ms: number) => ({
      schemaVersion: 2,
      preview: { debounceMs: 300 },
      editor: { autoSaveMs: ms },
      shell: { layout: DEFAULT_LAYOUT },
    });
    expect(SettingsSchema.safeParse(ok(1000)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(60000)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(999)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(60001)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(1500.5)).success).toBe(false);
  });

  it('layout 比例 0.15–0.6 越界拒；schemaVersion 非 2 / 缺域 / 多余字段一律拒', () => {
    const badLayout = {
      schemaVersion: 2,
      preview: { debounceMs: 300 },
      editor: { autoSaveMs: 3000 },
      shell: { layout: { ...DEFAULT_LAYOUT, treeWidthRatio: 0.7 } },
    };
    expect(SettingsSchema.safeParse(badLayout).success).toBe(false);
    expect(
      SettingsSchema.safeParse({ schemaVersion: 1, preview: { debounceMs: 300 } }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, editor: { autoSaveMs: 3000 }, extra: 1 })
        .success,
    ).toBe(false);
  });

  it('v1 遗留 schema 收 preview 域；migrateV1ToV2 补默认域并升版本', () => {
    const legacy = { schemaVersion: 1 as const, preview: { debounceMs: 500 } };
    expect(SettingsSchemaV1.safeParse(legacy).success).toBe(true);
    const migrated = migrateV1ToV2(legacy);
    expect(migrated).toEqual({
      schemaVersion: 2,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 3000 },
      shell: { layout: DEFAULT_LAYOUT },
    });
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });
});
