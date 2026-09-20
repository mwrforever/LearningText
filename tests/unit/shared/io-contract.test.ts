// 导入域 IPC 契约单元测试（M5 批次⑥ Task 12）：ImportRequestSchema strictObject 全分支
// （合法 / 多余字段拒 / 空源清单拒 / 空串路径拒 / 非 int 目标拒 / 非法策略拒），
// 取消与目录选择请求 schema 边界。校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD（A.7-5）。
import { describe, expect, it } from 'vitest';
import {
  ImportRequestSchema,
  IoCancelRequestSchema,
  IoPickDirectoryRequestSchema,
} from '../../../src/shared/io-contract';

describe('ImportRequestSchema', () => {
  it('合法载荷（源路径数组 + int 目标父 + 枚举策略）解析通过且字段逐字保留', () => {
    const parsed = ImportRequestSchema.safeParse({
      sourcePaths: ['D:/notes', 'D:/pics'],
      targetParentId: 1,
      conflict: 'rename',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        sourcePaths: ['D:/notes', 'D:/pics'],
        targetParentId: 1,
        conflict: 'rename',
      });
    }
  });

  it('strictObject：多余字段一律拒（禁万能载荷，宪法 A.7-2）', () => {
    const parsed = ImportRequestSchema.safeParse({
      sourcePaths: ['D:/notes'],
      targetParentId: 1,
      conflict: 'skip',
      importId: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it('空源清单与空串路径均拒（sourcePaths min(1) 双闸）', () => {
    expect(
      ImportRequestSchema.safeParse({ sourcePaths: [], targetParentId: 1, conflict: 'skip' })
        .success,
    ).toBe(false);
    expect(
      ImportRequestSchema.safeParse({ sourcePaths: [''], targetParentId: 1, conflict: 'skip' })
        .success,
    ).toBe(false);
  });

  it('非整数目标父 id 与枚举外策略均拒', () => {
    expect(
      ImportRequestSchema.safeParse({
        sourcePaths: ['D:/notes'],
        targetParentId: 1.5,
        conflict: 'skip',
      }).success,
    ).toBe(false);
    expect(
      ImportRequestSchema.safeParse({
        sourcePaths: ['D:/notes'],
        targetParentId: 1,
        conflict: 'merge',
      }).success,
    ).toBe(false);
  });
});

describe('IoCancelRequestSchema', () => {
  it('合法 importId 通过；非整数与非数值载荷拒', () => {
    expect(IoCancelRequestSchema.safeParse({ importId: 3 }).success).toBe(true);
    expect(IoCancelRequestSchema.safeParse({ importId: 1.5 }).success).toBe(false);
    expect(IoCancelRequestSchema.safeParse({ importId: '1' }).success).toBe(false);
    expect(IoCancelRequestSchema.safeParse({ importId: 3, extra: true }).success).toBe(false);
  });
});

describe('IoPickDirectoryRequestSchema', () => {
  it('multiple 布尔开关通过；非布尔与多余字段拒（导入多选 / 导出单选共用通道）', () => {
    expect(IoPickDirectoryRequestSchema.safeParse({ multiple: true }).success).toBe(true);
    expect(IoPickDirectoryRequestSchema.safeParse({ multiple: false }).success).toBe(true);
    expect(IoPickDirectoryRequestSchema.safeParse({ multiple: 'yes' }).success).toBe(false);
    expect(IoPickDirectoryRequestSchema.safeParse({}).success).toBe(false);
  });
});
