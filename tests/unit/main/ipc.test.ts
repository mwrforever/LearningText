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
  E_BACKUP_CORRUPT,
  E_IO_SOURCE_NOT_FOUND,
  E_IO_TARGET_UNWRITABLE,
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
import type { BackupService } from '../../../src/main/backup/backupService';
import type { ImportService } from '../../../src/main/io/importService';
import type { ExportService } from '../../../src/main/io/exportService';
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
    countNodes: vi.fn(() => 3),
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

// 备份服务桩（M5 批次③）：create/list 可注入返回值（vi.fn 接口测试期适配）
function makeBackupStub(): BackupService {
  return {
    create: vi.fn(() => ({ fileName: 'lt-20260921-080000.db' })),
    list: vi.fn(() => []),
    restore: vi.fn(),
    autoBackupIfNeeded: vi.fn(),
  } as unknown as BackupService;
}

// 导入服务桩（M5 批次⑥）：importNodes/cancel 可注入返回值（vi.fn 接口测试期适配，
// `as unknown as` 与 makeVfsStub 同款测试期适配先例）
function makeIoStub(): ImportService {
  return {
    importNodes: vi.fn(() => Promise.resolve({ imported: 1, skipped: 0, failed: 0 })),
    cancel: vi.fn(),
  } as unknown as ImportService;
}

// 目录选择供给桩（M5 批次⑥，Task 13 复用）：可编程返回路径数组
function makePickStub(): (allowMultiple: boolean) => Promise<readonly string[]> {
  return vi.fn(() => Promise.resolve(['D:/picked']));
}

// 导出服务桩（M5 批次⑥ Task 13）：exportNodes 可注入返回值（vi.fn 接口测试期适配先例同款）
function makeExportStub(): ExportService {
  return {
    exportNodes: vi.fn(() =>
      Promise.resolve({ exported: 1, rewritten: 0, missing: 0, skipped: 0, failed: 0 }),
    ),
  } as unknown as ExportService;
}

// 打开目录供给桩（M5 批次⑥ Task 13）：openDirectoryInShell 默认成功（shell.openPath 返回空串语义）
function makeOpenPathStub(): (dir: string) => Promise<void> {
  return vi.fn(() => Promise.resolve());
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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

  it('settings:set 前后 appearance.theme 变化 → onAppearanceThemeChange 恰一次且携带新意图（M6 主题联动）', () => {
    const onAppearanceThemeChange = vi.fn();
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange,
    });
    const r = handlers.get(IPC.settingsSet)?.(fakeEvent('app://bundle'), {
      ...DEFAULT_SETTINGS,
      appearance: { theme: 'dark', editorFontSize: 14 },
    }) as { ok: boolean };
    expect(r.ok).toBe(true); // 旧值 system → 新值 dark：联动触发
    expect(onAppearanceThemeChange).toHaveBeenCalledTimes(1);
    expect(onAppearanceThemeChange).toHaveBeenCalledWith('dark');
  });

  it('settings:set 主题未变化 → 不触发 onAppearanceThemeChange（等值写零联动）', () => {
    const onAppearanceThemeChange = vi.fn();
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange,
    });
    // DEFAULT_SETTINGS.appearance.theme 即服务桩缓存中的 'system'：等值写不得触发
    const r = handlers.get(IPC.settingsSet)?.(fakeEvent('app://bundle'), {
      ...DEFAULT_SETTINGS,
      preview: { debounceMs: 900 },
    }) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(onAppearanceThemeChange).not.toHaveBeenCalled();
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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

