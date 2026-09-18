/**
 * 树面板（M3 spec §6）：递归渲染 TreeNode（仅呈现/事件，数据归 Workspace+treeModel）；
 * dir 点击展开折叠、file 点击选中；工具栏最小操作集（新建/删除，完整操作 M4）。
 */
import type { NodeMeta } from '../../../../shared/vfs-contract';
import type { TreeNode } from '../tree/treeModel';

export interface TreePanelProps {
  readonly roots: readonly TreeNode[];
  readonly selectedId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  /** 父 = 当前展开上下文（选中 dir 其本身、选中 file 其父、否则根）——判定归 Workspace */
  onCreate(parentId: number, nodeType: 'dir' | 'file'): void;
  onTrash(nodeId: number): void;
}

function TreeItem({
  node,
  selectedId,
  onToggle,
  onSelect,
}: {
  readonly node: TreeNode;
  readonly selectedId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
}): React.JSX.Element {
  const isDir = node.meta.nodeType === 'dir';
  return (
    <li>
      <button
        type="button"
        aria-current={node.meta.id === selectedId ? 'true' : undefined}
        onClick={() => (isDir ? onToggle(node.meta.id) : onSelect(node.meta))}
      >
        {node.meta.name}
      </button>
      {isDir && node.loaded ? (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.meta.id}
              node={child}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreePanel(props: TreePanelProps): React.JSX.Element {
  const contextParentId = findContextParent(props.roots, props.selectedId);
  // 删除钮存在性由三元保证非 null；const 捕获供闭包窄化（不留 as 断言）
  const trashTarget = props.selectedId;
  return (
    <nav aria-label="资源树">
      <div className="lt-tree-toolbar">
        <button type="button" onClick={() => props.onCreate(contextParentId, 'dir')}>
          新建目录
        </button>
        <button type="button" onClick={() => props.onCreate(contextParentId, 'file')}>
          新建文件
        </button>
        {trashTarget !== null ? (
          <button type="button" onClick={() => props.onTrash(trashTarget)}>
            删除
          </button>
        ) : null}
      </div>
      <ul>
        {props.roots.map((node) => (
          <TreeItem
            key={node.meta.id}
            node={node}
            selectedId={props.selectedId}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}

/** 新建上下文父：选中 dir → 其本身；file → 其 parentId；未选 → 根（id=1 约定，与 resolvePath('/') 同源） */
function findContextParent(roots: readonly TreeNode[], selectedId: number | null): number {
  const ROOT_ID = 1;
  if (selectedId === null) return ROOT_ID;
  const walk = (nodes: readonly TreeNode[]): NodeMeta | null => {
    for (const n of nodes) {
      if (n.meta.id === selectedId) return n.meta;
      const hit = walk(n.children);
      if (hit !== null) return hit;
    }
    return null;
  };
  const selected = walk(roots);
  if (selected === null) return ROOT_ID;
  // 契约上 parentId 为 null 的只有根，根恒为 dir 走上分支；此处兜底 ROOT_ID 仅满足 null 类型收窄
  return selected.nodeType === 'dir' ? selected.id : (selected.parentId ?? ROOT_ID);
}
