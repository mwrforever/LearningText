// 可抛出的 AppError（宪法 A.7-3 服务层传播载体）：验证 code/name/继承契约
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/shared/result';

describe('AppError 可抛出业务错误', () => {
  it('携带业务错误码与中文消息，且是 Error 子类', () => {
    const error = new AppError('E_VFS_NOT_FOUND', '节点不存在');
    expect(error.code).toBe('E_VFS_NOT_FOUND');
    expect(error.message).toBe('节点不存在');
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('可被 throw 并在 catch 中按 instanceof 收窄取回 code 与 message', () => {
    // 模拟服务层内部传播：throw 后由调用方收窄并转 Result DTO（A.7-3）
    const read = (): { code: string; message: string } => {
      throw new AppError('E_STORE_BUSY', '数据库忙，请稍后重试');
    };
    try {
      read();
      expect.unreachable('应抛出 AppError');
    } catch (e) {
      if (e instanceof AppError) {
        expect(e.code).toBe('E_STORE_BUSY');
        expect(e.message).toBe('数据库忙，请稍后重试');
      } else {
        expect.unreachable('捕获的应是 AppError');
      }
    }
  });
});
