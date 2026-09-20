// 设置服务（M3 spec §5 / M4 spec §7 / M5 批次③）：启动读缓存（v3 直读 → v2 静默迁移 →
// v1 两级链式迁移）、损坏/版本不识别 warn 回退默认、set 原子写、get 恒不抛
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsService } from '../../../src/main/settings/settingsService';
import {
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  migrateV1ToV2,
  migrateV2ToV3,
  type SettingsDataV2,
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

  it('schemaVersion 不识别（v4）warn 回退默认', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 4, preview: { debounceMs: 100 } }), 'utf8');
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

  it('v2 文件启动静默迁移：get 得 v3 全量（用户值保留 + 四新域默认）+ 原子回写 + info 一次', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const v2File: SettingsDataV2 = {
      schemaVersion: 2,
      preview: { debounceMs: 500 },
      editor: { autoSaveMs: 4500 },
      shell: { layout: DEFAULT_LAYOUT },
    };
    writeFileSync(file, JSON.stringify(v2File), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(migrateV2ToV3(v2File));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(s.get()); // 回写落盘
    expect(infoSpy).toHaveBeenCalledTimes(1); // 迁移 info 一次语义
    expect(warnSpy).not.toHaveBeenCalled(); // 静默迁移不告警
    infoSpy.mockRestore();
  });

  it('v1 文件启动两级链式迁移 v1→v3：get 得 v3 全量 + 原子回写 + info 一次', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, preview: { debounceMs: 500 } }), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(
      migrateV2ToV3(migrateV1ToV2({ schemaVersion: 1, preview: { debounceMs: 500 } })),
    );
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(s.get()); // 回写落盘
    expect(infoSpy).toHaveBeenCalledTimes(1); // 两级链式仍只落一次盘、打一条 info
    expect(warnSpy).not.toHaveBeenCalled(); // 静默迁移不告警
    infoSpy.mockRestore();
  });
});
