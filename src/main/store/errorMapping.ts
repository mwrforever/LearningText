// SQLite 错误码 → 应用错误码映射（spec §5 表）；面向用户消息必须中文
import { AppError } from '../../shared/result';
import {
  E_STORE_BUSY,
  E_STORE_DB_DAMAGED,
  E_STORE_DISK_FULL,
  E_STORE_INTERNAL,
  E_VFS_DUPLICATE_NAME,
} from '../../shared/errors';

/** 判定 better-sqlite3 的 SqliteError 形态（含 code 扩展字段），避免 import 类型耦合 */
function isSqliteError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

export function mapSqliteError(error: unknown): AppError {
  if (!isSqliteError(error)) {
    return new AppError(E_STORE_INTERNAL, '操作失败');
  }
  switch (error.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
      // idx_node_parent_name 撞名：创建/重命名/还原的重名兜底防线
      return new AppError(E_VFS_DUPLICATE_NAME, '同级已存在同名文件或文件夹');
    case 'SQLITE_BUSY':
      // 单连接 + IMMEDIATE 下的边缘窗口（崩溃恢复期等），不自动重试，走用户提示
      return new AppError(E_STORE_BUSY, '数据库忙，请稍后重试');
    case 'SQLITE_CORRUPT':
    case 'SQLITE_NOTADB':
      return new AppError(E_STORE_DB_DAMAGED, '数据库已损坏，请从备份恢复');
    case 'SQLITE_FULL':
      return new AppError(E_STORE_DISK_FULL, '磁盘空间不足，写入失败');
    default:
      // 未识别的约束/内部错误：统一内部错误，原始 code 进主进程日志（调用方负责记录）
      return new AppError(E_STORE_INTERNAL, '操作失败');
  }
}
