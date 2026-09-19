/**
 * 标签列表状态机（M4 spec §3 D1 附则）：同文件唯一实例（重复打开=聚焦）、关闭激活标签
 * 右邻优先补位、同开上限护栏——纯函数不可变更新（宪法 A.1-10）。
 */
import type { NodeMeta } from '../../../../shared/vfs-contract';

export interface TabState {
  readonly meta: NodeMeta;
  readonly dirty: boolean;
}

/** 同开上限护栏（防失控；超限由调用方 toast 提示先关） */
export const MAX_TABS = 20;

export interface TabsOp {
  readonly tabs: readonly TabState[];
  readonly activeId: number | null;
}

export function openTab(op: TabsOp, meta: NodeMeta): TabsOp {
  if (op.tabs.some((t) => t.meta.id === meta.id)) {
    return { tabs: op.tabs, activeId: meta.id }; // 聚焦既有实例
  }
  if (op.tabs.length >= MAX_TABS) return op;
  return { tabs: [...op.tabs, { meta, dirty: false }], activeId: meta.id };
}

export function closeTab(op: TabsOp, id: number): TabsOp {
  const idx = op.tabs.findIndex((t) => t.meta.id === id);
  if (idx === -1) return op;
  const tabs = op.tabs.filter((t) => t.meta.id !== id);
  if (op.activeId !== id) return { tabs, activeId: op.activeId };
  const next = tabs[idx] ?? tabs[idx - 1]; // 右邻优先，无则左邻
  return { tabs, activeId: next?.meta.id ?? null };
}

/** rename/move 后 meta 新鲜化（经 vfs:get 反查，Task 8 消费）；不冲掉 dirty */
export function updateTabMeta(op: TabsOp, id: number, meta: NodeMeta): TabsOp {
  return { ...op, tabs: op.tabs.map((t) => (t.meta.id === id ? { ...t, meta } : t)) };
}

export function setTabDirty(op: TabsOp, id: number, dirty: boolean): TabsOp {
  return { ...op, tabs: op.tabs.map((t) => (t.meta.id === id ? { ...t, dirty } : t)) };
}
