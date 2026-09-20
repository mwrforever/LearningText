/**
 * 树面板（M3 spec §6）：递归渲染 TreeNode（仅呈现/事件，数据归 Workspace+treeModel）；
 * dir 点击展开折叠、file 点击选中；工具栏最小操作集（新建/删除/重命名/移动到…）。
 * move 选择模式（M4 spec §6.2 D8）下点选语义临时切换：dir 点选=选定移动目标
 * （data-move-target 高亮），file 点选禁用——合法性判定与确认归 Workspace。
 */
import type { NodeMeta } from '../../../../shared/vfs-contract';
import type { TreeNode } from '../tree/treeModel';

/** 根节点约定 id=1（M1 v1 种子）：根不可重命名/移动（UI 禁用入口） */
const ROOT_ID = 1;

export interface TreePanelProps {
  readonly roots: readonly TreeNode[];
  readonly selectedId: number | null;
  /** move 选择模式进行中（dir 点选临时变为「选定目标」语义，file 点选禁用） */
  readonly moveMode: boolean;
  /** move 模式下已选定的目标目录 id（null=尚待点选）；命中者按钮带 data-move-target 高亮 */
  readonly moveTargetId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  /** 父 = 当前展开上下文（选中 dir 其本身、选中 file 其父、否则根）——判定归 Workspace */
  onCreate(parentId: number, nodeType: 'dir' | 'file'): void;
  onTrash(nodeId: number): void;
  /** 重命名入口（仅非根选中可达；模态渲染归 Workspace） */
  onRename(id: number): void;
  /** 进入 move 选择模式（源 = 当前选中节点，判定归 Workspace） */
  onStartMove(): void;
}

function TreeItem({
  node,
  selectedId,
  moveMode,
  moveTargetId,
  onToggle,
  onSelect,
}: {
  readonly node: TreeNode;
  readonly selectedId: number | null;
  readonly moveMode: boolean;
  readonly moveTargetId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
}): React.JSX.Element {
  const isDir = node.meta.nodeType === 'dir';
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={node.meta.id === selectedId ? 'true' : undefined}
        data-move-target={moveMode && isDir && node.meta.id === moveTargetId ? 'true' : undefined}
        disabled={moveMode && !isDir}
        className="block w-full truncate rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground data-[move-target=true]:bg-primary/10 data-[move-target=true]:ring-1 data-[move-target=true]:ring-ring"
        onClick={() => {
          // move 选择模式：dir 点选上抛（Workspace 记账为选定目标），file 点选已被 disabled 拦截
          if (moveMode) {
            if (isDir) onSelect(node.meta);
            return;
          }
          if (isDir) onToggle(node.meta.id);
          else onSelect(node.meta);
        }}
      >
        {node.meta.name}
      </button>
      {isDir && node.loaded ? (
        // 嵌套层经缩进 + 左侧连线表达层级（设计系统文档 §7.2 树列表形态）
        <ul className="m-0 ml-4 list-none border-l border-border pl-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.meta.id}
              node={child}
              selectedId={selectedId}
              moveMode={moveMode}
              moveTargetId={moveTargetId}
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
  // 重命名/移动入口：有选中即渲染、根选中禁用（根不可 rename/move，spec §6.2 D8）
  const actionTarget = props.selectedId;
  return (
    <nav aria-label="资源树" className="flex min-h-0 flex-1 flex-col">
      <div className="lt-tree-toolbar flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onCreate(contextParentId, 'dir')}
        >
          新建目录
        </button>
        <button
          type="button"
          className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onCreate(contextParentId, 'file')}
        >
          新建文件
        </button>
        {trashTarget !== null ? (
          <button
            type="button"
            className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
            onClick={() => props.onTrash(trashTarget)}
          >
            删除
          </button>
        ) : null}
        {actionTarget !== null ? (
          <>
            <button
              type="button"
              disabled={actionTarget === ROOT_ID}
              className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              onClick={() => props.onRename(actionTarget)}
            >
              重命名
            </button>
            <button
              type="button"
              disabled={actionTarget === ROOT_ID || props.moveMode}
              className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
              onClick={props.onStartMove}
            >
              移动到…
            </button>
          </>
        ) : null}
      </div>
      {/* 顶层列表占满余高并自滚动（页面级不滚动，设计系统文档 §二） */}
      <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-2 text-sm">
        {props.roots.map((node) => (
          <TreeItem
            key={node.meta.id}
            node={node}
            selectedId={props.selectedId}
            moveMode={props.moveMode}
            moveTargetId={props.moveTargetId}
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
