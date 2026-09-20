/**
 * 最近打开与工作区恢复纯函数（M5 批次②）：recordRecent 去重置顶 + 尾剪、pruneRecentByNodes
 * 失效剔除、planWorkspaceRestore 恢复计划（激活点失效的右邻继承语义同 tabModel.closeTab）、
 * throttleTrailing 尾沿节流（标签操作写 workspace 域 300ms——D8）。本模块全部无副作用、
 * 不摸钟（时刻由调用方以 now 注入），Workspace 接线层负责 IPC 与状态应用。
 */

/** 最近打开条目的消费形态：持久化形态（shared RecentEntrySchema）减去写入方补齐的 openedAt */
export interface RecentInput {
  readonly nodeId: number;
  readonly virtualPath: string;
  readonly name: string;
}

/** 持久化形态条目：RecentInput + openedAt（本地 ISO 8601，由记录点以 now 补齐） */
export type RecentRecord = RecentInput & { readonly openedAt: string };

/**
 * 记录一次最近打开（纯函数）：按 nodeId 去重（旧同 id 条目移除）、新条目盖 now 戳置顶、
 * 超 max 自尾部裁剪最旧条目。入参 opened 通常为持久化列表（元素含 openedAt 时原样透传，
 * 保留各自原时刻）。
 * @param opened 既有最近打开列表（允许为空）
 * @param entry 本次打开的文档身份（nodeId/virtualPath/name，不含时刻）
 * @param now 本次打开时刻（本地 ISO 8601 字符串；纯函数不摸钟，由调用方统一取值）
 * @param max 保留上限，默认 20（与 shared RecentSchema 的 max(20) 同源）
 * @returns 新列表：置顶后的完整持久化序列（超出 max 的最旧条目被裁掉）；列表整体按
 *          最近使用降序
 */
export function recordRecent(
  opened: readonly RecentInput[],
  entry: RecentInput,
  now: string,
  max = 20,
): readonly RecentInput[] {
  // 去重：同 nodeId 旧条目移除（其 openedAt 一并作废，由 now 戳取代）
  const rest = opened.filter((e) => e.nodeId !== entry.nodeId);
  const top: RecentRecord = { ...entry, openedAt: now };
  return [top, ...rest].slice(0, max);
}

/**
 * 剔除已不存在的条目（trash/purge 后调用）：不在 aliveNodeIds 验活集合内的 id 全部出局。
 * 全存活时原引用直返——调用方可据此识别「无变化」跳过写回，避免无谓的 settings 落盘。
 * @param opened 既有最近打开列表
 * @param aliveNodeIds 验活通过的节点 id 集合（trash/purge 后的节点不在集合内）
 * @returns 全存活时原引用；否则剔除后的新列表（保序）
 */
export function pruneRecentByNodes(
  opened: readonly RecentInput[],
  aliveNodeIds: ReadonlySet<number>,
): readonly RecentInput[] {
  if (opened.every((e) => aliveNodeIds.has(e.nodeId))) return opened;
  return opened.filter((e) => aliveNodeIds.has(e.nodeId));
}

/** 恢复计划：恢复集（原序保序）+ 修剪后的激活点 + 被剔除的失效 id（供调试/测试断言） */
export interface WorkspaceRestorePlan {
  readonly restoreIds: readonly number[];
  readonly activeId: number | null;
  readonly removedIds: readonly number[];
}

/**
 * 生成工作区恢复计划（纯函数）：失效 id 全部剔除；激活点失效时按 tabModel.closeTab 同款
 * 「右邻优先、无则左邻」继承——激活位右起首个存活 id 接管，右侧无存活则取左侧最近存活，
 * 全无则归 null。activeId 为 null 或仍存活时原样保留（其他位置的失效不影响激活点）。
 * @param tabNodeIds 会话保存的标签 id 序列（顺序即恢复顺序）
 * @param activeId 会话保存的激活标签 id（未开标签为 null）
 * @param alive 验活通过的节点 id 集合（getNode 成功者；trash/purge 后 NOT_FOUND 不入集）
 * @returns 恢复计划：restoreIds 逐个恢复、activeId 为恢复完成后的聚焦目标
 */
export function planWorkspaceRestore(
  tabNodeIds: readonly number[],
  activeId: number | null,
  alive: ReadonlySet<number>,
): WorkspaceRestorePlan {
  const restoreIds = tabNodeIds.filter((id) => alive.has(id));
  const removedIds = tabNodeIds.filter((id) => !alive.has(id));
  if (activeId === null || alive.has(activeId)) {
    return { restoreIds, activeId, removedIds };
  }
  // 右邻继承：激活位之后首个存活 id（等价 closeTab 的 tabs[idx] 取位语义，多次失效链下
  // 与逐个 closeTab 收敛结果一致）
  const rightNeighbor = tabNodeIds
    .slice(tabNodeIds.indexOf(activeId) + 1)
    .find((id) => alive.has(id));
  if (rightNeighbor !== undefined) {
    return { restoreIds, activeId: rightNeighbor, removedIds };
  }
  // 右侧无存活：左侧最近存活接管（closeTab 的 tabs[idx-1] 回退语义）
  const leftAlive = tabNodeIds.slice(0, tabNodeIds.indexOf(activeId)).filter((id) => alive.has(id));
  return { restoreIds, activeId: leftAlive[leftAlive.length - 1] ?? null, removedIds };
}

/**
 * 尾沿节流器（纯计时器封装，无业务副作用）：等待窗内多次 call 合并为窗满时执行最后一次；
 * flush 立即执行挂起调用并清 timer（用于卸载前兜底落写）；dispose 清 timer 与挂起体（资源
 * 成对释放——dispose 后 flush 亦不复活挂起调用）。
 * @param fn 待节流的零参副作用（接线层固定为「从 ref 读实时标签态写 workspace 域」）
 * @param waitMs 尾沿等待窗长（毫秒）
 * @returns call 置位/刷新挂起、flush 立即落、dispose 释放三者
 */
export function throttleTrailing<T extends () => void>(
  fn: T,
  waitMs: number,
): { readonly call: () => void; readonly flush: () => void; readonly dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  return {
    call: () => {
      pending = fn; // 窗内重复 call 仅覆盖挂起体，记最后一次
      if (timer !== null) return; // 已在等待窗内：不重置计时（尾沿语义的关键）
      timer = setTimeout(() => {
        timer = null;
        const run = pending;
        pending = null;
        run?.();
      }, waitMs);
    },
    flush: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const run = pending;
      pending = null;
      run?.();
    },
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null; // 挂起体一并丢弃：dispose 后 flush 不复活（资源成对断言的语义面）
    },
  };
}
