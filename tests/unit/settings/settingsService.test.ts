// 设置服务（spec §5）：启动读缓存、损坏/版本不识别 warn 回退默认、set 原子写、get 恒不抛
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsService } from '../../../src/main/settings/settingsService';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';

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

  it('schemaVersion 不识别 warn 回退默认（v2 文件对 v1 闸即旧版）', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 2, preview: { debounceMs: 100 } }), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('合法文件加载进缓存；set 更新缓存并落盘', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, preview: { debounceMs: 500 } }), 'utf8');
    const s = createSettingsService({ settingsFile: file });
    expect(s.get().preview.debounceMs).toBe(500);
    const next = { schemaVersion: 1 as const, preview: { debounceMs: 1500 } };
    expect(s.set(next)).toEqual(next);
    expect(s.get()).toEqual(next);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(next);
  });
});
