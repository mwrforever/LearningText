// @vitest-environment jsdom
// 渲染层组件测试按宪法 A.6-2 仅此处用 jsdom，按需最小化
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';
import { App } from '../../../src/renderer/src/App';

describe('App 根组件', () => {
  it('渲染 LearningText 标题（E2E 断言锚点，M6 起由 TitleBar 承载）', () => {
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
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<App />);
    });
    expect(container.querySelector('h1')?.textContent).toBe('LearningText');
  });
});
