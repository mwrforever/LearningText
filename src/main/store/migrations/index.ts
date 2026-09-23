// 迁移注册表：version 严格递增；新增迁移只追加，禁改历史条目（宪法 A.4-3 只升不降）
import type Database from 'better-sqlite3';
import { initialMigration } from './0001-initial';
import { trigramMigration } from './0002-search-trigram';
import { pathPartialUniqueMigration } from './0003-vfs-path-partial-unique';

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Database.Database): void;
}

export const ALL_MIGRATIONS: readonly Migration[] = [
  initialMigration,
  trigramMigration,
  pathPartialUniqueMigration,
];
