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
  E_VFS_NOT_FOUND,
} from '../../../src/shared/errors';
import { AppError } from '../../../src/shared/result';
import type { NodeMeta, TrashedNodeMeta } from '../../../src/shared/vfs-contract';
import { registerIpcHandlers } from '../../../src/main/ipc';
import type { VfsService } from '../../../src/main/vfs/vfsService';
import type { SearchService } from '../../../src/main/search/searchService';
import type { SettingsService } from '../../../src/main/settings/settingsService';
import { DEFAULT_SETTINGS, type SettingsData } from '../../../src/shared/settings-contract';

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
    listTrashed: vi.fn(() => []),
    resolvePath: vi.fn(() => ({ nodeId: 2 })),
    getNode: vi.fn(() => ({ id: 2, parentId: 1 })),
  } as unknown as VfsService;
}

// 搜索服务桩：query 可注入返回值/抛错（vi.fn 与接口测试期适配）
function makeSearchStub(): SearchService {
  return {
    query: vi.fn(() => ({ hits: [], total: 0, truncated: false })),
  } as unknown as SearchService;
}

// 设置服务桩：get 返回默认、set 回显（vi.fn 接口测试期适配）
function makeSettingsStub(): SettingsService {
  return {
    get: vi.fn(() => DEFAULT_SETTINGS),
    set: vi.fn((d: SettingsData) => d),
  } as unknown as SettingsService;
}

describe('system:ping 入口校验', () => {
  beforeEach(() => {
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
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
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
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
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
    handlers.get(IPC.vfsCreate)?.(fakeEvent('app://bundle'), {
      parentId: 1,
      name: 'a.html',
      nodeType: 'file',
    });
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ rev: expect.any(Number), event: { type: 'created', node } }),
    );
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
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
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
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
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
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });

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
    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ rev: expect.any(Number), event: { type: 'written', node } }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        rev: expect.any(Number),
        event: { type: 'renamed', nodeId: 5, affectedCount: 3 },
      }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        rev: expect.any(Number),
        event: { type: 'moved', nodeId: 5, affectedCount: 3 },
      }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        rev: expect.any(Number),
        event: { type: 'trashed', nodeId: 5, affectedCount: 3 },
      }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ rev: expect.any(Number), event: { type: 'restored', node } }),
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        rev: expect.any(Number),
        event: { type: 'purged', nodeId: 5, purgedCount: 3 },
      }),
    );
    expect(broadcast).toHaveBeenCalledTimes(6);
  });
});

