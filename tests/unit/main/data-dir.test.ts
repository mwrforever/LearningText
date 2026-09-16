// 数据目录布局（spec §2.1）：userData 下专属子目录，路径纯函数
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../../../src/main/store/dataDir';

describe('resolveDataDir', () => {
  it('根/库文件/备份目录/标记文件全部收敛在 LearningText 子目录', () => {
    const layout = resolveDataDir('C:\\Users\\x\\AppData\\Roaming');
    expect(layout.root.endsWith('LearningText')).toBe(true);
    expect(layout.dbFile).toBe(layout.root + '\\learningtext.db');
    expect(layout.backupDir).toBe(layout.root + '\\backups');
    expect(layout.markerFile).toBe(layout.root + '\\last-backup.json');
  });
});
