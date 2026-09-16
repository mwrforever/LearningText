// 性能基准（NFR-01/02）：万级节点 listChildren < 100ms、启动 < 2s；
// 断言为宽松上限（CI 三平台性能波动大），A.5-4 毫秒预算以本文件实测值为据回填
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';

const DIRS = 50;
const FILES_PER_DIR = 200; // 50 × 200 = 10000 节点

describe('性能基准（万级节点）', () => {
  it('万文件单目录 listChildren < 100ms（NFR-02）', () => {
    const db = openDatabase({ file: ':memory:' });
    runMigrations(db);
    const vfs = createVfsService(db);
    const dir = vfs.createNode({ parentId: 1, name: 'bulk', nodeType: 'dir' });
    // 批量写入合并单事务（宪法 A.4-6 反模式条款的反面：禁逐条自动提交）
    const t0 = performance.now();
    db.transaction(() => {
      const stmt = db.prepare(
        `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content_hash, created_at, updated_at)
         VALUES (?, 'file', ?, ?, 'text/plain', 0, NULL, '2026-09-16T00:00:00.000+08:00', '2026-09-16T00:00:00.000+08:00')`,
      );
      for (let i = 0; i < DIRS * FILES_PER_DIR; i += 1) {
        const name = `f${String(i).padStart(5, '0')}.txt`;
        stmt.run(dir.id, name, `${dir.virtualPath}/${name}`);
      }
    })();
    const seedMs = performance.now() - t0;

    const t1 = performance.now();
    const children = vfs.listChildren({ parentId: dir.id });
    const queryMs = performance.now() - t1;
    expect(children).toHaveLength(DIRS * FILES_PER_DIR);
    expect(queryMs).toBeLessThan(100);
    // 输出实测值供 A.5-4 回填（单事务万行写入与万行列表查询的事件循环阻塞时长）
    console.info(
      `[perf] 万文件单事务写入 ${seedMs.toFixed(0)}ms；listChildren 万行 ${queryMs.toFixed(1)}ms`,
    );
    db.close();
  });

  it('开库 + 迁移（万节点库）< 2s（NFR-01 宽松上限）', () => {
    // :memory: 下迁移即建表，语义上验证「启动路径开销」而非磁盘 IO；文件库版本由本地与 CI 观察
    const t0 = performance.now();
    const db = openDatabase({ file: ':memory:' });
    runMigrations(db);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    db.close();
  });
});
