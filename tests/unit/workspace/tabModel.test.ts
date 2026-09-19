// 标签状态机（M4 spec §3）：同文件唯一实例聚焦、关闭右邻优先、上限护栏、meta/dirty 同步
import { describe, expect, it } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import {
  MAX_TABS,
  closeTab,
  openTab,
  setTabDirty,
  updateTabMeta,
  type TabState,
  type TabsOp,
} from '../../../src/renderer/src/features/workspace/tabModel';

function meta(id: number, name: string): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/html',
    size: 4,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}
const EMPTY: TabsOp = { tabs: [], activeId: null };

describe('tabModel', () => {
  it('openTab：空开激活；重复打开同文件聚焦既有不重复建', () => {
    let op = openTab(EMPTY, meta(2, 'a.html'));
    expect(op.activeId).toBe(2);
    op = openTab(op, meta(3, 'b.html'));
    expect(op.tabs).toHaveLength(2);
    op = openTab(op, meta(2, 'a.html'));
    expect(op.tabs).toHaveLength(2);
    expect(op.activeId).toBe(2);
  });

  it('openTab 上限护栏：MAX_TABS 满后静默拒开（调用方 toast）', () => {
    let op = EMPTY;
    for (let id = 1; id <= MAX_TABS; id += 1) op = openTab(op, meta(id, `f${id}.html`));
    const full = op;
    const rejected = openTab(full, meta(999, 'x.html'));
    expect(rejected.tabs).toHaveLength(MAX_TABS);
    expect(rejected.activeId).toBe(full.activeId);
  });

  it('closeTab：关闭激活标签右邻优先补位；关末尾左邻', () => {
    let op = openTab(openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b')), meta(4, 'c'));
    op = openTab(op, meta(3, 'b')); // 激活 b（中位）
    const closedMiddle = closeTab(op, 3);
    expect(closedMiddle.activeId).toBe(4); // 右邻
    const closedTail = closeTab(closedMiddle, 4);
    expect(closedTail.activeId).toBe(2); // 无右邻左邻
  });

  it('closeTab：关闭非激活标签激活位保持不变', () => {
    let op = openTab(openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b')), meta(4, 'c'));
    op = openTab(op, meta(3, 'b')); // 激活 3
    const closed = closeTab(op, 4); // 关非激活 4
    expect(closed.activeId).toBe(3);
    expect(closed.tabs.map((t) => t.meta.id)).toEqual([2, 3]);
  });

  it('closeTab：关闭不存在的 id 为 no-op，标签与激活位均不变', () => {
    const op = openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b'));
    const closed = closeTab(op, 404);
    expect(closed.tabs.map((t) => t.meta.id)).toEqual([2, 3]);
    expect(closed.activeId).toBe(3);
  });

  it('closeTab：关闭全部标签激活位归 null；setTabDirty/updateTabMeta 按 id 精确同步', () => {
    let op = openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b'));
    op = closeTab(closeTab(op, 3), 2);
    expect(op.activeId).toBeNull();
    expect(op.tabs).toHaveLength(0);
    const dirtied = setTabDirty(
      { tabs: [{ meta: meta(2, 'a'), dirty: false }], activeId: 2 },
      2,
      true,
    );
    expect(dirtied.tabs[0]?.dirty).toBe(true);
    const renamed = updateTabMeta(dirtied, 2, meta(2, '新名.html'));
    expect(renamed.tabs[0]?.meta.name).toBe('新名.html');
    expect(renamed.tabs[0]?.dirty).toBe(true); // dirty 不被 meta 同步冲掉
    const tabsAll: readonly TabState[] = renamed.tabs;
    expect(tabsAll).toHaveLength(1);
  });

  // 分支覆盖补充：多标签下按 id 同步必须只命中目标，其余标签原样保留
  it('setTabDirty/updateTabMeta：仅命中目标 id，其余标签保持原样', () => {
    const op = openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b'));
    const dirtied = setTabDirty(op, 3, true);
    expect(dirtied.tabs[0]?.dirty).toBe(false); // 未命中的 2 不受影响
    expect(dirtied.tabs[1]?.dirty).toBe(true);
    const renamed = updateTabMeta(dirtied, 3, meta(3, '新.html'));
    expect(renamed.tabs[0]?.meta.name).toBe('a'); // 未命中的 2 不受影响
    expect(renamed.tabs[1]?.meta.name).toBe('新.html');
    expect(renamed.activeId).toBe(3);
  });
});
