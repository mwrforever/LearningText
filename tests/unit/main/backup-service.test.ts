// 备份服务单元测试（M5 批次③ Task 9）：以真实临时目录驱动（fs 不 mock），
// checkpoint/onDone 以桩断言供给链路；create 产出名形与滚动裁剪、restore 三错误路径
// （E_BACKUP_NOT_FOUND / E_BACKUP_CORRUPT / E_BACKUP_FAILED）、autoBackupIfNeeded
// 到期分支与「失败 warn 不阻断」。真实库文件的字节级行为由集成测试覆盖。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  E_BACKUP_CORRUPT,
  E_BACKUP_FAILED,
  E_BACKUP_NOT_FOUND,
  E_STORE_INTERNAL,
} from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';
import { toLocalIsoDate } from '../../../src/shared/time';
import { BackupService, type BackupServiceDeps } from '../../../src/main/backup/backupService';

/** 与服务同约定的备份文件名（lt-YYYYMMDD-HHMMSS.db）测试侧构造器 */
function stampName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `lt-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.db`
  );
}

const BACKUP_NAME_RE = /^lt-\d{8}-\d{6}\.db$/;

let root: string;
let backupsDir: string;
let dbFile: string;
let checkpoint: ReturnType<typeof vi.fn<() => void>>;
let onDone: ReturnType<typeof vi.fn<(fileName: string) => void>>;

