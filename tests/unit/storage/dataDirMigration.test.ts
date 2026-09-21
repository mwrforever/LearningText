// 数据目录迁移服务（M6 spec §5.2）：指针读写三态、迁移成功/失败两路径、校验钳制。
// fs 走「真实 fs 包装 + 故障注入」适配器——真实临时目录承载文件语义，注入点模拟 IO 失败。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeDataDir,
  dataDirMigrationFs,
  type DataDirMigrationDeps,
  type DataDirMigrationFs,
} from '../../../src/main/storage/dataDirMigration';
import {
  readDataDirPointer,
  resolveDataDir,
  writeDataDirPointer,
  DATA_DIR_POINTER_FILE,
} from '../../../src/main/store/dataDir';
import { E_STORAGE_INVALID_TARGET, E_STORAGE_MIGRATE_FAILED } from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';

let dir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lt-storage-'));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  infoSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

/** 构造迁移 deps：源布局 + 目标目录 + 各供给点 spy；fs 可注入故障 */
function makeDeps(opts?: {
  readonly fs?: DataDirMigrationFs;
  readonly closeDatabase?: () => void;
}): {
  deps: DataDirMigrationDeps;
  targetDir: string;
  spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const userDataRoot = path.join(dir, 'userData');
  const layout = resolveDataDir(path.join(dir, 'source'));
  // 源布局内容：db 文件 + settings/backups 各一文件 + marker（先建目录树）
  mkdirSync(layout.settingsDir, { recursive: true });
  mkdirSync(layout.backupDir, { recursive: true });
  writeFileSync(layout.dbFile, 'db-bytes', 'utf8');
  writeFileSync(path.join(layout.settingsDir, 'settings.json'), '{}', 'utf8');
  writeFileSync(path.join(layout.backupDir, 'b1.db'), 'backup', 'utf8');
  writeFileSync(layout.markerFile, '{}', 'utf8');
  const targetDir = path.join(dir, 'target');
  mkdirSync(userDataRoot, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(path.join(userDataRoot, '占位.txt'), 'x', 'utf8');
  const spies = {
    checkpoint: vi.fn(),
    closeDatabase: opts?.closeDatabase ?? vi.fn(),
    writePointer: vi.fn(),
    relaunch: vi.fn(),
  };
  const deps: DataDirMigrationDeps = {
    userDataRoot,
    currentLayout: layout,
    checkpoint: spies.checkpoint,
    closeDatabase: spies.closeDatabase as () => void,
    writePointer: spies.writePointer as (targetDir: string) => void,
    relaunch: spies.relaunch,
    fs: opts?.fs ?? dataDirMigrationFs,
  };
  return { deps, targetDir, spies };
}

describe('数据根指针读写（M6 spec §5.1）', () => {
  it('文件缺失回退默认位置且不告警（首启正常态）', () => {
    const userDataRoot = path.join(dir, 'userData');
    expect(readDataDirPointer(userDataRoot)).toEqual({ root: null });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('写入后可读回（roundtrip），无 tmp 残留', () => {
    const userDataRoot = path.join(dir, 'userData');
    mkdirSync(userDataRoot, { recursive: true });
    writeDataDirPointer(userDataRoot, path.join(dir, 'custom'));
    expect(readDataDirPointer(userDataRoot)).toEqual({ root: path.join(dir, 'custom') });
    expect(existsSync(path.join(userDataRoot, `${DATA_DIR_POINTER_FILE}.tmp`))).toBe(false);
  });

  it('损坏 JSON warn 后回退默认（不阻断启动）', () => {
    const userDataRoot = path.join(dir, 'userData');
    mkdirSync(userDataRoot, { recursive: true });
    writeFileSync(path.join(userDataRoot, DATA_DIR_POINTER_FILE), '{ 损坏', 'utf8');
    expect(readDataDirPointer(userDataRoot)).toEqual({ root: null });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('schema 不中（root 非串）warn 回退默认', () => {
    const userDataRoot = path.join(dir, 'userData');
    mkdirSync(userDataRoot, { recursive: true });
    writeFileSync(
      path.join(userDataRoot, DATA_DIR_POINTER_FILE),
      JSON.stringify({ root: 42 }),
      'utf8',
    );
    expect(readDataDirPointer(userDataRoot)).toEqual({ root: null });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('数据目录迁移（M6 spec §5.2）', () => {
  it('成功路径：关库 → 全量复制（db/settings/backups/marker）→ 写指针 → 重启', () => {
    const { deps, targetDir, spies } = makeDeps();
    changeDataDir(deps, targetDir);
    const newRoot = path.join(targetDir, 'LearningText');
    expect(spies.checkpoint).toHaveBeenCalledTimes(1);
    expect(spies.closeDatabase).toHaveBeenCalledTimes(1);
    expect(readFileSync(path.join(newRoot, 'learningtext.db'), 'utf8')).toBe('db-bytes');
    expect(readFileSync(path.join(newRoot, 'settings', 'settings.json'), 'utf8')).toBe('{}');
    expect(readFileSync(path.join(newRoot, 'backups', 'b1.db'), 'utf8')).toBe('backup');
    expect(readFileSync(path.join(newRoot, 'last-backup.json'), 'utf8')).toBe('{}');
    expect(spies.writePointer).toHaveBeenCalledWith(targetDir);
    expect(spies.relaunch).toHaveBeenCalledTimes(1);
  });

  it('目标与当前数据位置相同 → INVALID_TARGET，不关库不重启', () => {
    const { deps, spies } = makeDeps();
    const currentParent = path.join(dir, 'source');
    try {
      changeDataDir(deps, currentParent);
      expect.unreachable('应抛出 INVALID_TARGET');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe(E_STORAGE_INVALID_TARGET);
    }
    expect(spies.closeDatabase).not.toHaveBeenCalled();
    expect(spies.relaunch).not.toHaveBeenCalled();
  });

  it('目标目录不存在 → INVALID_TARGET', () => {
    const { deps, spies } = makeDeps();
    try {
      changeDataDir(deps, path.join(dir, 'no-such-dir'));
      expect.unreachable('应抛出 INVALID_TARGET');
    } catch (e) {
      expect((e as AppError).code).toBe(E_STORAGE_INVALID_TARGET);
    }
    expect(spies.closeDatabase).not.toHaveBeenCalled();
  });

  it('目标已存在 LearningText 数据目录 → INVALID_TARGET（拒绝合并不覆盖）', () => {
    const { deps, targetDir, spies } = makeDeps();
    mkdirSync(path.join(targetDir, 'LearningText'), { recursive: true });
    writeFileSync(path.join(targetDir, 'LearningText', '已有.db'), 'x', 'utf8');
    try {
      changeDataDir(deps, targetDir);
      expect.unreachable('应抛出 INVALID_TARGET');
    } catch (e) {
      expect((e as AppError).code).toBe(E_STORAGE_INVALID_TARGET);
    }
    // 既有内容不受影响、未关库未重启
    expect(readFileSync(path.join(targetDir, 'LearningText', '已有.db'), 'utf8')).toBe('x');
    expect(spies.closeDatabase).not.toHaveBeenCalled();
    expect(spies.relaunch).not.toHaveBeenCalled();
  });

  it('目标不可写（mkdir 失败）→ INVALID_TARGET，不关库不重启', () => {
    const failingFs: DataDirMigrationFs = {
      ...dataDirMigrationFs,
      mkdirSync: () => {
        throw new Error('EACCES');
      },
    };
    const { deps, targetDir, spies } = makeDeps({ fs: failingFs });
    try {
      changeDataDir(deps, targetDir);
      expect.unreachable('应抛出 INVALID_TARGET');
    } catch (e) {
      expect((e as AppError).code).toBe(E_STORAGE_INVALID_TARGET);
    }
    expect(spies.closeDatabase).not.toHaveBeenCalled();
    expect(spies.relaunch).not.toHaveBeenCalled();
  });

  it('关库失败 → MIGRATE_FAILED（库仍可用），清理预建目录、不重启', () => {
    const { deps, targetDir, spies } = makeDeps({
      closeDatabase: () => {
        throw new Error('SQLITE_BUSY');
      },
    });
    try {
      changeDataDir(deps, targetDir);
      expect.unreachable('应抛出 MIGRATE_FAILED');
    } catch (e) {
      expect((e as AppError).code).toBe(E_STORAGE_MIGRATE_FAILED);
    }
    expect(existsSync(path.join(targetDir, 'LearningText'))).toBe(false);
    expect(spies.writePointer).not.toHaveBeenCalled();
    expect(spies.relaunch).not.toHaveBeenCalled();
  });

  it('复制中途失败 → 清理残留 + 不写指针 + 照常重启（旧指针完好，spec D9）', () => {
    let copyCalls = 0;
    const failingFs: DataDirMigrationFs = {
      ...dataDirMigrationFs,
      copyFileSync: (src, dest) => {
        copyCalls += 1;
        // 首个 copy（db 文件）成功，第二个（settings 文件）失败——模拟复制中途 IO 错误
        if (copyCalls >= 2) throw new Error('EIO');
        dataDirMigrationFs.copyFileSync(src, dest);
      },
    };
    const { deps, targetDir, spies } = makeDeps({ fs: failingFs });
    changeDataDir(deps, targetDir);
    expect(existsSync(path.join(targetDir, 'LearningText'))).toBe(false);
    expect(spies.writePointer).not.toHaveBeenCalled();
    expect(spies.relaunch).toHaveBeenCalledTimes(1);
  });
});
