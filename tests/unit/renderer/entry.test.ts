// @vitest-environment jsdom
// 入口装配测试：覆盖 main.tsx 全部语句，防止入口文件拖垮覆盖率门禁
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';

describe('渲染入口装配', () => {
  beforeEach(() => {
    vi.resetModules();
    // M3 起 App 挂载 Workspace：挂载期即拉取设置/根列表并订阅广播；M6 壳层装配另需
    // countNodes（状态栏文档计数）与 platform（TitleBar 平台差异）桥成员
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
        listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
        onVfsChanged: vi.fn(() => () => undefined),
        // 导入进度订阅（M5 批次⑥ Task 12）：Workspace 挂载即订阅
        onIoProgress: vi.fn(() => () => undefined),
        countNodes: vi.fn(() => Promise.resolve({ ok: true, value: 0 })),
        // 数据目录信息（②批次起 Workspace 挂载期拉取，供树栏保存路径小字）
        getDataDirInfo: vi.fn(() =>
          Promise.resolve({
            ok: true,
            value: {
              root: 'D:/lt-user-data/LearningText',
              dbFile: 'D:/lt-user-data/LearningText/learningtext.db',
              backupsDir: 'D:/lt-user-data/LearningText/backups',
              settingsFile: 'D:/lt-user-data/LearningText/settings/settings.json',
              custom: false,
            },
          }),
        ),
        // M9 更新域与粘贴导入桩（FR-UPDATE-01/FR-IO-03）：状态首拉返回 idle、订阅退订空函数；
        // 粘贴导入默认空清单（kind:'empty'，非错误）
        importFromClipboard: vi.fn(() => Promise.resolve({ ok: true, value: { kind: 'empty' } })),
        getUpdateState: vi.fn(() =>
          Promise.resolve({ ok: true, value: { kind: 'idle', currentVersion: '0.0.0' } }),
        ),
        onUpdateState: vi.fn(() => () => undefined),

        platform: 'win32',
        getNode: vi.fn(() =>
          Promise.resolve({
            ok: true,
            value: {
              id: 2,
              parentId: 1,
              nodeType: 'file',
              name: 'x.html',
              virtualPath: '/x.html',
              mimeType: 'text/html',
              size: 0,
              createdAt: '',
              updatedAt: '',
            },
          }),
        ),
        onShellCommand: vi.fn(() => () => undefined),
        forceClose: vi.fn(() => Promise.resolve({ ok: true, value: null })),
      },
    });
  });

  it('#root 存在时完成 React 挂载', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../../../src/renderer/src/main.tsx');
    // React 19 并发挂载经调度器异步提交，让出一个宏任务等待挂载完成再断言
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('h1')?.textContent).toBe('LearningText');
  });

  it('#root 缺失时抛错（fail-fast）', async () => {
    document.body.innerHTML = '';
    await expect(import('../../../src/renderer/src/main.tsx')).rejects.toThrow('#root');
  });
});
