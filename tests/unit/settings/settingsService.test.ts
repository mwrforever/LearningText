// 设置服务（M3 spec §5 / M4 spec §7 / M5 批次③ / M6 v4）：启动读缓存（v4 直读 →
// v3/v2/v1 三级链式迁移至 4）、损坏/版本不识别 warn 回退默认、set 原子写、get 恒不抛
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsService } from '../../../src/main/settings/settingsService';
import {
  DEFAULT_LAYOUT_V3,
  DEFAULT_SETTINGS,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  type SettingsDataV2,
  type SettingsDataV3,
} from '../../../src/shared/settings-contract';

let dir: string;
let file: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lt-settings-'));
  file = path.join(dir, 'settings.json');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe('settingsService', () => {
  it('文件缺失回退默认值且不告警（首启正常态）', () => {
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('损坏 JSON warn 后回退默认（不阻断启动）', async () => {
    writeFileSync(file, '{ 损坏', 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('schemaVersion 不识别（v5，超前版本）warn 回退默认', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 5, preview: { debounceMs: 100 } }), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('合法文件加载进缓存；set 更新缓存并落盘', () => {
    writeFileSync(
      file,
      JSON.stringify({ ...DEFAULT_SETTINGS, preview: { debounceMs: 500 } }),
      'utf8',
    );
    const s = createSettingsService({ settingsFile: file });
    expect(s.get().preview.debounceMs).toBe(500);
    const next = { ...DEFAULT_SETTINGS, preview: { debounceMs: 1500 } };
    expect(s.set(next)).toEqual(next);
    expect(s.get()).toEqual(next);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(next);
  });

  it('set 日志按实际写入域摘要（TASK.md 闭环）：单域报该域、多域并列、无变更不误报', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const s = createSettingsService({ settingsFile: file });
      // 单域写：仅报实际变化的域，不再硬编码 preview.debounceMs=…（与写入域无关的误导文案）
      s.set({ ...DEFAULT_SETTINGS, preview: { debounceMs: 900 } });
      expect(infoSpy).toHaveBeenLastCalledWith('[settings] 已更新设置域：preview');
      // 多域写：相对当前缓存同时变化的域逐域并列
      s.set({ ...DEFAULT_SETTINGS, preview: { debounceMs: 800 }, editor: { autoSaveMs: 1000 } });
      expect(infoSpy).toHaveBeenLastCalledWith('[settings] 已更新设置域：preview、editor');
      // 等值全量写：无域变更时不产出误导性的「已更新」域清单
      s.set({ ...DEFAULT_SETTINGS, preview: { debounceMs: 800 }, editor: { autoSaveMs: 1000 } });
      expect(infoSpy).toHaveBeenLastCalledWith('[settings] 已更新设置（无域变更）');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('v3 文件启动迁移至 v4：shell.layout 改型侧栏形态 + 六域用户值保留 + 原子回写 + info 一次', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const v3File: SettingsDataV3 = {
      schemaVersion: 3,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: { layout: { ...DEFAULT_LAYOUT_V3, treeCollapsed: true, treeWidthRatio: 0.3 } },
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
    writeFileSync(file, JSON.stringify(v3File), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(migrateV3ToV4(v3File));
    // 平移语义抽查：树栏折叠/宽度平移为侧栏字段，活动视图回落资源树
    expect(s.get().shell.layout).toEqual({
      sidebarCollapsed: true,
      sidebarWidthRatio: 0.3,
      activityView: 'tree',
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(s.get()); // 回写落盘
    expect(infoSpy).toHaveBeenCalledTimes(1); // 迁移 info 一次语义
    expect(warnSpy).not.toHaveBeenCalled(); // 静默迁移不告警
    infoSpy.mockRestore();
  });

  it('v2 文件启动链式迁移 v2→v4：get 得 v4 全量（用户值保留 + 新域/改型默认）+ 原子回写 + info 一次', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const v2File: SettingsDataV2 = {
      schemaVersion: 2,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: { layout: DEFAULT_LAYOUT_V3 },
    };
    writeFileSync(file, JSON.stringify(v2File), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(migrateV3ToV4(migrateV2ToV3(v2File)));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(s.get()); // 回写落盘
    expect(infoSpy).toHaveBeenCalledTimes(1); // 迁移 info 一次语义
    expect(warnSpy).not.toHaveBeenCalled(); // 静默迁移不告警
    infoSpy.mockRestore();
  });

  it('v1 文件启动三级链式迁移 v1→v4：get 得 v4 全量 + 原子回写 + info 一次', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, preview: { debounceMs: 500 } }), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(
      migrateV3ToV4(
        migrateV2ToV3(migrateV1ToV2({ schemaVersion: 1, preview: { debounceMs: 500 } })),
      ),
    );
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(s.get()); // 回写落盘
    expect(infoSpy).toHaveBeenCalledTimes(1); // 三级链式仍只落一次盘、打一条 info
    expect(warnSpy).not.toHaveBeenCalled(); // 静默迁移不告警
    infoSpy.mockRestore();
  });
});
