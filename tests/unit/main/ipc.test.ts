// IPC 入口两道校验的单元测试：origin 白名单（B.5-6）+ zod 载荷校验（A.7-5）
import { describe, expect, it, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
}));

import { IPC } from '../../../src/shared/ipc';
import { E_IPC_BAD_PAYLOAD, E_IPC_FORBIDDEN_ORIGIN } from '../../../src/shared/errors';
import { registerIpcHandlers } from '../../../src/main/ipc';

function fakeEvent(origin: string): { senderFrame: { origin: string } | null } {
  return origin === '__null__' ? { senderFrame: null } : { senderFrame: { origin } };
}

describe('system:ping 入口校验', () => {
  beforeEach(() => {
    handlers.clear();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'] });
  });

  it('白名单 origin + 合法载荷 → ok(pong)', () => {
    const fn = handlers.get(IPC.systemPing);
    expect(fn).toBeDefined();
    const r = handlers.get(IPC.systemPing)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
    };
    expect(r).toEqual({ ok: true, value: { pong: true } });
  });

  it('非白名单 origin → E_IPC_FORBIDDEN_ORIGIN（senderFrame 为 null 同样拒绝）', () => {
    const r = handlers.get(IPC.systemPing)?.(fakeEvent('__null__'), null) as {
      ok: boolean;
      error: { code: string };
    };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
  });

  it('白名单 origin + 非法载荷 → E_IPC_BAD_PAYLOAD', () => {
    const r = handlers.get(IPC.systemPing)?.(fakeEvent('app://bundle'), 'bad') as {
      ok: boolean;
      error: { code: string };
    };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });
});