// vfs:count 通道（M6 spec §2.6 状态栏文档计数）：无参通道 null 载荷照 settingsGet 先例；
// 纯读无写事务不广播
describe('vfs:count 通道接线', () => {
  it('合法 null 载荷透传服务 countNodes 数值；非 null 载荷 E_IPC_BAD_PAYLOAD；非白名单 origin 拒绝；不广播', () => {
    handlers.clear();
    const vfs = makeVfsStub();
    const broadcast = vi.fn();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs,
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast,
      requestClose: vi.fn(),
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
    });
    const ok = handlers.get(IPC.vfsCount)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
      value: number;
    };
    expect(ok).toEqual({ ok: true, value: 3 });
    expect(vfs.countNodes).toHaveBeenCalledTimes(1);
    const bad = handlers.get(IPC.vfsCount)?.(fakeEvent('app://bundle'), { x: 1 }) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    const forbidden = handlers.get(IPC.vfsCount)?.(fakeEvent('http://evil'), null) as {
      ok: boolean;
    };
    expect(forbidden.ok).toBe(false);
    // 纯读通道不产生变更事件 → 不广播（宪法 B.3-4）
    expect(broadcast).not.toHaveBeenCalled();
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
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

// 备份三通道（M5 批次③ Task 9）：create/list 走服务透传，restore 走 app 层编排闭包
// （关库 → 服务替换）+ requestRelaunch；create/list/restore 均无 vfs 写事务 → 不广播
describe('backup 通道接线', () => {
  interface BackupDeps {
    backup: BackupService;
    restoreBackup: (fileName: string) => void;
    requestRelaunch: () => void;
  }

  function registerWith(overrides: Partial<BackupDeps> = {}): BackupDeps {
    const deps: BackupDeps = {
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      ...overrides,
    };
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
      backup: deps.backup,
      restoreBackup: deps.restoreBackup,
      requestRelaunch: deps.requestRelaunch,
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
    });
    return deps;
  }

  it('backup:create 无参载荷透传服务；非法载荷 E_IPC_BAD_PAYLOAD；不广播', () => {
    registerWith();
    const ok = handlers.get(IPC.backupCreate)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
      value: { fileName: string };
    };
    expect(ok).toEqual({ ok: true, value: { fileName: 'lt-20260921-080000.db' } });
    const bad = handlers.get(IPC.backupCreate)?.(fakeEvent('app://bundle'), { x: 1 }) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });

  it('backup:list 无参载荷透传服务列表；非白名单 origin 拒绝', () => {
    const entries = [
      {
        fileName: 'lt-20260921-080000.db',
        sizeBytes: 8,
        modifiedAt: '2026-09-21T08:00:00.000+08:00',
      },
    ];
    const backup = makeBackupStub();
    (backup.list as ReturnType<typeof vi.fn>).mockReturnValue(entries);
    registerWith({ backup });
    const ok = handlers.get(IPC.backupList)?.(fakeEvent('app://bundle'), null) as {
      ok: boolean;
      value: unknown;
    };
    expect(ok).toEqual({ ok: true, value: entries });
    const forbidden = handlers.get(IPC.backupList)?.(fakeEvent('http://evil'), null) as {
      ok: boolean;
    };
    expect(forbidden.ok).toBe(false);
  });

  it('backup:restore 合法请求：先 app 层编排（关库+替换）后 relaunch，响应 { relaunch: true }', () => {
    const order: string[] = [];
    const deps = registerWith({
      restoreBackup: vi.fn((fileName: string) => {
        order.push(`restore:${fileName}`);
      }),
      requestRelaunch: vi.fn(() => {
        order.push('relaunch');
      }),
    });
    const ok = handlers.get(IPC.backupRestore)?.(fakeEvent('app://bundle'), {
      fileName: 'lt-20260921-080000.db',
    }) as { ok: boolean; value: { relaunch: boolean } };
    expect(ok).toEqual({ ok: true, value: { relaunch: true } });
    expect(deps.restoreBackup).toHaveBeenCalledWith('lt-20260921-080000.db');
    // 顺序契约：还原（数据覆盖）完成后才允许重启
    expect(order).toEqual(['restore:lt-20260921-080000.db', 'relaunch']);
  });

  it('backup:restore 非法载荷 E_IPC_BAD_PAYLOAD；业务错误码保真透传（E_BACKUP_CORRUPT）', () => {
    const deps = registerWith();
    const bad = handlers.get(IPC.backupRestore)?.(fakeEvent('app://bundle'), {}) as {
      ok: boolean;
      error: { code: string };
    };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    // 还原失败（如备份损坏）不得触发 relaunch：错误经 Result 到达渲染层
    (deps.restoreBackup as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new AppError(E_BACKUP_CORRUPT, '备份文件已损坏，无法还原');
    });
    registerWith({ restoreBackup: deps.restoreBackup });
    const corrupt = handlers.get(IPC.backupRestore)?.(fakeEvent('app://bundle'), {
      fileName: 'lt-20260920-080000.db',
    }) as { ok: boolean; error: { code: string; message: string } };
    expect(corrupt.ok).toBe(false);
    expect(corrupt.error).toEqual({ code: E_BACKUP_CORRUPT, message: '备份文件已损坏，无法还原' });
    expect(deps.requestRelaunch).not.toHaveBeenCalled();
  });
});

