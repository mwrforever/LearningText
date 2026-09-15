// @vitest-environment jsdom
// 入口装配测试：覆盖 main.tsx 全部语句，防止入口文件拖垮覆盖率门禁
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('渲染入口装配', () => {
  beforeEach(() => {
    vi.resetModules();
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
