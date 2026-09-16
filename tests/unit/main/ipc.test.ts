// IPC 入口两道校验的单元测试：origin 白名单（B.5-6）+ zod 载荷校验（A.7-5）
// vfs 通道组另覆盖 Result 转换（AppError 保真 / E_STORE_INTERNAL 兜底）与
// 广播时机（事务提交后语义，宪法 B.3-4）。
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
import {
  E_IPC_BAD_PAYLOAD,
  E_IPC_FORBIDDEN_ORIGIN,
  E_STORE_INTERNAL,
} from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';
import { registerIpcHandlers } from '../../../src/main/ipc';
import type { VfsService } from '../../../src/main/vfs/vfsService';

function fakeEvent(origin: string | null): { senderFrame: { origin: string | null } | null } {
  return origin === '__null__' ? { senderFrame: null } : { senderFrame: { origin } };
}

// vfs 服务桩：方法可注入返回值/抛错（vi.fn 桩与接口的测试期适配）
function makeVfsStub(): VfsService {
  return {
    listChildren: vi.fn(() => []),
    createNode: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    renameNode: vi.fn(),
    moveNode: vi.fn(),
    trashNode: vi.fn(),
    restoreNode: vi.fn(),
    purgeNode: vi.fn(),
    resolvePath: vi.fn(() => ({ nodeId: 2 })),
  } as unknown as VfsService;
}

describe('system:ping 入口校验', () => {
  beforeEach(() => {
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      broadcast: vi.fn(),
    });
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

  it('senderFrame.origin 为 null → E_IPC_FORBIDDEN_ORIGIN', () => {
    const r = handlers.get(IPC.systemPing)?.(fakeEvent(null), null) as {
      ok: boolean;
      error: { code: string };
    };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
  });

  it('origin 为空字符串 → E_IPC_FORBIDDEN_ORIGIN', () => {
    const r = handlers.get(IPC.systemPing)?.(fakeEvent(''), null) as {
      ok: boolean;
      error: { code: string };
    };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
  });
});

