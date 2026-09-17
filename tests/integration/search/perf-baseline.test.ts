// 性能基准（NFR-01/03 + spec §7.2）：真实文件库 + 服务层语句形态（M1 口径偏乐观的复核点）。
// 断言为宽松上限（CI 三平台波动），实测 [perf-m2] 行供宪法 A.5-4 回填。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { ALL_MIGRATIONS } from '../../../src/main/store/migrations';
import { initialMigration } from '../../../src/main/store/migrations/0001-initial';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { createSearchService } from '../../../src/main/search/searchService';

const DIRS = 50;
const FILES_PER_DIR = 200; // 50 × 200 = 10000 文件（+目录行 ≈ 10051 节点）
/** 正文 ≈1KB 中文字段混合，总文本量级 ≈10MB（docs/03 NFR-03 场景口径） */
function bodyText(i: number): string {
  const seg = `二元指数分布采样记录${String(i)}：概率密度函数在实数轴连续可积，尾部分位数估计采用核方法平滑。`;
  return `<p>${seg.repeat(8)}</p>`; // ≈1KB
}
// 采样词全部 ≥3 码点（A.4-11 索引通道下界）且均出自语料，50 采样全程走 trigram 索引通道
//（spec §7.2：P95 红线针对索引通道、含 bm25+COUNT+snippet 全成本；LIKE 回退通道明确不承诺 P95）
const QUERY_WORDS = [
  '指数分布',
  '采样记录',
  '概率密度',
  '密度函数',
  '核方法',
  '实数轴',
  '连续可积',
  '分位数',
];

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lt-perf-m2-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true }); // Windows：db.close() 先行（用后各用例 finally 保证）
});

describe('M2 文件库基准（万级节点，服务层语句形态）', () => {
  it('万行单事务写入含 node_fts（X′ 采集）与 search:query P95 < 200ms（NFR-03）', () => {
    const dbFile = path.join(dir, 'perf.db');
    const db = openDatabase({ file: dbFile });
    try {
      runMigrations(db);
      const vfs = createVfsService(db);
      const search = createSearchService(db);
      // —— 写入 X′：与 vfsService 写路径同形态（stmtInsertNode + stmtInsertFts 同事务批量，
      //    宪法 A.4-6 合并单事务；M1 基准缺 FTS 插入，本处为服务层完整形态）——
      const t0 = performance.now();
      db.transaction(() => {
        const insNode = db.prepare(
          `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
           VALUES (@parentId, 'file', @name, @path, 'text/html', @size, NULL, NULL, @now, @now)`,
        );
        const insFts = db.prepare(
          `INSERT INTO node_fts (rowid, name, body) VALUES (@id, @name, @body)`,
        );
        for (let d = 0; d < DIRS; d += 1) {
          const dirName = `d${String(d)}`;
          const dirId = Number(vfs.createNode({ parentId: 1, name: dirName, nodeType: 'dir' }).id);
          for (let f = 0; f < FILES_PER_DIR; f += 1) {
            const i = d * FILES_PER_DIR + f;
            const name = `f${String(i).padStart(5, '0')}.html`;
            const body = bodyText(i);
            const info = insNode.run({
              parentId: dirId,
              name,
              path: `/${dirName}/${name}`,
              size: body.length,
              now: '2026-09-17T10:00:00.000+08:00',
            });
            insFts.run({ id: Number(info.lastInsertRowid), name, body });
          }
        }
      })();
      const writeMs = performance.now() - t0;

      // —— 搜索 P95：索引通道 50 采样（混合关键词、万级全命中最坏代价），红线 NFR-03 = 200ms ——
      const samples: number[] = [];
      for (let i = 0; i < 50; i += 1) {
        const word = QUERY_WORDS[i % QUERY_WORDS.length] ?? '指数分布';
        const t = performance.now();
        search.query({ keyword: `${word} 采样记录`, limit: 50 });
        samples.push(performance.now() - t);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.ceil(0.95 * samples.length) - 1] ?? Number.POSITIVE_INFINITY;
      expect(p95).toBeLessThan(200);
      expect(writeMs).toBeLessThan(5000); // 宽松写入上限（CI 波动容忍）
      console.info(
        `[perf-m2] 万行含FTS写入 ${writeMs.toFixed(0)}ms；search P95 ${p95.toFixed(1)}ms（中位 ${String((samples[25] ?? 0).toFixed(1))}ms）`,
      );
    } finally {
      db.close();
    }
  });

  it('冷启动（v2 已生效文件库开库+迁移就绪）< 2s 与 v2 迁移自身耗时采集（NFR-01）', () => {
    const dbFile = path.join(dir, 'startup.db');
    // —— 造 v1 万行库 ——
    const v1Only = [initialMigration];
    let db = openDatabase({ file: dbFile });
    try {
      runMigrations(db, v1Only);
      db.transaction(() => {
        const insNode = db.prepare(
          `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, created_at, updated_at)
           VALUES (1, 'file', @name, @path, 'text/plain', 0, @now, @now)`,
        );
        const insFts = db.prepare(
          `INSERT INTO node_fts (rowid, name, body) VALUES (@id, @name, '')`,
        );
        for (let i = 0; i < DIRS * FILES_PER_DIR; i += 1) {
          const name = `s${String(i).padStart(5, '0')}.txt`;
          const info = insNode.run({
            name,
            path: `/${name}`,
            now: '2026-09-17T10:00:00.000+08:00',
          });
          insFts.run({ id: Number(info.lastInsertRowid), name });
        }
      })();
    } finally {
      db.close();
    }
    // —— v2 迁移耗时（换表在真实文件库上）——
    const tMig = performance.now();
    db = openDatabase({ file: dbFile });
    try {
      runMigrations(db, ALL_MIGRATIONS.slice(0, 2)); // 应用 v1(跳过) + v2(执行)
    } finally {
      db.close();
    }
    const v2Ms = performance.now() - tMig;
    // —— 冷启动：开库 + 全量迁移（已 v2，零待应用）+ 服务装配 ——
    const t0 = performance.now();
    db = openDatabase({ file: dbFile });
    try {
      runMigrations(db);
      createVfsService(db);
      createSearchService(db);
      const coldMs = performance.now() - t0;
      expect(coldMs).toBeLessThan(2000); // NFR-01 真实口径（M1 的 :memory: 名义覆盖由本用例取代）
      console.info(
        `[perf-m2] v2 换表迁移 ${v2Ms.toFixed(0)}ms；冷启动(10k 文件库) ${coldMs.toFixed(0)}ms`,
      );
    } finally {
      db.close();
    }
  });
});
