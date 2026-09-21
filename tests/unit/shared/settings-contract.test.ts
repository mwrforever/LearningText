// 设置契约边界（M4 spec §7 D4 / M5 批次③ / M6 spec §2.7）：schemaVersion 4 在 v3 之上
// 改型 shell.layout——三栏布局退役为单侧栏形态（sidebarCollapsed/sidebarWidthRatio/activityView），
// 其余六域零改动；debounceMs 100–2000、autoSaveMs 1000–60000、比例 0.15–0.6、字号 12–24、
// recent 上限 20 条、strict 多余字段拒；v1→v2、v2→v3 迁移只补默认域，v3→v4 平移侧栏语义
import { describe, expect, it } from 'vitest';
import {
  AppearanceSchema,
  DEFAULT_LAYOUT,
  DEFAULT_LAYOUT_V3,
  DEFAULT_SETTINGS,
  RecentSchema,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
  SettingsSchemaV1,
  SettingsSchemaV3,
  WorkspaceSettingsSchema,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  type SettingsDataV3,
} from '../../../src/shared/settings-contract';

describe('设置契约 schema（v4）', () => {
  it('默认值合法且版本号一致：autoSaveMs 默认 3000、侧栏布局默认展开 1/4 树视图、四新域出厂默认', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(4);
    expect(SettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(DEFAULT_SETTINGS.editor.autoSaveMs).toBe(3000);
    expect(DEFAULT_SETTINGS.shell.layout).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT).toEqual({
      sidebarCollapsed: false,
      sidebarWidthRatio: 0.25,
      activityView: 'tree',
    });
    expect(DEFAULT_SETTINGS.appearance).toEqual({ theme: 'system', editorFontSize: 14 });
    expect(DEFAULT_SETTINGS.backup).toEqual({ autoEnabled: true });
    expect(DEFAULT_SETTINGS.recent).toEqual({ opened: [] });
    expect(DEFAULT_SETTINGS.workspace).toEqual({
      tabNodeIds: [],
      activeTabNodeId: null,
      restoreOnStart: true,
    });
  });

  it('autoSaveMs 闭区间与整数约束：999/60001/小数拒，1000/60000 收', () => {
    const ok = (ms: number) => ({
      schemaVersion: 4,
      preview: { debounceMs: 300 },
      editor: { autoSaveMs: ms },
      shell: { layout: DEFAULT_LAYOUT },
      appearance: { theme: 'system', editorFontSize: 14 },
      backup: { autoEnabled: true },
      recent: { opened: [] },
      workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
    });
    expect(SettingsSchema.safeParse(ok(1000)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(60000)).success).toBe(true);
    expect(SettingsSchema.safeParse(ok(999)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(60001)).success).toBe(false);
    expect(SettingsSchema.safeParse(ok(1500.5)).success).toBe(false);
  });

  it('侧栏比例 0.15–0.6 越界拒、activityView 非法枚举拒；schemaVersion 非 4 / 缺域 / 多余字段一律拒', () => {
    const base = {
      schemaVersion: 4,
      preview: { debounceMs: 300 },
      editor: { autoSaveMs: 3000 },
      shell: { layout: DEFAULT_LAYOUT },
      appearance: { theme: 'system', editorFontSize: 14 },
      backup: { autoEnabled: true },
      recent: { opened: [] },
      workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
    };
    expect(
      SettingsSchema.safeParse({
        ...base,
        shell: { layout: { ...DEFAULT_LAYOUT, sidebarWidthRatio: 0.7 } },
      }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({
        ...base,
        shell: { layout: { ...DEFAULT_LAYOUT, activityView: 'editor' } },
      }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({ schemaVersion: 1, preview: { debounceMs: 300 } }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({ ...base, editor: { autoSaveMs: 3000 }, extra: 1 }).success,
    ).toBe(false);
  });

  it('v2/v3 遗留文件形态直读在 v4 schema 下拒（须走迁移链）', () => {
    expect(
      SettingsSchema.safeParse({
        schemaVersion: 2,
        preview: { debounceMs: 300 },
        editor: { autoSaveMs: 3000 },
        shell: { layout: DEFAULT_LAYOUT_V3 },
      }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({
        schemaVersion: 3,
        preview: { debounceMs: 300 },
        editor: { autoSaveMs: 3000 },
        shell: { layout: DEFAULT_LAYOUT_V3 },
        appearance: { theme: 'system', editorFontSize: 14 },
        backup: { autoEnabled: true },
        recent: { opened: [] },
        workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
      }).success,
    ).toBe(false);
  });

  it('appearance：theme 三枚举值收、其余值拒；editorFontSize 12/24 收、11/25 拒', () => {
    expect(AppearanceSchema.safeParse({ theme: 'light', editorFontSize: 14 }).success).toBe(true);
    expect(AppearanceSchema.safeParse({ theme: 'dark', editorFontSize: 14 }).success).toBe(true);
    expect(AppearanceSchema.safeParse({ theme: 'system', editorFontSize: 14 }).success).toBe(true);
    expect(AppearanceSchema.safeParse({ theme: 'auto', editorFontSize: 14 }).success).toBe(false);
    expect(AppearanceSchema.safeParse({ theme: 'light', editorFontSize: 12 }).success).toBe(true);
    expect(AppearanceSchema.safeParse({ theme: 'light', editorFontSize: 24 }).success).toBe(true);
    expect(AppearanceSchema.safeParse({ theme: 'light', editorFontSize: 11 }).success).toBe(false);
    expect(AppearanceSchema.safeParse({ theme: 'light', editorFontSize: 25 }).success).toBe(false);
  });

  it('recent.opened 上限 20：20 条收、21 条拒、条目缺字段拒', () => {
    // 条目形态即 shared/time.ts ISO 本地时区戳的承载面：openedAt 非空字符串即可（格式由写入方保证）
    const entry = (nodeId: number) => ({
      nodeId,
      virtualPath: `/目录${nodeId}/a.html`,
      name: 'a.html',
      openedAt: '2026-09-21T10:00:00.000+08:00',
    });
    const opened = (count: number) => Array.from({ length: count }, (_, i) => entry(i + 1));
    expect(RecentSchema.safeParse({ opened: opened(20) }).success).toBe(true);
    expect(RecentSchema.safeParse({ opened: opened(21) }).success).toBe(false);
    expect(RecentSchema.safeParse({ opened: [{ ...entry(1), openedAt: undefined }] }).success).toBe(
      false,
    );
  });

  it('workspace：activeTabNodeId null 收（未开标签态）、数字收', () => {
    expect(
      WorkspaceSettingsSchema.safeParse({
        tabNodeIds: [1, 2],
        activeTabNodeId: null,
        restoreOnStart: true,
      }).success,
    ).toBe(true);
    expect(
      WorkspaceSettingsSchema.safeParse({
        tabNodeIds: [],
        activeTabNodeId: 3,
        restoreOnStart: false,
      }).success,
    ).toBe(true);
  });

  it('migrateV2ToV3：preview/editor/shell 用户值保留，四新域补出厂默认，产物过 v3 校验（v4 仍拒）', () => {
    const legacy = {
      schemaVersion: 2 as const,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: { layout: { ...DEFAULT_LAYOUT_V3, treeCollapsed: true } },
    };
    const migrated = migrateV2ToV3(legacy);
    expect(migrated).toEqual({
      schemaVersion: 3,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: { layout: { ...DEFAULT_LAYOUT_V3, treeCollapsed: true } },
      appearance: { theme: 'system', editorFontSize: 14 },
      backup: { autoEnabled: true },
      recent: { opened: [] },
      workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
    });
    expect(SettingsSchemaV3.safeParse(migrated).success).toBe(true);
    // v3 中间形态在 v4 schema 下直读拒，须经 migrateV3ToV4 续迁（装载链两级组合）
    expect(SettingsSchema.safeParse(migrated).success).toBe(false);
  });

  it('v1 遗留 schema 收 preview 域；migrateV1ToV2 补 editor/shell 默认域并升 v2（中间形态）', () => {
    const legacy = { schemaVersion: 1 as const, preview: { debounceMs: 500 } };
    expect(SettingsSchemaV1.safeParse(legacy).success).toBe(true);
    const migrated = migrateV1ToV2(legacy);
    expect(migrated).toEqual({
      schemaVersion: 2,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 3000 },
      shell: { layout: DEFAULT_LAYOUT_V3 },
    });
    // v2 中间形态在 v4 schema 下直读拒，须经 v2→v3→v4 续迁（装载链三级组合）
    expect(SettingsSchema.safeParse(migrated).success).toBe(false);
  });

  it('migrateV3ToV4：六域用户值原样保留，treeCollapsed/treeWidthRatio 平移侧栏字段，活动视图回落资源树', () => {
    const legacy: SettingsDataV3 = {
      schemaVersion: 3,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: {
        layout: {
          treeCollapsed: true,
          editorCollapsed: true,
          previewCollapsed: false,
          treeWidthRatio: 0.3,
          previewWidthRatio: 0.5,
        },
      },
      appearance: { theme: 'dark', editorFontSize: 16 },
      backup: { autoEnabled: false },
      recent: {
        opened: [
          {
            nodeId: 7,
            virtualPath: '/a.html',
            name: 'a.html',
            openedAt: '2026-09-21T10:00:00+08:00',
          },
        ],
      },
      workspace: { tabNodeIds: [7], activeTabNodeId: 7, restoreOnStart: false },
    };
    const migrated = migrateV3ToV4(legacy);
    expect(migrated).toEqual({
      schemaVersion: 4,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: {
        layout: { sidebarCollapsed: true, sidebarWidthRatio: 0.3, activityView: 'tree' },
      },
      appearance: { theme: 'dark', editorFontSize: 16 },
      backup: { autoEnabled: false },
      recent: legacy.recent,
      workspace: legacy.workspace,
    });
    // 迁移产物过 v4 校验（装载链终点可达直读形态）
    expect(SettingsSchema.safeParse(migrated).success).toBe(true);
  });

  it('migrateV3ToV4：编辑器/预览折叠与预览比例随单画布模型退役丢弃（不进 v4 形态）', () => {
    const legacy: SettingsDataV3 = {
      schemaVersion: 3,
      preview: { debounceMs: 300 },
      editor: { autoSaveMs: 3000 },
      shell: {
        layout: {
          treeCollapsed: false,
          editorCollapsed: true,
          previewCollapsed: true,
          treeWidthRatio: 0.25,
          previewWidthRatio: 0.6,
        },
      },
      appearance: { theme: 'system', editorFontSize: 14 },
      backup: { autoEnabled: true },
      recent: { opened: [] },
      workspace: { tabNodeIds: [], activeTabNodeId: null, restoreOnStart: true },
    };
    const migrated = migrateV3ToV4(legacy);
    expect(migrated.shell.layout).toEqual({
      sidebarCollapsed: false,
      sidebarWidthRatio: 0.25,
      activityView: 'tree',
    });
    expect(JSON.stringify(migrated.shell)).not.toContain('editorCollapsed');
    expect(JSON.stringify(migrated.shell)).not.toContain('previewCollapsed');
    expect(JSON.stringify(migrated.shell)).not.toContain('previewWidthRatio');
  });
});
