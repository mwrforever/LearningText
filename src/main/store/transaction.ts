// 写事务唯一入口（spec §4）：IMMEDIATE 变体（BEGIN 即取写锁 fail-fast）；
// 禁 async（宪法 A.4-4：事务不得跨事件循环 tick）。错误统一映射后以 AppError 抛出。
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import { mapSqliteError } from './errorMapping';

export function runWriteTransaction<T>(db: Database.Database, fn: () => T): T {
  try {
    return db.transaction(fn).immediate();
  } catch (error: unknown) {
    // 业务 AppError 原样透传：其 code 同为 string，若落入下方 SQLite 判定会被映射表
    // default 分支改写为 E_STORE_INTERNAL（原始业务码丢失），违背「服务层抛 AppError」契约
    if (error instanceof AppError) {
      throw error;
    }
    // SQLite 可能未经请求自动回滚（SQLITE_FULL/IOERR/INTERRUPT/NOMEM），
    // 此处不做 inTransaction 内清理（IMMEDIATE 下正常路径抛出时事务已终结），统一映射后上抛
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
      throw mapSqliteError(error);
    }
    throw error; // 未知异常原样上抛
  }
}
