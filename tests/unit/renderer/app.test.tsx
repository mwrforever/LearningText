// @vitest-environment jsdom
// 渲染层组件测试按宪法 A.6-2 仅此处用 jsdom，按需最小化
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '../../../src/renderer/src/App';

describe('App 根组件', () => {
  it('渲染 LearningText 标题（E2E 断言锚点）', () => {
    // M3 起 App 挂载 Workspace：挂载期即拉取设置/根列表并订阅广播，桥桩按挂载路径最小注入
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        settingsGet: vi.fn(() =>
          Promise.resolve({ ok: true, value: { schemaVersion: 1, preview: { debounceMs: 300 } } }),
        ),
        listChildren: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
        onVfsChanged: vi.fn(() => () => undefined),
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
