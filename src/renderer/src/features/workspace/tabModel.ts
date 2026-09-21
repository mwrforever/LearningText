/**
 * 标签列表状态机（M4 spec §3 D1 附则 → M6 spec §2.4 扩型）：同文件唯一实例（重复打开=聚焦）、
 * 关闭激活标签右邻优先补位、同开上限护栏——纯函数不可变更新（宪法 A.1-10）。
 * M6 扩展：设置作为特殊伪标签（settingsOpen 存在标记 + activeId 哨兵 'settings'）——
 * 不占 MAX_TABS 上限、可开可关；doc 标签与设置标签并存时各自独立激活。
 */
import type { NodeMeta } from '../../../../shared/vfs-contract';

export interface TabState {
  readonly meta: NodeMeta;
  readonly dirty: boolean;
}

/** 同开上限护栏（防失控；超限由调用方 toast 提示先关）——仅约束 doc 标签，设置标签不占额 */
export const MAX_TABS = 20;

/** 激活标签标识：doc 标签为节点 id；设置标签为哨兵 'settings'；无激活为 null */
export type ActiveTabId = number | 'settings' | null;

export interface TabsOp {
  readonly tabs: readonly TabState[];
  readonly activeId: ActiveTabId;
  /** 设置伪标签是否存在于标签条（打开过未关闭）；与 activeId 独立——后台驻留可被 doc 标签覆盖激活 */
  readonly settingsOpen: boolean;
}

/** 空白工作台（无标签无设置页） */
export const EMPTY_TABS_OP: TabsOp = { tabs: [], activeId: null, settingsOpen: false };

export function openTab(op: TabsOp, meta: NodeMeta): TabsOp {
  if (op.tabs.some((t) => t.meta.id === meta.id)) {
    return { ...op, activeId: meta.id }; // 聚焦既有实例（设置标签保持后台驻留）
  }
  if (op.tabs.length >= MAX_TABS) return op;
  return { ...op, tabs: [...op.tabs, { meta, dirty: false }], activeId: meta.id };
}

export function closeTab(op: TabsOp, id: number): TabsOp {
  const idx = op.tabs.findIndex((t) => t.meta.id === id);
  if (idx === -1) return op;
  const tabs = op.tabs.filter((t) => t.meta.id !== id);
  if (op.activeId !== id) return { ...op, tabs };
  const next = tabs[idx] ?? tabs[idx - 1]; // 右邻优先，无则左邻
  return { ...op, tabs, activeId: next?.meta.id ?? null };
}

/** 打开设置伪标签：已存在则仅聚焦；doc 标签激活态让位（设置标签置前） */
export function openSettingsTab(op: TabsOp): TabsOp {
  return { ...op, activeId: 'settings', settingsOpen: true };
}

/**
 * 关闭设置伪标签：设置标签此前即激活时激活态回落到 doc 标签（末位优先，无则 null——
 * 关闭补位右邻语义在此退化为「末位」，设置标签恒在标签条末位，其左邻即末位 doc 标签）；
 * 此前为 doc 标签激活（设置后台驻留）时激活态不动。
 */
export function closeSettingsTab(op: TabsOp): TabsOp {
  if (!op.settingsOpen) return op;
  if (op.activeId !== 'settings') return { ...op, settingsOpen: false };
  const last = op.tabs[op.tabs.length - 1];
  return { ...op, settingsOpen: false, activeId: last?.meta.id ?? null };
}

/** rename/move 后 meta 新鲜化（经 vfs:get 反查，Task 8 消费）；不冲掉 dirty */
export function updateTabMeta(op: TabsOp, id: number, meta: NodeMeta): TabsOp {
  return { ...op, tabs: op.tabs.map((t) => (t.meta.id === id ? { ...t, meta } : t)) };
}

export function setTabDirty(op: TabsOp, id: number, dirty: boolean): TabsOp {
  return { ...op, tabs: op.tabs.map((t) => (t.meta.id === id ? { ...t, dirty } : t)) };
}
