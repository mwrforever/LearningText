// v2：FTS 读侧就绪（spec §2.2）——unicode61 换 trigram 分词器、父指针全量索引。
// 分词器变更不可 ALTER（FTS5 约束），走「新建→复制→换名」重建范式（调研报告 A4-5）；
// 复制行值而非重抽取 content：M1 不变式「回收站节点无 FTS 行」保证旧表只含活节点行，
// 零 BLOB 读取不触碰交互路径预算（宪法 A.5-4）。
import type Database from 'better-sqlite3';
import type { Migration } from './index';

export const trigramMigration: Migration = {
  version: 2,
  name: 'search-trigram-fts',
  up(db: Database.Database): void {
    // 漂移对账前置（spec §2.2）：非根活节点与索引行必须一一对应（根节点由 v1 种子创建、
    // M1 写侧不为其建索引行——对账口径排除 id=1）；不平即中止，事务回滚（旧表原样），
    // 启动 fail-fast 阻止带病运行，杜绝把漂移复制进新表
    const live = db
      .prepare<[], { c: number }>(
        'SELECT COUNT(*) AS c FROM node WHERE deleted_at IS NULL AND id <> 1',
      )
      .get()?.c;
    const indexed = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM node_fts').get()?.c;
    if (live !== indexed) {
      throw new Error(
        `FTS 漂移对账失败：非根活节点 ${live ?? '未知'} ≠ 索引行 ${indexed ?? '未知'}，v2 迁移中止等待修复（备份恢复或重建索引，见 M5 设置页规划）`,
      );
    }
    // 默认 case_sensitive=0：索引大小写不敏感，且可优化 ≥3 连续字符 LIKE/GLOB（A.4-11 退化面的正面形态）
    db.exec(`CREATE VIRTUAL TABLE node_fts_new USING fts5(name, body, tokenize = 'trigram')`);
    db.exec(`INSERT INTO node_fts_new (rowid, name, body) SELECT rowid, name, body FROM node_fts`);
    // 换名：DROP 旧表与影子表随行删除，RENAME 把新表连同影子表归位 node_fts
    db.exec(`DROP TABLE node_fts`);
    db.exec(`ALTER TABLE node_fts_new RENAME TO node_fts`);
    // 父指针全量索引：回收站树下钻（递归 CTE）不被部分索引 idx_node_parent（仅活行）漏掉（spec §2.2④）
    db.exec(`CREATE INDEX idx_node_parent_all ON node(parent_id)`);
  },
};
