/**
 * 树面板（M3 spec §6 → M6 spec §2.3 图标化重制）：递归渲染 TreeNode（仅呈现/事件，数据归
 * Workspace+treeModel）；dir 点击展开折叠、file 点击选中；工具栏最小操作集全面图标化
 * （新建目录/新建文件 + 选中时删除/重命名/移动到…，图标钮一律 aria-label + title tooltip）。
 * move 选择模式（M4 spec §6.2 D8）下点选语义临时切换：dir 点选=选定移动目标
 * （data-move-target 高亮），file 点选禁用——合法性判定与确认归 Workspace。
 * 行内「⋯」菜单（M5 批次④ Task 10）：每行 dropdown-menu 提供重命名/移动到…/删除（M6 起带
 * 图标），dir 与 file 均有，操作以节点 id 直传（脱离 selectedId 选中锚——目录不开标签即可
 * 操作；根为唯一例外，不渲染入口）。
 * 媒体弱选中（M5 批次⑦ Task 14，spec §8/D20 附则）：previewOnlyNodeId 标记「仅预览选中」
 * 的 image/audio 行——与强选中（selectedId，aria-current='true'）并存两套语义：强选中行
 * 恒 aria-current='true' 且不带弱标记（同一行不双标）；弱选中行以 data-preview-selected
 * 承载样式/断言锚、可访问名追加「（预览中）」说明。
 * M6：原 TreePane（树栏三态标题栏）退役——视图切换移交活动栏（spec §2.3），本组件回归
 * 纯树呈现；TreePaneView 类型保留（活动视图枚举消费）。
 */
