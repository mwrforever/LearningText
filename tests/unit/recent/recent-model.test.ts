// recentModel 纯函数全分支（M5 批次②）：recordRecent 空表/去重置顶/超 20 尾剪/now 透传、
// pruneRecentByNodes 全存活不变/部分剔除/全剔除空、planWorkspaceRestore 全存活原样/active
// 失效右邻继承（无右邻落左邻）/全部失效空+null/activeId null、throttleTrailing 尾沿合并/
// flush 立即/dispose 资源成对（fake timers）
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  planWorkspaceRestore,
  pruneRecentByNodes,
  recordRecent,
  throttleTrailing,
  type RecentInput,
} from '../../../src/renderer/src/features/recent/recentModel';

/** 持久化形态条目构造器：RecentInput + openedAt（settings recent.opened 读取形态） */
function record(
  nodeId: number,
  openedAt = '2026-09-20T10:00:00.000+08:00',
): RecentInput & {
  readonly openedAt: string;
} {
  return {
    nodeId,
    virtualPath: `/文档${String(nodeId)}.html`,
    name: `文档${String(nodeId)}.html`,
    openedAt,
  };
}

const NOW = '2026-09-21T09:30:00.000+08:00';

describe('recordRecent 最近打开记录', () => {
  it('空表记录：返回仅含新条目的单元素列表', () => {
    expect(recordRecent([], { nodeId: 7, virtualPath: '/a.html', name: 'a.html' }, NOW)).toEqual([
      { nodeId: 7, virtualPath: '/a.html', name: 'a.html', openedAt: NOW },
    ]);
  });

  it('now 透传：新条目 openedAt 恰为传入时刻，既有条目原样保留', () => {
    const next = recordRecent(
      [record(1)],
      { nodeId: 9, virtualPath: '/文档9.html', name: '文档9.html' },
      NOW,
    );
    expect(next).toEqual([record(9, NOW), record(1)]);
  });

  it('去重置顶：重开既有条目前移并刷新 now 戳，旧位不再残留', () => {
    const opened = [record(1), record(2), record(3)];
    const next = recordRecent(
      opened,
      { nodeId: 2, virtualPath: '/文档2.html', name: '文档2.html' },
      NOW,
    );
    expect(next).toEqual([record(2, NOW), record(1), record(3)]);
  });

  it('超 20 尾剪：默认上限 20，最旧条目（尾部）被裁掉', () => {
    // 列表按最近使用降序：record(20) 最近在头、record(1) 最旧在尾
    const full = Array.from({ length: 20 }, (_, i) => record(20 - i));
    const next = recordRecent(
      full,
      { nodeId: 21, virtualPath: '/文档21.html', name: '文档21.html' },
      NOW,
    );
    expect(next).toHaveLength(20);
    expect(next[0]).toEqual({
      nodeId: 21,
      virtualPath: '/文档21.html',
      name: '文档21.html',
      openedAt: NOW,
    });
    expect(next).not.toContainEqual(record(1));
  });
});

describe('pruneRecentByNodes 失效剔除', () => {
  const opened = [record(1), record(2), record(3)];

  it('全存活：原列表原引用直返（无变化不产生新列表）', () => {
    expect(pruneRecentByNodes(opened, new Set([1, 2, 3, 99]))).toBe(opened);
  });

  it('部分剔除：失效 id 出局，存活条目保序', () => {
    expect(pruneRecentByNodes(opened, new Set([2]))).toEqual([record(2)]);
  });

  it('全剔除：返回空数组', () => {
    expect(pruneRecentByNodes(opened, new Set<number>())).toEqual([]);
  });
});

describe('planWorkspaceRestore 恢复计划', () => {
  it('全存活原样：恢复集=原序全量、activeId 不变、无剔除', () => {
    expect(planWorkspaceRestore([1, 2, 3], 2, new Set([1, 2, 3]))).toEqual({
      restoreIds: [1, 2, 3],
      activeId: 2,
      removedIds: [],
    });
  });

  it('active 存活、其余失效：activeId 原样，失效进 removedIds', () => {
    expect(planWorkspaceRestore([1, 2, 3], 2, new Set([2]))).toEqual({
      restoreIds: [2],
      activeId: 2,
      removedIds: [1, 3],
    });
  });

  it('active 失效右邻继承：激活位右起首个存活接管（同 closeTab 右邻语义）', () => {
    expect(planWorkspaceRestore([1, 2, 3, 4], 2, new Set([1, 4]))).toEqual({
      restoreIds: [1, 4],
      activeId: 4,
      removedIds: [2, 3],
    });
  });

  it('右侧无存活左邻接管：激活位右侧全失效时取左侧最近存活', () => {
    expect(planWorkspaceRestore([1, 2, 3], 3, new Set([1]))).toEqual({
      restoreIds: [1],
      activeId: 1,
      removedIds: [2, 3],
    });
  });

  it('全部失效：恢复集空 + activeId 归 null', () => {
    expect(planWorkspaceRestore([5, 6], 5, new Set<number>())).toEqual({
      restoreIds: [],
      activeId: null,
      removedIds: [5, 6],
    });
  });

  it('activeId 为 null：保持 null 不变（失效集照记）', () => {
    expect(planWorkspaceRestore([1, 2], null, new Set([1]))).toEqual({
      restoreIds: [1],
      activeId: null,
      removedIds: [2],
    });
  });
});

describe('throttleTrailing 尾沿节流', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('等待窗内多次 call 只执行最后一次（尾沿合并）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttle = throttleTrailing(fn, 300);
    throttle.call();
    vi.advanceTimersByTime(150);
    throttle.call();
    throttle.call();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('首窗执行一次后不再重复（尾沿后挂起清空）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttle = throttleTrailing(fn, 300);
    throttle.call();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('flush 立即执行挂起调用并清 timer（此后不再二次执行）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttle = throttleTrailing(fn, 300);
    throttle.call();
    vi.advanceTimersByTime(299);
    throttle.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dispose 后挂起调用不执行（资源成对：timer 清空 + 挂起清空，flush 亦不复活）', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttle = throttleTrailing(fn, 300);
    throttle.call();
    throttle.dispose();
    vi.runAllTimers();
    throttle.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('无挂起时 flush/dispose 为空操作且不抛错', () => {
    const fn = vi.fn();
    const throttle = throttleTrailing(fn, 300);
    expect(() => {
      throttle.flush();
      throttle.dispose();
    }).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});
