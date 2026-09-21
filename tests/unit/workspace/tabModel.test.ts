// 标签状态机（M4 spec §3 → M6 spec §2.4 扩型）：同文件唯一实例聚焦、关闭右邻优先、上限护栏、
// meta/dirty 同步；设置伪标签（settingsOpen + 'settings' 哨兵）开/关/幂等/回落语义
import { describe, expect, it } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import {
  EMPTY_TABS_OP,
  MAX_TABS,
  closeSettingsTab,
  closeTab,
  openSettingsTab,
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
const EMPTY: TabsOp = EMPTY_TABS_OP;

describe('tabModel doc 标签状态机', () => {
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
      { tabs: [{ meta: meta(2, 'a'), dirty: false }], activeId: 2, settingsOpen: false },
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

describe('tabModel 设置伪标签（M6 spec §2.4）', () => {
  it('openSettingsTab：空工作台打开即激活（哨兵 settings）且 settingsOpen 置位；不占 doc 标签位', () => {
    const op = openSettingsTab(EMPTY);
    expect(op.tabs).toHaveLength(0);
    expect(op.activeId).toBe('settings');
    expect(op.settingsOpen).toBe(true);
  });

  it('openSettingsTab：重复打开幂等聚焦（doc 激活态让位，标签集不变）', () => {
    const op = openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b'));
    const once = openSettingsTab(op);
    expect(once.activeId).toBe('settings');
    expect(once.settingsOpen).toBe(true);
    expect(once.tabs).toHaveLength(2);
    // 设置已在后台驻留时再开：仍为聚焦语义，状态无二次变化
    const twice = openSettingsTab(once);
    expect(twice).toEqual(once);
  });

  it('openSettingsTab 后 openTab：聚焦既有 doc 标签，设置标签保持后台驻留（settingsOpen 不丢）', () => {
    const op = openTab(openSettingsTab(openTab(EMPTY, meta(2, 'a'))), meta(2, 'a'));
    expect(op.activeId).toBe(2);
    expect(op.settingsOpen).toBe(true);
    expect(op.tabs).toHaveLength(1);
  });

  it('closeSettingsTab：设置激活时关闭回落末位 doc 标签；无 doc 标签回落 null', () => {
    const op = openSettingsTab(openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b')));
    const closed = closeSettingsTab(op);
    expect(closed.settingsOpen).toBe(false);
    expect(closed.activeId).toBe(3); // 设置标签恒在末位，左邻即末位 doc 标签
    expect(closed.tabs).toHaveLength(2);
    // 无 doc 标签的纯设置工作台：关闭后回空工作台（激活归 null）
    const bare = closeSettingsTab(openSettingsTab(EMPTY));
    expect(bare.activeId).toBeNull();
    expect(bare.settingsOpen).toBe(false);
    expect(bare.tabs).toHaveLength(0);
  });

  it('closeSettingsTab：doc 激活（设置后台驻留）时关闭仅摘设置标签，激活态不动', () => {
    const op = openTab(
      openSettingsTab(openTab(openTab(EMPTY, meta(2, 'a')), meta(3, 'b'))),
      meta(2, 'a'),
    );
    const closed = closeSettingsTab(op);
    expect(closed.settingsOpen).toBe(false);
    expect(closed.activeId).toBe(2);
    expect(closed.tabs).toHaveLength(2);
  });

  it('closeSettingsTab：设置本未打开时为 no-op', () => {
    const op = openTab(EMPTY, meta(2, 'a'));
    expect(closeSettingsTab(op)).toEqual(op);
    expect(closeSettingsTab(EMPTY)).toEqual(EMPTY);
  });
});
