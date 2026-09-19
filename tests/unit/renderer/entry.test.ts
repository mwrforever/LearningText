// @vitest-environment jsdom
// 入口装配测试：覆盖 main.tsx 全部语句，防止入口文件拖垮覆盖率门禁
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/shared/settings-contract';

describe('渲染入口装配', () => {
  beforeEach(() => {
    vi.resetModules();
    // M3 起 App 挂载 Workspace：挂载期即拉取设置/根列表并订阅广播；M4 起设置契约升 v2，
    // 桥桩按挂载路径最小注入（getNode/onShellCommand/forceClose 为 M4 契约补员预留）
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        settingsGet: vi.fn(() => Promise.resolve({ ok: true, value: DEFAULT_SETTINGS })),
        listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
        onVfsChanged: vi.fn(() => () => undefined),
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