function makeService(overrides: Partial<BackupServiceDeps> = {}): BackupService {
  return new BackupService({
    backupsDir,
    dbFile,
    checkpoint,
    onDone,
    ...overrides,
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lt-backup-unit-'));
  backupsDir = path.join(root, 'backups');
  dbFile = path.join(root, 'learningtext.db');
  mkdirSync(backupsDir, { recursive: true });
  writeFileSync(dbFile, Buffer.from('current-db-bytes'));
  checkpoint = vi.fn();
  onDone = vi.fn();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('BackupService.create', () => {
  it('产出 lt-YYYYMMDD-HHMMSS.db 名形文件：checkpoint 先于建份、onDone 收到同一文件名', () => {
    const service = makeService();
    const callOrder: string[] = [];
    checkpoint.mockImplementation(() => {
      callOrder.push('checkpoint');
    });
    onDone.mockImplementation(() => {
      callOrder.push('onDone');
    });

    const { fileName } = service.create();

    // 名形约定（字典序=时间序与到期判定的共同前提）+ 文件真实落盘
    expect(fileName).toMatch(BACKUP_NAME_RE);
    expect(existsSync(path.join(backupsDir, fileName))).toBe(true);
    // A.4-9：复制前完成 checkpoint；onDone 在建份成功后收到同一文件名
    expect(callOrder).toEqual(['checkpoint', 'onDone']);
    expect(onDone).toHaveBeenCalledWith(fileName);
  });

  it('复制失败（库文件缺失）抛 E_BACKUP_FAILED，onDone 不触发', () => {
    const service = makeService({ dbFile: path.join(root, 'missing.db') });
    expectBackupCode(() => service.create(), E_BACKUP_FAILED);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('checkpoint 供给抛出的业务错误原样透传，不被二次包装为 E_BACKUP_FAILED', () => {
    checkpoint.mockImplementation(() => {
      throw new AppError(E_STORE_INTERNAL, '供给侧业务错误');
    });
    const service = makeService();
    expectBackupCode(() => service.create(), E_STORE_INTERNAL);
  });

  it('旧备份裁剪失败（占位目录不可删除）仅 warn，不影响本次建份成功', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 预置 7 份比占位目录名更新的备份：新建后共 9 份，字典序最旧即占位目录，
      // unlinkSync 对目录必失败——建份不得因此报错（备份本体已成功）
      mkdirSync(path.join(backupsDir, 'lt-20200101-000000.db'));
      for (let day = 2; day <= 8; day += 1) {
        writeFileSync(path.join(backupsDir, `lt-2026090${day}-080000.db`), Buffer.from('b'));
      }
      const service = makeService();
      const { fileName } = service.create();
      expect(fileName).toMatch(BACKUP_NAME_RE);
      expect(existsSync(path.join(backupsDir, fileName))).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('裁剪旧备份失败'),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('BackupService.restore 三错误路径', () => {
  it('名形不合法或文件不存在 → E_BACKUP_NOT_FOUND', () => {
    const service = makeService();
    // 路径逃逸形态（渲染端不可信入参）与单纯缺失同归「不存在」
    expectBackupCode(() => service.restore('../learningtext.db'), E_BACKUP_NOT_FOUND);
    expectBackupCode(() => service.restore('lt-20000101-000000.db'), E_BACKUP_NOT_FOUND);
  });

  it('备份内容损坏 → E_BACKUP_CORRUPT，且库文件同目录不残留还原临时文件', () => {
    writeFileSync(
      path.join(backupsDir, 'lt-20260920-080000.db'),
      Buffer.from('garbage-not-sqlite'),
    );
    const service = makeService();
    expectBackupCode(() => service.restore('lt-20260920-080000.db'), E_BACKUP_CORRUPT);
    expect(leftoverTmp(root)).toEqual([]);
  });

  it('替换阶段失败（目标被目录占用不可覆盖）→ E_BACKUP_FAILED，且临时文件被清理', () => {
    // 空文件即合法空库（integrity_check 返回 ok，可推进到替换阶段）；
    // 当前库位被同名目录占用 → rename 覆盖必失败
    writeFileSync(path.join(backupsDir, 'lt-20260919-080000.db'), Buffer.alloc(0));
    rmSync(dbFile);
    mkdirSync(dbFile);
    const service = makeService();
    expectBackupCode(() => service.restore('lt-20260919-080000.db'), E_BACKUP_FAILED);
    expect(leftoverTmp(root)).toEqual([]);
  });

  it('临时文件无法清理（被目录占位）时清理失败仅 warn，原业务错误码不被掩盖', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 预置还原临时位为同名目录：复制阶段（copyFileSync 目标为目录）即失败，
      // 清理临时文件对目录 unlink 同样失败——失败链双层命中仍须抛原始错误码
      mkdirSync(`${dbFile}.restore-tmp`);
      writeFileSync(path.join(backupsDir, 'lt-20260918-080000.db'), Buffer.alloc(0));
      const service = makeService();
      expectBackupCode(() => service.restore('lt-20260918-080000.db'), E_BACKUP_FAILED);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('临时文件清理失败'),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('BackupService.autoBackupIfNeeded', () => {
  it('开关关闭直接返回，不触发任何建份动作', () => {
    const service = makeService();
    service.autoBackupIfNeeded(toLocalIsoDate(new Date()), false);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('首启（备份目录为空、无历史备份）到期：创建一份', () => {
    const service = makeService();
    service.autoBackupIfNeeded(toLocalIsoDate(new Date()), true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('当日已有备份（最新文件日期=今天）不重复创建', () => {
    writeFileSync(path.join(backupsDir, stampName(new Date())), Buffer.from('today'));
    const service = makeService();
    service.autoBackupIfNeeded(toLocalIsoDate(new Date()), true);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('最近备份为往日（日期不同）到期：创建一份', () => {
    writeFileSync(path.join(backupsDir, 'lt-20260901-080000.db'), Buffer.from('old'));
    const service = makeService();
    service.autoBackupIfNeeded(toLocalIsoDate(new Date()), true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('建份失败仅 warn 不外抛（装配契约：每日自动备份不阻断启动）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 备份目录与库文件均不存在：命中「目录缺失按空名单处理」分支后进入建份，复制失败告警
      const service = makeService({
        backupsDir: path.join(root, 'no-such-backups'),
        dbFile: path.join(root, 'missing.db'),
      });
      expect(() => service.autoBackupIfNeeded(toLocalIsoDate(new Date()), true)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('自动备份'), expect.anything());
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('BackupService.list', () => {
  it('反映真实目录：仅含合法名形备份，按新→旧排序，字节数取自真实文件', () => {
    writeFileSync(path.join(backupsDir, 'lt-20260919-080000.db'), Buffer.from('12345'));
    writeFileSync(path.join(backupsDir, 'lt-20260920-080000.db'), Buffer.from('1234567890'));
    writeFileSync(path.join(backupsDir, 'ignore.txt'), Buffer.from('非备份文件不入列'));
    const service = makeService();
    const entries = service.list();
    expect(entries.map((entry) => entry.fileName)).toEqual([
      'lt-20260920-080000.db',
      'lt-20260919-080000.db',
    ]);
    expect(entries[0]?.sizeBytes).toBe(10);
    expect(entries[1]?.sizeBytes).toBe(5);
    // modifiedAt 为本地 ISO 时区形态字符串（shared/time.ts 既有格式）
    expect(typeof entries[0]?.modifiedAt).toBe('string');
    expect(entries[0]?.modifiedAt.length).toBeGreaterThan(0);
  });
});

// —— 断言辅助 ——

/** 断言运行抛出指定业务错误码的 AppError（三错误路径共用） */
function expectBackupCode(run: () => void, code: string): void {
  try {
    run();
    expect.unreachable('应当抛出业务错误');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
  }
}

/** 库文件同目录残留的还原临时文件清单（失败即清理断言用） */
function leftoverTmp(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes('.restore-tmp'));
}