// search:query 两道校验 + Result 转换 + 不广播（spec §1/§7.3）
describe('search 通道接线', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('search:query 合法请求透传服务结果；非法载荷 E_IPC_BAD_PAYLOAD', () => {
    const search = makeSearchStub();
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search,
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
    const okResult = handlers.get(IPC.searchQuery)?.(fakeEvent('app://bundle'), {
      keyword: '指数',
    }) as { ok: boolean };
    expect(okResult).toEqual({ ok: true, value: { hits: [], total: 0, truncated: false } });
    const badResult = handlers.get(IPC.searchQuery)?.(fakeEvent('app://bundle'), {}) as {
      ok: boolean;
      error: { code: string };
    };
    expect(badResult.ok).toBe(false);
    expect(badResult.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });

  it('非白名单 origin 拒绝；服务抛 AppError 保真为 err 且全程不广播', () => {
    const search = makeSearchStub();
    (search.query as ReturnType<typeof vi.fn>).mockImplementation(() => {
      // 抛出形态对齐 vfs 通道 isMock 先例：真正的 AppError 实例，handleWith 按 instanceof 转换
      throw Object.assign(new AppError('E_VFS_NOT_FOUND', '子树过滤路径不存在或已在回收站'), {
        isMock: true,
      });
    });
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search,
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
    const forbidden = handlers.get(IPC.searchQuery)?.(fakeEvent('http://evil'), {
      keyword: 'x',
    }) as { ok: boolean; error: { code: string } };
    // M2 deferred 顺手清：origin 拒绝补 ok === false 断言（Result 失败分支语义完整）
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
    const errResult = handlers.get(IPC.searchQuery)?.(fakeEvent('app://bundle'), {
      keyword: 'x',
    }) as { ok: boolean; error: { code: string } };
    expect(errResult.error).toEqual({
      code: 'E_VFS_NOT_FOUND',
      message: '子树过滤路径不存在或已在回收站',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// settings 两通道两道校验 + Result 转换 + 不广播（spec §5/§8）
describe('settings 通道接线', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('settings:get 返回服务缓存；null 外载荷 E_IPC_BAD_PAYLOAD', () => {
    const settings = makeSettingsStub();
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings,
      broadcast,
      requestClose: vi.fn(),
    });
    const ok = handlers.get(IPC.settingsGet)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
      value: unknown;
    };
    expect(ok).toEqual({ ok: true, value: DEFAULT_SETTINGS });
    const bad = handlers.get(IPC.settingsGet)?.(fakeEvent('app://bundle'), {}) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });

  it('settings:set 合法全量写入；越界 debounceMs 拒且不广播', () => {
    const settings = makeSettingsStub();
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings,
      broadcast,
      requestClose: vi.fn(),
    });
    // M4 起 settings schema 为 v2：合法载荷以出厂默认为底、仅改写 debounceMs
    const r = handlers.get(IPC.settingsSet)?.(fakeEvent('app://bundle'), {
      ...DEFAULT_SETTINGS,
      preview: { debounceMs: 1500 },
    }) as { ok: boolean; value: { preview: { debounceMs: number } } };
    expect(r.value.preview.debounceMs).toBe(1500);
    const bad = handlers.get(IPC.settingsSet)?.(fakeEvent('app://bundle'), {
      ...DEFAULT_SETTINGS,
      preview: { debounceMs: 99 },
    }) as { ok: boolean; error: { code: string } };
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// vfs:get 通道：单节点反查（rename/move 后 meta 新鲜化基座，M4 spec §6.1）
describe('vfs:get 通道接线', () => {
  it('getNode 命中返回 NodeMeta；未找到透传 E_VFS_NOT_FOUND', () => {
    handlers.clear();
    const vfs = makeVfsStub();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
    });
    // 桩返回服务层 NodeMeta（Result 包装由 handleWith 统一完成，同既有桩形态）
    const meta: NodeMeta = {
      id: 2,
      parentId: 1,
      nodeType: 'file',
      name: 'a.html',
      virtualPath: '/a.html',
      mimeType: 'text/html',
      size: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    vfs.getNode = vi.fn(() => meta);
    const ok = handlers.get(IPC.vfsGet)?.(fakeEvent('app://bundle'), { nodeId: 2 }) as {
      ok: boolean;
      value: { id: number };
    };
    expect(ok.ok).toBe(true);
    expect(ok.value.id).toBe(2);
    // 未找到：服务层抛 AppError，handler 转换为 err(E_VFS_NOT_FOUND) 保真透传
    vfs.getNode = vi.fn(() => {
      throw new AppError(E_VFS_NOT_FOUND, '不存在');
    });
    const miss = handlers.get(IPC.vfsGet)?.(fakeEvent('app://bundle'), { nodeId: 99 }) as {
      ok: boolean;
      error: { code: string };
    };
    expect(miss.ok).toBe(false);
    expect(miss.error.code).toBe(E_VFS_NOT_FOUND);
  });
});

// vfs:list-trashed 通道（M5 批次②）：无参通道 null 载荷照 settingsGet 先例；纯读无写事务不广播
describe('vfs:list-trashed 通道接线', () => {
  it('合法 null 载荷透传服务列表；非 null 载荷 E_IPC_BAD_PAYLOAD；非白名单 origin 拒绝；全程不广播', () => {
    handlers.clear();
    const vfs = makeVfsStub();
    const trashed: TrashedNodeMeta[] = [
      {
        meta: {
          id: 5,
          parentId: 1,
          nodeType: 'file',
          name: 'a.html',
          virtualPath: '/a.html',
          mimeType: 'text/html',
          size: 1,
          createdAt: 't',
          updatedAt: 't',
        },
        deletedAt: '2026-09-21T09:30:00.000+08:00',
      },
    ];
    vfs.listTrashed = vi.fn(() => trashed);
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
    const ok = handlers.get(IPC.vfsListTrashed)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
      value: unknown;
    };
    expect(ok).toEqual({ ok: true, value: trashed });
    const bad = handlers.get(IPC.vfsListTrashed)?.(fakeEvent('app://bundle'), {}) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    const forbidden = handlers.get(IPC.vfsListTrashed)?.(fakeEvent('http://evil'), null) as {
      ok: boolean;
    };
    expect(forbidden.ok).toBe(false);
    // 纯读通道不产生变更事件 → 不广播（宪法 B.3-4 广播仅随写事务）
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// shell:force-close：guard 放行唯一通道（M4 spec §2.3）
describe('shell:force-close 接线', () => {
  it('payload 非 null 拒 E_IPC_BAD_PAYLOAD；合法调用转发 deps.requestClose', () => {
    handlers.clear();
    const requestClose = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose,
    });
    const bad = handlers.get(IPC.shellForceClose)?.(fakeEvent('app://bundle'), { x: 1 }) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    const ok = handlers.get(IPC.shellForceClose)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
    };
    expect(ok.ok).toBe(true);
    expect(requestClose).toHaveBeenCalledTimes(1);
  });
});

// 广播载荷 rev 包装（M3 spec §4.2 防撕裂）：rev 取自主进程写事务版本计数器
describe('广播版本号 rev', () => {
  it('广播载荷为 { rev, event } 包装且 rev 取自事务层（spec §4.2）', () => {
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
    });
    handlers.get(IPC.vfsWrite)?.(fakeEvent('app://bundle'), {
      nodeId: 2,
      content: new Uint8Array([104, 105]),
    });
    const arg = broadcast.mock.calls[0]?.[0] as { rev: number; event: { type: string } };
    expect(typeof arg.rev).toBe('number');
    expect(arg.event.type).toBe('written');
  });
});
