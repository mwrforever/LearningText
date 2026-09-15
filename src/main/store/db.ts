// 存储层连接管理（宪法 A.4-1/2）：进程级单例由 M1 装配层持有，此处只提供打开原语
import Database from 'better-sqlite3';

export interface OpenDatabaseOptions {
  /** 数据库文件绝对路径，或 ':memory:' 内存库（测试用） */
  readonly file: string;
}

/**
 * 打开 SQLite 连接并施加初始化 PRAGMA。
 * journal_mode=WAL 为持久属性；foreign_keys 必须在事务外设置（A.4-3）。
 * 调用方负责在退出前 db.close()（干净关闭自动做最终 checkpoint）。
 */
export function openDatabase(options: OpenDatabaseOptions): Database.Database {
  const db = new Database(options.file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
