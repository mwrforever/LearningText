// 写事务唯一入口（spec §4）：IMMEDIATE 变体（BEGIN 即取写锁 fail-fast）；
// 禁 async（宪法 A.4-4：事务不得跨事件循环 tick）。SQLite 错误统一映射为 AppError 抛出；
// 业务 AppError 原样透传。rev 版本号在其上叠加（M3 spec §4.2 防撕裂）：
// 仅存主进程内存、与 iframe 状态同源生命周期。
import type Database from 'better-sqlite3';
import { AppError } from '../../shared/result';
import { mapSqliteError } from './errorMapping';

// 全局写事务版本计数器（M3 spec §4.2）：runWriteTransaction 提交成功返回后 +1。
// 单调性由结构承担：单连接 + IMMEDIATE 串行 + 本模块同步自增，事件循环内无竞争。
let writeRev = 0;

/** 当前写事务版本号；广播侧（ipc.ts）在事务提交后读取，与自增同 tick 无竞态 */
export function currentRev(): number {
  return writeRev;
}

export function runWriteTransaction<T>(db: Database.Database, fn: () => T): T {
  let result: T;
  try {
    result = db.transaction(fn).immediate();
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
  // 执行至此 = 事务已提交（immediate() 内 fn 抛错会在上方 catch 抛出，不递增）
  writeRev += 1;
  return result;
}
