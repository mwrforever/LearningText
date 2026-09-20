// 备份域 IPC 契约 schema 测试（宪法 A.7-5 单一来源）：请求/响应 DTO 的接受与拒绝边界。
import { describe, expect, it } from 'vitest';
import {
  BackupCreateResponseSchema,
  BackupRestoreRequestSchema,
  BackupRestoreResponseSchema,
  BackupEntrySchema,
} from '../../../src/shared/backup-contract';

describe('backup-contract zod schema', () => {
  it('BackupEntry 接受合法条目，拒绝负数字节数与缺失字段', () => {
    const entry = {
      fileName: 'lt-20260921-080000.db',
      sizeBytes: 1024,
      modifiedAt: '2026-09-21T08:00:00.000+08:00',
    };
    expect(BackupEntrySchema.safeParse(entry).success).toBe(true);
    expect(BackupEntrySchema.safeParse({ ...entry, sizeBytes: -1 }).success).toBe(false);
    expect(BackupEntrySchema.safeParse({ fileName: 'a.db', sizeBytes: 1 }).success).toBe(false);
  });

  it('BackupRestoreRequest 仅接受含 fileName 的严格对象（多余字段拒绝）', () => {
    expect(
      BackupRestoreRequestSchema.safeParse({ fileName: 'lt-20260921-080000.db' }).success,
    ).toBe(true);
    expect(BackupRestoreRequestSchema.safeParse({}).success).toBe(false);
    expect(
      BackupRestoreRequestSchema.safeParse({ fileName: 'lt-20260921-080000.db', extra: 1 }).success,
    ).toBe(false);
  });

  it('BackupCreateResponse 仅接受非空 fileName；BackupRestoreResponse 仅接受 relaunch:true', () => {
    expect(
      BackupCreateResponseSchema.safeParse({ fileName: 'lt-20260921-080000.db' }).success,
    ).toBe(true);
    expect(BackupCreateResponseSchema.safeParse({ fileName: '' }).success).toBe(false);
    expect(BackupRestoreResponseSchema.safeParse({ relaunch: true }).success).toBe(true);
    expect(BackupRestoreResponseSchema.safeParse({ relaunch: false }).success).toBe(false);
  });
});
