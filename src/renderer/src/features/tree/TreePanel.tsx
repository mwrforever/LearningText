/**
 * 树面板（M3 spec §6）：递归渲染 TreeNode（仅呈现/事件，数据归 Workspace+treeModel）；
 * dir 点击展开折叠、file 点击选中；工具栏最小操作集（新建/删除/重命名/移动到…）。
 * move 选择模式（M4 spec §6.2 D8）下点选语义临时切换：dir 点选=选定移动目标
 * （data-move-target 高亮），file 点选禁用——合法性判定与确认归 Workspace。
 * 树栏视图插槽（M5 批次① Task 7）：TreePane 承载树栏标题栏与 tree/search/trash 三态内容
 * 分发（view 态由 Workspace 三态容器持有并注入，本组件无内部视图态）；tree 内容即既有
 * TreePanel 实现引用不动，search/trash 内容由 Workspace 装配注入。
 */
import type { ReactNode } from 'react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import type { TreeNode } from '../tree/treeModel';

/** 树栏视图态（M5 三态容器）：资源树 / 全局搜索（Task 7）/ 回收站（M5 批次②） */
export type TreePaneView = 'tree' | 'search' | 'trash';

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

/** 标题栏文本钮标准类串（设计系统文档 §7.2，与 Workspace 迁出前逐字一致） */
const TITLE_BUTTON_CLASS =
  'inline-flex h-5 items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

/** 标题栏图标钮标准类串（折叠钮两态常驻） */
const TITLE_ICON_BUTTON_CLASS =
  'inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

export interface TreePaneProps {
  /** 当前视图（Workspace 三态容器唯一事实来源，经 props 注入分发） */
  readonly view: TreePaneView;
  /** tree 态内容：既有 TreePanel + move 选择条 + 重命名模态（Workspace 装配注入） */
  readonly treeContent: ReactNode;
  /** search 态内容：全局搜索面板（Workspace 装配注入） */
  readonly searchContent: ReactNode;
  /** trash 态内容：回收站面板（Workspace 装配注入） */
  readonly trashContent: ReactNode;
  /** 标题栏入口：进入全局搜索态 */
  onOpenSearch(): void;
  /** 标题栏入口：进入回收站态 */
  onOpenTrash(): void;
  /** 标题栏入口：返回资源树态（search/trash 两态共用） */
  onBackToTree(): void;
  /** 折叠树栏（布局行为与视图态正交） */
  onCollapse(): void;
}

/**
 * 树栏视图插槽（三态容器呈现面）：标题栏随视图换题与操作——tree 态提供全局搜索/回收站
 * 入口，search/trash 态提供返回口；折叠钮两态常驻。三态内容由 Workspace 装配注入，
 * 本组件只做呈现与分发，不持有任何业务态（A.7-6 单向数据流）。
 */
export function TreePane({
  view,
  treeContent,
  searchContent,
  trashContent,
  onOpenSearch,
  onOpenTrash,
  onBackToTree,
  onCollapse,
}: TreePaneProps): React.JSX.Element {
  const title = view === 'trash' ? '回收站' : view === 'search' ? '全局搜索' : '资源树';
  return (
    <aside className="lt-pane lt-pane-tree flex min-h-0 min-w-0 flex-col bg-background">
      <div className="lt-pane-titlebar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/50 px-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <div className="flex items-center gap-1">
          {view === 'tree' ? (
            <>
              <button
                type="button"
                aria-label="打开全局搜索"
                className={TITLE_BUTTON_CLASS}
                onClick={onOpenSearch}
              >
                搜索
              </button>
              <button
                type="button"
                aria-label="打开回收站"
                className={TITLE_BUTTON_CLASS}
                onClick={onOpenTrash}
              >
                回收站
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="返回资源树"
              className={TITLE_BUTTON_CLASS}
              onClick={onBackToTree}
            >
              返回
            </button>
          )}
          <button
            type="button"
            aria-label="折叠树栏"
            className={TITLE_ICON_BUTTON_CLASS}
            onClick={onCollapse}
          >
            «
          </button>
        </div>
      </div>
      {/* 三态内容分发：互斥渲染，随态卸载即回收内部订阅（面板各自数据自持） */}
      {view === 'tree' ? treeContent : view === 'search' ? searchContent : trashContent}
    </aside>
  );
}
