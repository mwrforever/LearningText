// 数据目录布局（spec §2.1）：userData 下专属子目录，路径纯函数
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../../../src/main/store/dataDir';

describe('resolveDataDir', () => {
  it('根/库文件/备份目录/标记文件/设置文件全部收敛在 LearningText 子目录', () => {
    // 入参用平台无关的合成路径，断言全部经 path.join 构造（三平台 CI 分隔符同源，禁平台专属形态）
    const input = path.join('base', 'userData');
    const layout = resolveDataDir(input);
    expect(layout.root).toBe(path.join(input, 'LearningText'));
    expect(layout.dbFile).toBe(path.join(layout.root, 'learningtext.db'));
    expect(layout.backupDir).toBe(path.join(layout.root, 'backups'));
    expect(layout.markerFile).toBe(path.join(layout.root, 'last-backup.json'));
    expect(layout.settingsDir).toBe(path.join(layout.root, 'settings'));
    expect(layout.settingsFile).toBe(path.join(layout.root, 'settings', 'settings.json'));
  });
});
