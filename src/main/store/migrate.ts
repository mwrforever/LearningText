// 迁移执行器（spec §3.2）：按 user_version 增量执行；单迁移单事务（DDL 与版本号同事务原子生效）
import type Database from 'better-sqlite3';
import { ALL_MIGRATIONS, type Migration } from './migrations';

export function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[] = ALL_MIGRATIONS,
): void {
  // pragma 返回类型为 unknown（better-sqlite3 契约）；user_version 恒为整数，收窄后再比较，
  // 非常规返回值按 0 处理（安全方向：全量重放迁移）
  const rawVersion = db.pragma('user_version', { simple: true });
  const current = typeof rawVersion === 'number' ? rawVersion : 0;
  const pending = migrations.filter((m) => m.version > current);
  for (const migration of pending) {
    // 迁移属数据库写操作与核心状态变更（全局日志规范 §二）：info 记录版本号与迁移名，便于故障定位
    console.info(`[store] 执行迁移 v${migration.version}: ${migration.name}`);
    // 每个迁移独立事务：up 的全部 DDL/DML 与 user_version 写入一起提交或回滚
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}
