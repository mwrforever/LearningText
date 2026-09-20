// recentToItems 最近打开 → 快速打开候选数据接口（M5 批次②）：nodeId→id 投影、展示字段
// 保真、保序；浮层 UI 消费面归 Task 6，本任务只锁定数据接口契约
import { describe, expect, it } from 'vitest';
import { recentToItems } from '../../../src/renderer/src/features/quickopen/recentToItems';
import type { RecentInput } from '../../../src/renderer/src/features/recent/recentModel';

describe('recentToItems 数据接口', () => {
  it('字段映射：nodeId → id，name/virtualPath 保真透传且保序', () => {
    const opened: readonly RecentInput[] = [
      { nodeId: 7, virtualPath: '/笔记/todo.html', name: 'todo.html' },
      { nodeId: 3, virtualPath: '/a.html', name: 'a.html' },
    ];
    expect(recentToItems(opened)).toEqual([
      { id: 7, name: 'todo.html', virtualPath: '/笔记/todo.html' },
      { id: 3, name: 'a.html', virtualPath: '/a.html' },
    ]);
  });

  it('空列表映射为空数组', () => {
    expect(recentToItems([])).toEqual([]);
  });
});
