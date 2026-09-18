/**
 * 树面板数据模型（M3 spec §4.3 最小同步集，纯函数不可变更新，宪法 A.1-10/A.7-6）：
 * 节点携带懒加载标记（loaded）与失效标记（stale）；广播事件按形态做路径复制更新。
 * renamed/moved 不重排结构（树结构未变），仅标记 stale 让已展开层重取（路径展示修正）。
 */
import type { NodeMeta, VfsChangedBroadcast } from '../../../../shared/vfs-contract';

export interface TreeNode {
  readonly meta: NodeMeta;
  readonly children: readonly TreeNode[];
  /** children 已加载（未加载节点折叠态无 children 数据） */
  readonly loaded: boolean;
  /** renamed/moved 波及：已展开的该节点待重取刷新 virtualPath 展示 */
  readonly stale: boolean;
}

export function makeTreeRoot(meta: NodeMeta): TreeNode {
  return { meta, children: [], loaded: false, stale: false };
}

/** 注入子节点并标记已加载（listChildren 拉取回写用） */
export function withChildren(node: TreeNode, children: readonly TreeNode[]): TreeNode {
  return { ...node, children, loaded: true, stale: false };
}

export function findNode(roots: readonly TreeNode[], id: number): TreeNode | null {
  for (const node of roots) {
    if (node.meta.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit !== null) return hit;
  }
  return null;
}

/** 收集「stale 且已展开」的节点 id——组件据此重取 children（expanded 集合 UI 态外部传入） */
export function collectStaleExpanded(
  roots: readonly TreeNode[],
  expanded: ReadonlySet<number>,
): number[] {
  const ids: number[] = [];
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const n of nodes) {
      if (n.stale && expanded.has(n.meta.id)) ids.push(n.meta.id);
      walk(n.children);
    }
  };
  walk(roots);
  return ids;
}

/** 广播→树：返回新树（不可变）。created/restored 按 parentId 挂入（父未加载则不动，懒语义）；
 * written 刷新 meta；trashed/purged 移除；renamed/moved 子树标记 stale。 */
export function applyBroadcast(
  roots: readonly TreeNode[],
  broadcast: VfsChangedBroadcast,
): readonly TreeNode[] {
  const event = broadcast.event;
  switch (event.type) {
    case 'created':
    case 'restored':
      return insert(roots, event.node);
    case 'written':
      return updateMeta(roots, event.node);
    case 'trashed':
    case 'purged':
      return remove(roots, event.nodeId);
    case 'renamed':
    case 'moved':
      return markStale(roots, event.nodeId);
  }
}

function insert(nodes: readonly TreeNode[], node: NodeMeta): readonly TreeNode[] {
  return nodes.map((t) => {
    if (t.meta.id === node.parentId && t.loaded) {
      return { ...t, children: [...t.children, makeTreeRoot(node)] };
    }
    return { ...t, children: insert(t.children, node) };
  });
}

function updateMeta(nodes: readonly TreeNode[], node: NodeMeta): readonly TreeNode[] {
  return nodes.map((t) =>
    t.meta.id === node.id ? { ...t, meta: node } : { ...t, children: updateMeta(t.children, node) },
  );
}

function remove(nodes: readonly TreeNode[], id: number): readonly TreeNode[] {
  return nodes
    .filter((t) => t.meta.id !== id)
    .map((t) => ({ ...t, children: remove(t.children, id) }));
}

function markStale(nodes: readonly TreeNode[], id: number): readonly TreeNode[] {
  return nodes.map((t) => {
    if (t.meta.id === id) return { ...t, stale: true };
    return { ...t, children: markStale(t.children, id) };
  });
}
