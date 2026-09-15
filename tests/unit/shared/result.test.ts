// Result DTO 是宪法 A.7-3 规定的跨进程错误载体
import { describe, expect, it } from 'vitest';
import { err, ok } from '../../../src/shared/result';

describe('Result DTO 构造器', () => {
  it('ok 包装成功值并保持 ok 标记', () => {
    const r = ok({ pong: true });
    expect(r).toEqual({ ok: true, value: { pong: true } });
  });

  it('err 携带业务错误码与用户可读消息', () => {
    const r = err('E_X', '失败原因');
    expect(r).toEqual({ ok: false, error: { code: 'E_X', message: '失败原因' } });
  });

  it('成功与失败分支可按可辨识联合收窄', () => {
    const r = ok(1);
    if (r.ok) {
      expect(r.value).toBe(1);
    } else {
      expect.unreachable('不应进入失败分支');
    }
  });
});