// 导入域三通道（M5 批次⑥ Task 12）：io:import 异步长任务（AppError 保真 / E_STORE_INTERNAL 兜底）、
// io:cancel 按 importId 寻址、io:pick-directory 主进程目录选择供给；三通道均无 vfs 写事务 → 不广播
// Task 13 追加：io:export 与 shell:open-path 同入本组（目录白名单登记簿两道校验同型）
describe('io 通道接线', () => {
  interface IoDeps {
    io: ImportService;
    pickDirectories: (allowMultiple: boolean) => Promise<readonly string[]>;
    export: ExportService;
    dialogProducedDirs: ReadonlySet<string>;
    openDirectoryInShell: (dir: string) => Promise<void>;
    onAppearanceThemeChange: (intent: 'light' | 'dark' | 'system') => void;
  }

  function registerWith(overrides: Partial<IoDeps> = {}): IoDeps {
    const deps: IoDeps = {
      io: makeIoStub(),
      pickDirectories: makePickStub(),
      export: makeExportStub(),
      dialogProducedDirs: new Set(['D:/picked']),
      openDirectoryInShell: makeOpenPathStub(),
      onAppearanceThemeChange: vi.fn(),
      ...overrides,
    };
    handlers.clear();
    registerIpcHandlers({
      allowedOrigins: ['app://bundle'],
      vfs: makeVfsStub(),
      search: makeSearchStub(),
      settings: makeSettingsStub(),
      broadcast: vi.fn(),
      requestClose: vi.fn(),
      backup: makeBackupStub(),
      restoreBackup: vi.fn(),
      requestRelaunch: vi.fn(),
      io: deps.io,
      pickDirectories: deps.pickDirectories,
      export: deps.export,
      dialogProducedDirs: deps.dialogProducedDirs,
      openDirectoryInShell: deps.openDirectoryInShell,
      onAppearanceThemeChange: deps.onAppearanceThemeChange,
    });
    return deps;
  }

  it('io:import 合法载荷 await 服务结果 → ok(ImportResult)；非法载荷 E_IPC_BAD_PAYLOAD；不广播', async () => {
    const deps = registerWith();
    const ok = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; value: { imported: number } };
    expect(ok).toEqual({ ok: true, value: { imported: 1, skipped: 0, failed: 0 } });
    expect(deps.io.importNodes).toHaveBeenCalledWith({
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    });
    const bad = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: [],
    })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
  });

  it('io:import 登记簿内的源路径放行服务；登记外的串伪造拒绝（E_IPC_BAD_PAYLOAD）且服务不被调用', async () => {
    const deps = registerWith();
    const ok = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; value: { imported: number } };
    expect(ok).toEqual({ ok: true, value: { imported: 1, skipped: 0, failed: 0 } });
    expect(deps.io.importNodes).toHaveBeenCalledWith({
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    });

    // 伪造串（未登记）拒绝：与 io:export / shell:open-path 同形态统一错误
    const forged = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['C:/Windows/System32'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(forged.ok).toBe(false);
    expect(forged.error.code).toBe(E_IPC_BAD_PAYLOAD);
    expect(forged.error.message).toBe('导入源路径必须来自目录选择对话框');
    expect(deps.io.importNodes).toHaveBeenCalledTimes(1);

    // 多源清单混入单个未登记串：整单拒绝，服务不发起（登记校验针对每个 sourcePath）
    const mixed = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['D:/picked', 'D:/forged'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; error: { code: string } };
    expect(mixed.ok).toBe(false);
    expect(mixed.error.code).toBe(E_IPC_BAD_PAYLOAD);
    expect(deps.io.importNodes).toHaveBeenCalledTimes(1);
  });

  it('io:import 业务错误保真（E_IO_SOURCE_NOT_FOUND）；意外异常收敛 E_STORE_INTERNAL', async () => {
    const missingIo = makeIoStub();
    (missingIo.importNodes as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new AppError(E_IO_SOURCE_NOT_FOUND, '导入源路径不存在或不可读')),
    );
    registerWith({ io: missingIo });
    const missing = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(missing.ok).toBe(false);
    expect(missing.error).toEqual({
      code: E_IO_SOURCE_NOT_FOUND,
      message: '导入源路径不存在或不可读',
    });
    const crashIo = makeIoStub();
    (crashIo.importNodes as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error('意外崩溃')),
    );
    registerWith({ io: crashIo });
    const unknown = (await handlers.get(IPC.ioImport)?.(fakeEvent('app://bundle'), {
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; error: { code: string } };
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe(E_STORE_INTERNAL);
  });

  it('io:import 非白名单 origin 拒绝（异步包装与同步包装同两道校验，B.3-2）；服务不被调用', async () => {
    const deps = registerWith();
    const forbidden = (await handlers.get(IPC.ioImport)?.(fakeEvent('http://evil'), {
      sourcePaths: ['D:/picked'],
      targetParentId: 1,
      conflict: 'skip',
    })) as { ok: boolean; error: { code: string } };
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
    expect(deps.io.importNodes).not.toHaveBeenCalled();
  });

  it('io:cancel 合法请求转发服务 cancel(importId)；非法载荷 E_IPC_BAD_PAYLOAD；非白名单 origin 拒绝', async () => {
    const deps = registerWith();
    const ok = (await handlers.get(IPC.ioCancel)?.(fakeEvent('app://bundle'), {
      importId: 3,
    })) as { ok: boolean; value: null };
    expect(ok).toEqual({ ok: true, value: null });
    expect(deps.io.cancel).toHaveBeenCalledWith(3);
    const bad = (await handlers.get(IPC.ioCancel)?.(fakeEvent('app://bundle'), {})) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);
    const forbidden = (await handlers.get(IPC.ioCancel)?.(fakeEvent('http://evil'), {
      importId: 3,
    })) as { ok: boolean };
    expect(forbidden.ok).toBe(false);
  });

  it('io:pick-directory 透传 multiple 开关并返回路径数组；用户取消为空数组', async () => {
    const pick = vi.fn((allowMultiple: boolean) =>
      Promise.resolve(allowMultiple ? ['D:/a', 'D:/b'] : ['D:/single']),
    );
    registerWith({ pickDirectories: pick });
    const multi = (await handlers.get(IPC.ioPickDirectory)?.(fakeEvent('app://bundle'), {
      multiple: true,
    })) as { ok: boolean; value: readonly string[] };
    expect(multi).toEqual({ ok: true, value: ['D:/a', 'D:/b'] });
    expect(pick).toHaveBeenCalledWith(true);
    registerWith({ pickDirectories: vi.fn(() => Promise.resolve([])) });
    const canceled = (await handlers.get(IPC.ioPickDirectory)?.(fakeEvent('app://bundle'), {
      multiple: false,
    })) as { ok: boolean; value: readonly string[] };
    expect(canceled).toEqual({ ok: true, value: [] });
  });

  it('io:export 白名单登记簿内的目标目录放行服务；登记外的串伪造拒绝（E_IPC_BAD_PAYLOAD）且服务不被调用', async () => {
    const deps = registerWith();
    const ok = (await handlers.get(IPC.ioExport)?.(fakeEvent('app://bundle'), {
      nodeId: 7,
      targetDir: 'D:/picked',
    })) as { ok: boolean; value: { exported: number } };
    expect(ok).toEqual({
      ok: true,
      value: { exported: 1, rewritten: 0, missing: 0, skipped: 0, failed: 0 },
    });
    expect(deps.export.exportNodes).toHaveBeenCalledWith({ nodeId: 7, targetDir: 'D:/picked' });

    const forged = (await handlers.get(IPC.ioExport)?.(fakeEvent('app://bundle'), {
      nodeId: 7,
      targetDir: 'C:/Windows/System32',
    })) as { ok: boolean; error: { code: string } };
    expect(forged.ok).toBe(false);
    expect(forged.error.code).toBe(E_IPC_BAD_PAYLOAD);
    expect(deps.export.exportNodes).toHaveBeenCalledTimes(1);
  });

  it('io:export 非法载荷与非法 origin 拒绝；业务错误码保真透传', async () => {
    const deps = registerWith();
    const bad = (await handlers.get(IPC.ioExport)?.(fakeEvent('app://bundle'), {
      nodeId: 7,
    })) as { ok: boolean; error: { code: string } };
    expect(bad.ok).toBe(false);
    expect(bad.error.code).toBe(E_IPC_BAD_PAYLOAD);
    const forbidden = (await handlers.get(IPC.ioExport)?.(fakeEvent('http://evil'), {
      nodeId: 7,
      targetDir: 'D:/picked',
    })) as { ok: boolean; error: { code: string } };
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error.code).toBe(E_IPC_FORBIDDEN_ORIGIN);
    expect(deps.export.exportNodes).not.toHaveBeenCalled();

    const failing = makeExportStub();
    (failing.exportNodes as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new AppError(E_IO_TARGET_UNWRITABLE, '导出目标目录不可写或不存在')),
    );
    registerWith({ export: failing });
    const business = (await handlers.get(IPC.ioExport)?.(fakeEvent('app://bundle'), {
      nodeId: 7,
      targetDir: 'D:/picked',
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(business.ok).toBe(false);
    expect(business.error).toEqual({
      code: E_IO_TARGET_UNWRITABLE,
      message: '导出目标目录不可写或不存在',
    });
  });

  it('shell:open-path 登记簿内目录转发主进程打开；登记外拒绝；打开失败收敛 E_STORE_INTERNAL', async () => {
    const deps = registerWith();
    const ok = (await handlers.get(IPC.shellOpenPath)?.(fakeEvent('app://bundle'), {
      dir: 'D:/picked',
    })) as { ok: boolean; value: null };
    expect(ok).toEqual({ ok: true, value: null });
    expect(deps.openDirectoryInShell).toHaveBeenCalledWith('D:/picked');

    const forged = (await handlers.get(IPC.shellOpenPath)?.(fakeEvent('app://bundle'), {
      dir: 'C:/Users/forged',
    })) as { ok: boolean; error: { code: string } };
    expect(forged.ok).toBe(false);
    expect(forged.error.code).toBe(E_IPC_BAD_PAYLOAD);
    expect(deps.openDirectoryInShell).toHaveBeenCalledTimes(1);

    registerWith({
      openDirectoryInShell: vi.fn(() => Promise.reject(new Error('打开目录失败：目录已删除'))),
    });
    const failure = (await handlers.get(IPC.shellOpenPath)?.(fakeEvent('app://bundle'), {
      dir: 'D:/picked',
    })) as { ok: boolean; error: { code: string } };
    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe(E_STORE_INTERNAL);

    const bad = (await handlers.get(IPC.shellOpenPath)?.(fakeEvent('app://bundle'), {})) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);
  });
});