// vfs 通道两道校验 + Result 转换 + 广播时机（宪法 B.5-6/A.7-3/B.3-4）
describe('vfs 通道接线', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('vfs:resolve 合法请求 → ok；非法载荷 → E_IPC_BAD_PAYLOAD', () => {
    const vfs = makeVfsStub();
    const broadcast = vi.fn();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'], vfs, broadcast });
    const okResult = handlers.get(IPC.vfsResolve)?.(fakeEvent('app://bundle'), {
      virtualPath: '/a',
    }) as {
      ok: boolean;
    };
    expect(okResult).toEqual({ ok: true, value: { nodeId: 2 } });
    const badResult = handlers.get(IPC.vfsResolve)?.(fakeEvent('app://bundle'), { nope: 1 }) as {
      ok: boolean;
      error: { code: string };
    };
    expect(badResult.ok).toBe(false);
    expect(badResult.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });

  it('vfs:create 成功后广播 created（事务提交后语义：服务返回后才广播）', () => {
    const node = {
      id: 5,
      parentId: 1,
      nodeType: 'file',
      name: 'a.html',
      virtualPath: '/a.html',
      mimeType: 'text/html',
      size: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    const vfs = makeVfsStub();
    (vfs.createNode as ReturnType<typeof vi.fn>).mockReturnValue(node);
    const broadcast = vi.fn();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'], vfs, broadcast });
    handlers.get(IPC.vfsCreate)?.(fakeEvent('app://bundle'), {
      parentId: 1,
      name: 'a.html',
      nodeType: 'file',
    });
    expect(broadcast).toHaveBeenCalledWith({ type: 'created', node });
  });

  it('服务抛 AppError → err(code, message)；非 AppError → err(E_STORE_INTERNAL)；失败路径不广播', () => {
    const vfs = makeVfsStub();
    (vfs.createNode as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // 必须抛真正的 AppError 实例：handleWith 按 instanceof 分支转换 Result
      throw Object.assign(new AppError('E_VFS_DUPLICATE_NAME', '同名'), { isMock: true });
    });
    (vfs.listChildren as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('意外错误');
    });
    const broadcast = vi.fn();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'], vfs, broadcast });
    const dup = handlers.get(IPC.vfsCreate)?.(fakeEvent('app://bundle'), {
      parentId: 1,
      name: 'x',
      nodeType: 'dir',
    }) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(dup.ok).toBe(false);
    expect(dup.error).toEqual({ code: 'E_VFS_DUPLICATE_NAME', message: '同名' });
    const unknown = handlers.get(IPC.vfsList)?.(fakeEvent('app://bundle'), { parentId: 1 }) as {
      error: { code: string };
    };
    expect(unknown.error.code).toBe(E_STORE_INTERNAL);
    // 广播仅发生在服务调用成功之后：失败路径一律不广播（宪法 B.3-4）
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('非白名单 origin 对 vfs 通道同样拒绝', () => {
    const broadcast = vi.fn();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'], vfs: makeVfsStub(), broadcast });
    const r = handlers.get(IPC.vfsList)?.(fakeEvent('http://evil'), { parentId: 1 }) as {
      ok: boolean;
    };
    expect(r.ok).toBe(false);
  });

  it('读写/重构/软删通道成功路径：Result 透传且广播事件判别字段与 VfsChangedEvent 一一对应', () => {
    const node = {
      id: 5,
      parentId: 1,
      nodeType: 'file',
      name: 'a.html',
      virtualPath: '/a.html',
      mimeType: 'text/html',
      size: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    const affected = { affectedCount: 3 };
    const vfs = makeVfsStub();
    (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
      content: new Uint8Array([1, 2]),
      meta: node,
    });
    (vfs.writeFile as ReturnType<typeof vi.fn>).mockReturnValue(node);
    (vfs.renameNode as ReturnType<typeof vi.fn>).mockReturnValue(affected);
    (vfs.moveNode as ReturnType<typeof vi.fn>).mockReturnValue(affected);
    (vfs.trashNode as ReturnType<typeof vi.fn>).mockReturnValue(affected);
    (vfs.restoreNode as ReturnType<typeof vi.fn>).mockReturnValue(node);
    (vfs.purgeNode as ReturnType<typeof vi.fn>).mockReturnValue(affected);
    const broadcast = vi.fn();
    registerIpcHandlers({ allowedOrigins: ['app://bundle'], vfs, broadcast });

    const read = handlers.get(IPC.vfsRead)?.(fakeEvent('app://bundle'), { nodeId: 5 }) as {
      ok: boolean;
    };
    const write = handlers.get(IPC.vfsWrite)?.(fakeEvent('app://bundle'), {
      nodeId: 5,
      content: new Uint8Array([9]),
    }) as { ok: boolean };
    const rename = handlers.get(IPC.vfsRename)?.(fakeEvent('app://bundle'), {
      nodeId: 5,
      newName: 'b.html',
    }) as { ok: boolean };
    const move = handlers.get(IPC.vfsMove)?.(fakeEvent('app://bundle'), {
      nodeId: 5,
      targetDirId: 1,
    }) as { ok: boolean };
    const trash = handlers.get(IPC.vfsTrash)?.(fakeEvent('app://bundle'), { nodeId: 5 }) as {
      ok: boolean;
    };
    const restore = handlers.get(IPC.vfsRestore)?.(fakeEvent('app://bundle'), { nodeId: 5 }) as {
      ok: boolean;
    };
    const purge = handlers.get(IPC.vfsPurge)?.(fakeEvent('app://bundle'), { nodeId: 5 }) as {
      ok: boolean;
    };
    expect([read, write, rename, move, trash, restore, purge].map((r) => r.ok)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    // 事件形态逐一对应契约判别字段；vfs:read 无变更事件，总计广播 6 次
    expect(broadcast).toHaveBeenNthCalledWith(1, { type: 'written', node });
    expect(broadcast).toHaveBeenNthCalledWith(2, { type: 'renamed', nodeId: 5, affectedCount: 3 });
    expect(broadcast).toHaveBeenNthCalledWith(3, { type: 'moved', nodeId: 5, affectedCount: 3 });
    expect(broadcast).toHaveBeenNthCalledWith(4, { type: 'trashed', nodeId: 5, affectedCount: 3 });
    expect(broadcast).toHaveBeenNthCalledWith(5, { type: 'restored', node });
    expect(broadcast).toHaveBeenNthCalledWith(6, { type: 'purged', nodeId: 5, purgedCount: 3 });
    expect(broadcast).toHaveBeenCalledTimes(6);
  });
});
