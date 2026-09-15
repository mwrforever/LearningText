// @vitest-environment jsdom
// 渲染层组件测试按宪法 A.6-2 仅此处用 jsdom，按需最小化
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '../../../src/renderer/src/App';

describe('App 根组件', () => {
  it('渲染 LearningText 标题（E2E 断言锚点）', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<App />);
    });
    expect(container.querySelector('h1')?.textContent).toBe('LearningText');
  });
});
