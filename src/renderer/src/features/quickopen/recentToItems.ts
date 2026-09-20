/**
 * 快速打开数据接口（M5 批次②）：最近打开条目 → 候选列表的只读投影。本任务仅落数据接口
 * （Task 6 浮层 UI 的消费面），浮层交互与渲染归 Task 6。
 */
import type { RecentInput } from '../recent/recentModel';

/** 快速打开候选项：nodeId 投影为 id，展示字段原样保真 */
export interface RecentItem {
  readonly id: number;
  readonly name: string;
  readonly virtualPath: string;
}

/**
 * 最近打开列表 → 快速打开候选（纯映射，保序）：输入接受持久化形态（含 openedAt 的
 * RecentEntry 结构兼容 RecentInput），输出只留展示三字段。
 * @param recent 最近打开条目序列（已按最近使用降序）
 * @returns 候选列表，顺序与输入一致；空输入返回空数组
 */
export function recentToItems(recent: readonly RecentInput[]): readonly RecentItem[] {
  return recent.map((entry) => ({
    id: entry.nodeId,
    name: entry.name,
    virtualPath: entry.virtualPath,
  }));
}
