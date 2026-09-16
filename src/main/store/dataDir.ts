// 数据目录布局（spec §2.1）：userData 下应用专属子目录，userData 直下不放任何文件
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export interface DataDirLayout {
  /** 应用数据根目录 <userData>/LearningText */
  readonly root: string;
  /** 数据库文件绝对路径 */
  readonly dbFile: string;
  /** 滚动备份目录 */
  readonly backupDir: string;
  /** 每日自动备份标记文件（M5 备份使用，此处仅落布局） */
  readonly markerFile: string;
}

/** 解析数据目录布局：纯路径运算，不做 IO */
export function resolveDataDir(userDataRoot: string): DataDirLayout {
  const root = path.join(userDataRoot, 'LearningText');
  return {
    root,
    dbFile: path.join(root, 'learningtext.db'),
    backupDir: path.join(root, 'backups'),
    markerFile: path.join(root, 'last-backup.json'),
  };
}

/** 确保根目录与备份目录存在（首启创建） */
export function ensureDataDir(layout: DataDirLayout): void {
  mkdirSync(layout.backupDir, { recursive: true });
}
