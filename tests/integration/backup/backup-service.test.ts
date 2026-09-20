// 备份服务集成测试（M5 批次③ Task 9）：真实临时目录 + 真实 better-sqlite3 库文件——
// create 真实复制且字节一致、list 反映真实目录、restore 真实替换当前库并通过 integrity
// 校验、滚动裁剪真实删除最旧、autoBackupIfNeeded 首启触发。还原前关库与生产形态一致
// （Windows 下打开中的库文件禁止 rename 覆盖，见 Task 9 报告实验记录）。
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { BackupService } from '../../../src/main/backup/backupService';
import { toLocalIsoDate } from '../../../src/shared/time';

const BACKUP_NAME_RE = /^lt-\d{8}-\d{6}\.db$/;

let root: string;
let backupsDir: string;
let dbFile: string;
let db: Database.Database;
let checkpoint: ReturnType<typeof vi.fn<() => void>>;
let onDone: ReturnType<typeof vi.fn<(fileName: string) => void>>;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lt-backup-itest-'));
  backupsDir = path.join(root, 'backups');
  dbFile = path.join(root, 'learningtext.db');
  mkdirSync(backupsDir, { recursive: true });
  db = openDatabase({ file: dbFile });
  db.exec('CREATE TABLE note(id INTEGER PRIMARY KEY, body TEXT)');
  db.prepare('INSERT INTO note(body) VALUES (?)').run('首启数据');
  // WAL checkpoint 供给走真实现（A.4-9：复制前冲刷，库文件字节完整）；还原路径与生产
  // 一致——替换点前库已被干净关闭，供给闭包对已关库安全跳过（close 自带最终 checkpoint）
  checkpoint = vi.fn(() => {
    if (db.open) db.pragma('wal_checkpoint(TRUNCATE)');
  });
  onDone = vi.fn();
});

afterEach(() => {
  // restore 用例可能已关闭连接，关闭态重复 close 以可选链兜底
  if (db.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

function makeService(): BackupService {
  return new BackupService({ backupsDir, dbFile, checkpoint, onDone });
}

function backupFileNames(): string[] {
  return readdirSync(backupsDir)
    .filter((name) => BACKUP_NAME_RE.test(name))
    .sort();
}

describe('备份服务集成（真实临时目录）', () => {
  it('create 真实复制库文件：备份字节与当前库一致，且备份自身可打开并通过 integrity 校验', () => {
    const service = makeService();
    const { fileName } = service.create();

    expect(onDone).toHaveBeenCalledWith(fileName);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    const backupPath = path.join(backupsDir, fileName);
    expect(existsSync(backupPath)).toBe(true);
    // 字节级一致（TRUNCATE checkpoint 后 WAL 已并入主文件，主文件即完整库）
    expect(readFileSync(backupPath).equals(readFileSync(dbFile))).toBe(true);
    // 备份可独立打开且数据完整（还原可用性的本质断言）
    const probe = new Database(backupPath, { readonly: true });
    try {
      expect(probe.pragma('integrity_check', { simple: true })).toBe('ok');
      expect((probe.prepare('SELECT body FROM note').get() as { body: string }).body).toBe(
        '首启数据',
      );
    } finally {
      probe.close();
    }
  });

  it('list 反映真实目录条目（文件名/字节数真实），按新→旧排序', () => {
    writeFileSync(path.join(backupsDir, 'lt-20260918-080000.db'), Buffer.from('1234567'));
    writeFileSync(path.join(backupsDir, 'lt-20260919-080000.db'), Buffer.from('1234567890'));
    const service = makeService();
    const entries = service.list();
    expect(entries.map((entry) => entry.fileName)).toEqual([
      'lt-20260919-080000.db',
      'lt-20260918-080000.db',
    ]);
    expect(entries[0]?.sizeBytes).toBe(10);
    expect(entries[1]?.sizeBytes).toBe(7);
  });

  it('restore 真实替换当前库：替换后新连接读到备份时点数据且 integrity 通过', () => {
    const service = makeService();
    const { fileName } = service.create();

    // 备份后数据继续演化（覆盖即丢失此变更——还原语义的本质）
    db.prepare('INSERT INTO note(body) VALUES (?)').run('备份后才写入');
    db.pragma('wal_checkpoint(TRUNCATE)');
    // 生产形态：还原替换点前干净关闭当前连接（close 自带最终 checkpoint 与 sidecar 清理）
    db.close();

    service.restore(fileName);

    // 以全新连接验证：数据回到备份时点，库完整性无损
    const reopened = openDatabase({ file: dbFile });
    try {
      const bodies = (
        reopened.prepare('SELECT body FROM note ORDER BY id').all() as Array<{
          body: string;
        }>
      ).map((row) => row.body);
      expect(bodies).toEqual(['首启数据']);
      expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok');
      // 还原完成后库文件同目录无临时残留
      expect(readdirSync(root).filter((name) => name.includes('.restore-tmp'))).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it('滚动裁剪真实删除最旧：预置 9 份历史 + 新建 1 份后保留最近 7 份', () => {
    // 9 份历史备份全部早于今天（2026 年 1 月逐日），字典序 = 时间序
    for (let i = 1; i <= 9; i += 1) {
      const day = String(i).padStart(2, '0');
      writeFileSync(path.join(backupsDir, `lt-20260101-0000${day}.db`), Buffer.from('old'));
    }
    const service = makeService();
    const { fileName } = service.create();

    const names = backupFileNames();
    expect(names).toHaveLength(7);
    expect(names).toContain(fileName);
    // 最旧 3 份（000001/000002/000003）被真实删除
    expect(names).not.toContain('lt-20260101-000001.db');
    expect(names).not.toContain('lt-20260101-000002.db');
    expect(names).not.toContain('lt-20260101-000003.db');
    expect(names).toContain('lt-20260101-000004.db');
  });

  it('autoBackupIfNeeded 首启（空备份目录）触发真实创建', () => {
    const service = makeService();
    service.autoBackupIfNeeded(toLocalIsoDate(new Date()), true);
    expect(backupFileNames()).toHaveLength(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
