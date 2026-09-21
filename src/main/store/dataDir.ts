// 数据目录布局（宪法 A.2-1 修订版，M6 spec §5.1）：默认 userData 下应用专属子目录；
// 数据根可由用户更改并迁移，由 userData 直下唯一例外指针文件 data-dir.json 记录——
// 指针必须在数据目录之外（自指死锁：被迁移的 settings.json 不能承载「迁去哪」）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DataDirPointerSchema, type DataDirPointer } from '../../shared/storage-contract';

export interface DataDirLayout {
  /** 应用数据根目录 <数据根父目录>/LearningText */
  readonly root: string;
  /** 数据库文件绝对路径 */
  readonly dbFile: string;
  /** 滚动备份目录 */
  readonly backupDir: string;
  /** 每日自动备份标记文件（M5 备份使用，此处仅落布局） */
  readonly markerFile: string;
  /** 设置目录（M3 spec §5：数据根下 settings/ 层级，为更多设置文件留位置） */
  readonly settingsDir: string;
  /** 设置文件绝对路径 */
  readonly settingsFile: string;
}

/** 指针文件名（userData 直下唯一例外文件，宪法 A.2-1 修订版） */
export const DATA_DIR_POINTER_FILE = 'data-dir.json';

/**
 * 解析数据目录布局：纯路径运算，不做 IO。入参为「数据根父目录」——默认 userData、
 * 迁移后为用户所选目录（spec D8：数据恒落 <父目录>/LearningText/，与默认形态同构，
 * 避免用户选根目录时文件散落）。
 */
export function resolveDataDir(dataRootParent: string): DataDirLayout {
  const root = path.join(dataRootParent, 'LearningText');
  return {
    root,
    dbFile: path.join(root, 'learningtext.db'),
    backupDir: path.join(root, 'backups'),
    markerFile: path.join(root, 'last-backup.json'),
    settingsDir: path.join(root, 'settings'),
    settingsFile: path.join(root, 'settings', 'settings.json'),
  };
}

/**
 * 读数据根指针（启动装配链第一步，M6 spec §5.1）：文件缺失/JSON 损坏/schema 不中一律
 * 回退默认位置（返回 root:null）并 warn，不阻断启动——设置同款「可丢弃缓存」纪律（A.5-1 例外域）。
 */
export function readDataDirPointer(userDataRoot: string): DataDirPointer {
  const file = path.join(userDataRoot, DATA_DIR_POINTER_FILE);
  if (!existsSync(file)) return { root: null };
  try {
    const parsed = DataDirPointerSchema.safeParse(
      JSON.parse(readFileSync(file, 'utf8')) as unknown,
    );
    if (parsed.success) return parsed.data;
    console.warn('[data-dir] 指针文件校验失败，回退默认数据位置', parsed.error.name);
    return { root: null };
  } catch (e: unknown) {
    console.warn('[data-dir] 读取指针文件失败，回退默认数据位置', e);
    return { root: null };
  }
}

/**
 * 原子写数据根指针（tmp + 同目录 rename，settings.json 同款纪律）：仅迁移服务在
 * 「全部复制成功之后」调用——指针落盘即生效，下次启动数据从新位置打开。
 */
export function writeDataDirPointer(userDataRoot: string, root: string): void {
  const file = path.join(userDataRoot, DATA_DIR_POINTER_FILE);
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify({ root } satisfies DataDirPointer, null, 2), 'utf8');
  renameSync(tmp, file);
}

/** 确保备份目录与设置目录存在（首启/迁移后新位置创建） */
export function ensureDataDir(layout: DataDirLayout): void {
  mkdirSync(layout.backupDir, { recursive: true });
  mkdirSync(layout.settingsDir, { recursive: true });
}
