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

/**
 * 判定 candidateId 是否为 ancestorId 的后代（不含自身，多级命中；M4 spec §6.2 D8
 * move 目标合法性判定用）。祖先 id 不在树中（未加载/不存在）恒 false——保守放行，
 * 自身同移与越界交由主进程 E_VFS_INVALID_MOVE 兜底
 */
export function isDescendant(
  roots: readonly TreeNode[],
  ancestorId: number,
  candidateId: number,
): boolean {
  const ancestor = findNode(roots, ancestorId);
  if (ancestor === null) return false;
  const walk = (nodes: readonly TreeNode[]): boolean => {
    for (const n of nodes) {
      if (n.meta.id === candidateId) return true;
      if (walk(n.children)) return true;
    }
    return false;
  };
  return walk(ancestor.children);
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
      return markStaleAround(roots, event.nodeId);
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

/** 按 id 标记单节点 stale（moved 新父标记消费：广播契约不携目标父，由新鲜 meta 反查） */
export function markStale(nodes: readonly TreeNode[], id: number): readonly TreeNode[] {
  return nodes.map((t) => {
    if (t.meta.id === id) return { ...t, stale: true };
    return { ...t, children: markStale(t.children, id) };
  });
}

/**
 * 标记节点与其树内直父一并 stale（renamed/moved 广播用）：节点自身 meta 不随这两类广播
 * 携带（契约只有 nodeId），展示名/落点更新依赖「父层 listChildren 重取回写子级新 meta」
 * ——只标节点自身会使旧父层残留已移走/已改名副本（重命名后旧名副本永不消失，E2E 实证）。
 * 目标父不在本树（未加载）时自然无标记——折叠目录展开时 onToggle 恒重取，无需提前标记。
 */
export function markStaleAround(nodes: readonly TreeNode[], id: number): readonly TreeNode[] {
  return nodes.map((t) => {
    if (t.meta.id === id) return { ...t, stale: true };
    if (t.children.some((child) => child.meta.id === id)) {
      // 直父命中：父与子同批标记（子沿用 markStale 语义，孙代不波及）
      return { ...t, stale: true, children: markStale(t.children, id) };
    }
    return { ...t, children: markStaleAround(t.children, id) };
  });
}