import { FilePlus, FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import type { TreeNode } from '../tree/treeModel';

/** 树栏视图态（M5 三态容器）：资源树 / 全局搜索（Task 7）/ 回收站（M5 批次②） */
export type TreePaneView = 'tree' | 'search' | 'trash';

/** 根节点约定 id=1（M1 v1 种子）：根不可重命名/移动（UI 禁用入口） */
const ROOT_ID = 1;

export interface TreePanelProps {
  readonly roots: readonly TreeNode[];
  readonly selectedId: number | null;
  /**
   * 媒体弱选中 id（M5 批次⑦ D20 附则）：previewableMime 分流驱动的 image/audio 行高亮；
   * null=无（源回标签即退场）。可选——弱选中为呈现性增量，缺省（冒烟桩/未接线）即无标记
   */
  readonly previewOnlyNodeId?: number | null;
  /** move 选择模式进行中（dir 点选临时变为「选定目标」语义，file 点选禁用） */
  readonly moveMode: boolean;
  /** move 模式下已选定的目标目录 id（null=尚待点选）；命中者按钮带 data-move-target 高亮 */
  readonly moveTargetId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  /** 父 = 当前展开上下文（选中 dir 其本身、选中 file 其父、否则根）——判定归 Workspace */
  onCreate(parentId: number, nodeType: 'dir' | 'file'): void;
  onTrash(nodeId: number): void;
  /** 重命名入口（工具栏以选中 id、行内菜单以本行 id 直传；模态渲染归 Workspace） */
  onRename(id: number): void;
  /** 进入 move 选择模式（源 = 入参 id 直传：工具栏传选中、行内菜单传本行；判定归 Workspace） */
  onStartMove(id: number): void;
}

/** 行内「⋯」菜单触发钮标准类串（图标钮形态，字号取行内三档中的 xs 档）。
 * 显形策略（M5 打磨降噪）：常态弱化为透明、行悬停/行内焦点/菜单展开三态显形——每行
 * 常驻一枚 20px 钮是恒定视觉噪音；透明态仍占位（无布局位移）且可命中（无行为变化），
 * 键盘 Tab 聚焦经 group-focus-within 显形、菜单展开经 radix data-[state=open] 显形 */
const ROW_MENU_TRIGGER_CLASS =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition duration-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground';

/** 工具栏图标钮标准类串（28px 热区，hover/focus/disabled 纪律与既有文字钮同源） */
const TOOLBAR_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40';

/**
 * 树节点行主按钮标准类串（设计系统文档 §7.2 树列表形态）：强选中 aria-current 半透明底 +
 * 加粗；弱选中（媒体仅预览）data-preview-selected 减半底色不加粗——与强选中同色系弱一档，
 * 视觉上可区分「看图」与「激活标签」两态并存
 */
const TREE_ROW_BUTTON_CLASS =
  'min-w-0 flex-1 truncate rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground data-[preview-selected=true]:bg-accent/60 data-[move-target=true]:bg-primary/10 data-[move-target=true]:ring-1 data-[move-target=true]:ring-ring';

/** 树节点行（行内菜单承载容器 + 主按钮）：主按钮占余宽，行尾「⋯」触发钮 20px 独立成钮 */
function TreeItem({
  node,
  selectedId,
  previewOnlyNodeId,
  moveMode,
  moveTargetId,
  onToggle,
  onSelect,
  onRename,
  onStartMove,
  onTrash,
}: {
  readonly node: TreeNode;
  readonly selectedId: number | null;
  readonly previewOnlyNodeId: number | null;
  readonly moveMode: boolean;
  readonly moveTargetId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  onRename(id: number): void;
  onStartMove(id: number): void;
  onTrash(nodeId: number): void;
}): React.JSX.Element {
  const isDir = node.meta.nodeType === 'dir';
  // 弱选中标记（M5 批次⑦ D20 附则）：仅命中 previewOnlyNodeId 且非强选中的行呈现——
  // 同一行强选中恒优先（aria-current='true' 独占，不双标）
  const isPreviewOnly = node.meta.id === previewOnlyNodeId && node.meta.id !== selectedId;
  return (
    // 行容器为 group：「⋯」触发钮的悬停/焦点显形作用域（见 ROW_MENU_TRIGGER_CLASS 注）
    <li className="list-none">
      <div className="group flex items-center">
        <button
          type="button"
          aria-current={node.meta.id === selectedId ? 'true' : undefined}
          aria-label={isPreviewOnly ? `${node.meta.name}（预览中）` : undefined}
          data-preview-selected={isPreviewOnly ? 'true' : undefined}
          data-move-target={moveMode && isDir && node.meta.id === moveTargetId ? 'true' : undefined}
          disabled={moveMode && !isDir}
          className={TREE_ROW_BUTTON_CLASS}
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
        {/* 行内「⋯」菜单（Task 10）：根不渲染（根不可 rename/move/trash）；移动项与工具栏
            同款在 move 模式期间禁用（防模式内再进模式）。键盘管理（方向键/Enter/Esc/焦点
            回落）由 radix dropdown-menu 自带 */}
        {node.meta.id !== ROOT_ID ? (
          <DropdownMenu>
            {/* 可访问名恒为「更多操作」（不含节点名）：既有 E2E 以 getByRole name 子串匹配
                节点名定位行钮，可访问名嵌入节点名会造成锚点串扰（strict mode 违例）——
                行标识改由 data-node-id 承载（测试/未来 E2E 的行级定位锚） */}
            <DropdownMenuTrigger
              aria-label="更多操作"
              data-node-id={node.meta.id}
              title={node.meta.name}
              className={ROW_MENU_TRIGGER_CLASS}
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onRename(node.meta.id)}>
                <Pencil aria-hidden="true" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem disabled={moveMode} onSelect={() => onStartMove(node.meta.id)}>
                <FolderInput aria-hidden="true" />
                移动到…
              </DropdownMenuItem>
              {/* 删除 = 移入回收站（Task 4 trashNode 链，非彻底删除），不标 destructive 变体 */}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onTrash(node.meta.id)}>
                <Trash2 aria-hidden="true" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {isDir && node.loaded ? (
        // 嵌套层经缩进 + 左侧连线表达层级（设计系统文档 §7.2 树列表形态）
        <ul className="m-0 ml-4 list-none border-l border-border pl-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.meta.id}
              node={child}
              selectedId={selectedId}
              previewOnlyNodeId={previewOnlyNodeId}
              moveMode={moveMode}
              moveTargetId={moveTargetId}
              onToggle={onToggle}
              onSelect={onSelect}
              onRename={onRename}
              onStartMove={onStartMove}
              onTrash={onTrash}
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
      <div className="lt-tree-toolbar flex items-center gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          aria-label="新建目录"
          title="新建目录"
          className={TOOLBAR_ICON_BUTTON_CLASS}
          onClick={() => props.onCreate(contextParentId, 'dir')}
        >
          <FolderPlus aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          aria-label="新建文件"
          title="新建文件"
          className={TOOLBAR_ICON_BUTTON_CLASS}
          onClick={() => props.onCreate(contextParentId, 'file')}
        >
          <FilePlus aria-hidden="true" className="size-4" />
        </button>
        {trashTarget !== null ? (
          <button
            type="button"
            aria-label="删除"
            title="删除"
            className={TOOLBAR_ICON_BUTTON_CLASS}
            onClick={() => props.onTrash(trashTarget)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        {actionTarget !== null ? (
          <>
            <button
              type="button"
              aria-label="重命名"
              title="重命名"
              disabled={actionTarget === ROOT_ID}
              className={TOOLBAR_ICON_BUTTON_CLASS}
              onClick={() => props.onRename(actionTarget)}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              aria-label="移动到…"
              title="移动到…"
              disabled={actionTarget === ROOT_ID || props.moveMode}
              className={TOOLBAR_ICON_BUTTON_CLASS}
              onClick={() => props.onStartMove(actionTarget)}
            >
              <FolderInput aria-hidden="true" className="size-4" />
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
            previewOnlyNodeId={props.previewOnlyNodeId ?? null}
            moveMode={props.moveMode}
            moveTargetId={props.moveTargetId}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onStartMove={props.onStartMove}
            onTrash={props.onTrash}
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
