/**
 * 树面板（M3 spec §6 → M7 树体验批次重制 → M9 交互增强批次，FR-TREE-01/02；设计依据
 * `docs/design/2026-09-23-M9交互蓝图.md` 面 B/C）：递归渲染 TreeNode（仅呈现/事件，数据归
 * Workspace+treeModel）。
 * —— 折叠可见化（M7）——目录行前置 chevron 指示器（旋转 90° transform 过渡，禁高度动画）；
 * 展开态目录图标 FolderOpen。
 * —— 行内新建（M7→M8 收口）——目录新建进入行内命名（Enter / 失焦提交、空草稿与 Esc 取消），
 * 失败 toast 并同样收口命名行（不留在编辑态，避免焦点陷阱）。
 * —— 导入入口（M7）——「导入 HTML 文件」钮；目录点选模式（dirPickMode）由 move /
 * import-html 两流程共用：dir 点选=选定目标（data-pick-target 高亮），file 点选禁用。
 * —— 根目录入口（M9 面 B）——保存路径小字升为「根目录」可点选入口（根行隐藏后本条即根的
 * 代理行）：点击上抛 onSelectRoot（常规模式=树选中根；pick 模式=目标定为根），命中态经
 * aria-current 高亮；同时承载拖拽落点（data-tree-node-id="1"）。
 * —— 空白区失焦（M9 面 B）——树列表空白区 pointerdown（左键、非交互元素、非 pick 模式）
 * = 清除树选中（新建/导入/粘贴落点回落根）；Esc 为键盘等价（焦点在 nav 内且未被消费）。
 * —— 拖拽移动（M9 面 C）——pointer 事件自制拖拽（非 HTML5 DnD：幽灵与微交互完全可控、
 * 与侧栏分隔条拖拽同构、真机 E2E 可确定性驱动）：阈值 5px 起拖（未越阈交还原点击语义，
 * 越阈置 engaged 抑制 click 防误选中）；幽灵两层结构 portal 到 body（跟随层 inline
 * transform 直写零过渡零 React 渲染 + 动画层入场/收场 keyframes）；命中判定
 * elementFromPoint → 最近 [data-tree-node-id]（目标变化才进 state）；合法落点复用
 * data-pick-target 视觉语言（data-drop-target），自身/后代/原父级/文件行为非法
 * （data-drop-invalid 破坏色弱面）；合法折叠目录悬停 600ms 自动展开（单层，不级联）；
 * 抬起合法 → onDropMove（drop 收场：跟随层 180ms 过渡飞向落点行中心 + 卡片退场），
 * 取消/pointercancel/Esc → 原位退场；两路收场均 fill-mode-forwards（reduced-motion
 * 下防回弹滞留）。
 */
import {
  ChevronRight,
  FileCode,
  FileText,
  FileUp,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Music,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import { ICON_BUTTON } from '../ui/classStrings';
import { canDropOn, findNode, type TreeNode } from '../tree/treeModel';

/** 树栏视图态（M5 三态容器）：资源树 / 全局搜索（Task 7）/ 回收站（M5 批次②） */
export type TreePaneView = 'tree' | 'search' | 'trash';

/** 根节点约定 id=1（M1 v1 种子）：根不可重命名/移动（UI 禁用入口），但可作为拖拽落点 */
const ROOT_ID = 1;

/** 拖拽起拖位移阈值（px，输入容差非布局间距，蓝图 C.1）：未越阈抬起=还原点击语义 */
const TREE_DRAG_THRESHOLD_PX = 5;
/** 合法折叠目录悬停自动展开驻留时长（毫秒，蓝图 C.1）：单层展开，不级联 */
const TREE_DRAG_EXPAND_DWELL_MS = 600;
/** 幽灵相对指针的偏移（px）：左上角=指针+(8,8)「提在手里」姿态（蓝图 C.2） */
const GHOST_OFFSET_PX = 8;
/** 幽灵收场动画时长（毫秒）：与收场类串 `duration-180` 两处同步修改（蓝图 C.4 fast 档） */
const GHOST_EXIT_MS = 180;

/**
 * 树节点类型图标（映射与设计系统 §九-9 同族）：dir → Folder/FolderOpen（按展开态）；
 * text/html → FileText；image/* → ImageIcon；audio/* → Music；其余文本（css/js/txt 等）
 * → FileCode。图标色与形分离：形在此判定，色经 treeIconClassFor。
 */
function treeIconFor(meta: NodeMeta, expanded: boolean): typeof Folder {
  if (meta.nodeType === 'dir') return expanded ? FolderOpen : Folder;
  if (meta.mimeType === 'text/html') return FileText;
  if (meta.mimeType !== null && meta.mimeType.startsWith('image/')) return ImageIcon;
  if (meta.mimeType !== null && meta.mimeType.startsWith('audio/')) return Music;
  return FileCode;
}

/**
 * 类型图标着色（M7 用户需求 4「用图标区分文件」）：低饱和类型色板、双主题各取一档
 * （dark 下降一档亮度保对比），固定色不随主题语义反转——类型身份与 VS Code 图标主题
 * 同构（目录琥珀 / HTML 橙 / 图片绿 / 音频紫 / 其余文本天蓝）。选中行文字提亮不变，
 * 图标保持类型色（类型辨识优先级高于行态反馈）。
 */
function treeIconClassFor(meta: NodeMeta): string {
  if (meta.nodeType === 'dir') return 'text-amber-500 dark:text-amber-400';
  if (meta.mimeType === 'text/html') return 'text-orange-500 dark:text-orange-400';
  if (meta.mimeType !== null && meta.mimeType.startsWith('image/'))
    return 'text-emerald-500 dark:text-emerald-400';
  if (meta.mimeType !== null && meta.mimeType.startsWith('audio/'))
    return 'text-violet-500 dark:text-violet-400';
  return 'text-sky-500 dark:text-sky-400';
}

/** 拖拽命中结果（elementFromPoint → 最近 [data-tree-node-id] 的行身份） */
interface DragHit {
  readonly id: number;
  readonly type: string;
}

/** 拖拽会话呈现态（React 承载：源行弱化/落点高亮/幽灵形态派生；指针位置走 ref 直写不进 state） */
interface DragView {
  readonly source: NodeMeta;
  readonly startX: number;
  readonly startY: number;
  readonly targetId: number | null;
  readonly targetValid: boolean;
  readonly phase: 'drag' | 'drop' | 'cancel';
}

/** 拖拽会话命令态（ref 承载：pointermove 高频路径零 React 渲染，收口读「此刻」值） */
interface DragSession {
  readonly source: NodeMeta;
  readonly startX: number;
  readonly startY: number;
  active: boolean;
  targetId: number | null;
  targetValid: boolean;
  dwellTimer: number | null;
}

export interface TreePanelProps {
  readonly roots: readonly TreeNode[];
  readonly selectedId: number | null;
  /** 展开目录 id 集（Workspace 持有）：chevron 朝向与 FolderOpen 形态判定源 */
  readonly expanded: ReadonlySet<number>;
  /** 目录点选模式进行中（move / import-html 共用：dir 点选=选定目标，file 点选禁用） */
  readonly dirPickMode: boolean;
  /** 点选模式下已选定目标目录 id（null=尚待点选）；命中者带 data-pick-target 高亮 */
  readonly pickTargetId: number | null;
  /** 行内新建目录目标父 id（null=无命名行）；父需 loaded（Workspace 进入时保证） */
  readonly creatingDirParentId: number | null;
  /**
   * 数据目录根路径（storage 域 getDataDirInfo().root，②保存路径小字展示源）：null=未装载
   * 不渲染该行。数据目录仅经设置迁移变更且迁移即重启，挂载期快照恒有效
   */
  readonly rootPath: string | null;
  /** 根目录是否处于树选中态（M9：路径条命中高亮；选中可经点空白回退——见 onClearSelection） */
  readonly rootSelected: boolean;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  /** 清除树选中（M9：点树空白区=失焦回落，新建/导入/粘贴落点随之回落根） */
  onClearSelection(): void;
  /** 选中根目录（M9：路径条即根目录入口；move/import-html 点选模式下同义为「目标=根」） */
  onSelectRoot(): void;
  /** 拖拽落定（M9 面 C）：合法性已在面板内判定，落库与结果呈现归 Workspace（moveNode 链） */
  onDropMove(sourceId: number, targetDirId: number): void;
  /** 进入行内新建目录流程（工具栏钮入口；上下文父在面板内推导） */
  onStartCreateDir(parentId: number): void;
  /** 行内命名提交（Enter / 失焦）：落库成功清命名行、失败 toast 并同样清行（不留在编辑态） */
  onConfirmCreateDir(parentId: number, name: string): void;
  /** 行内命名取消（Esc / 失焦时空草稿） */
  onCancelCreateDir(): void;
  onTrash(nodeId: number): void;
  /** 重命名入口（工具栏以选中 id、行内菜单以本行 id 直传；模态渲染归 Workspace） */
  onRename(id: number): void;
  /** 进入 move 选择模式（源 = 入参 id 直传：工具栏传选中、行内菜单传本行；判定归 Workspace） */
  onStartMove(id: number): void;
  /** 导入 HTML 文件入口（工具栏钮；文件选择与确认浮层流程归 Workspace） */
  onImportHtml(): void;
}

/** 行内「⋯」菜单触发钮标准类串（图标钮形态，字号取行内三档中的 xs 档）。
 * 显形策略（M8 用户实测反馈批次修订）：**常态可见**——前景取 muted（图标对比度达标，
 * 与 chevron/类型图标同档），行悬停/行内焦点/菜单展开时经表面（bg-accent）与前景提亮
 * 表达可交互；原「常态 opacity-0、仅悬停显形」的降噪裁决被推翻：用户实测反馈「新建目录
 * 后看不到操作入口、以为目录无法操作」（M5 起行级操作入口只悬停可见，发现性代价高于降噪
 * 收益；工具钮常态可见的既有口径也支持统一）。留证见设计系统 §十三。 */
const ROW_MENU_TRIGGER_CLASS =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground group-hover:text-foreground focus-visible:text-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground';

/**
 * 树节点行主按钮标准类串（设计系统文档 §7.2 树列表形态 · M7 图标行版）：
 * chevron + 类型图标 + 名称横向排布（gap-1.5 与标签条图标行同节奏），名称 span 持有
 * truncate；强选中 aria-current 半透明底 + 加粗；点选目标 ring 提示。
 * 行级元素不加按压态（宽行缩放即抖动，且行点击结果由选中态自证）——按压纪律见 classStrings
 */
const TREE_ROW_BUTTON_CLASS =
  'min-w-0 flex-1 flex items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground data-[pick-target=true]:bg-primary/10 data-[pick-target=true]:ring-1 data-[pick-target=true]:ring-ring group-data-[drop-target=true]:bg-primary/10 group-data-[drop-target=true]:ring-1 group-data-[drop-target=true]:ring-ring group-data-[drop-invalid=true]:bg-destructive/10 group-data-[drop-invalid=true]:ring-1 group-data-[drop-invalid=true]:ring-destructive';

/** 行容器拖拽变体（M9 面 C 落点反馈，蓝图 C.3）：合法落点与 data-pick-target 逐字节同形
 * （同一套「这是落点」语言），非法落点走破坏色弱面（不给两套「不可」语言）；源行弱化
 * opacity-40 + 100ms opacity 过渡 */
const TREE_ROW_DRAG_CLASS =
  'transition-opacity duration-100 data-[drag-source=true]:opacity-40 data-[drop-target=true]:bg-primary/10 data-[drop-target=true]:ring-1 data-[drop-target=true]:ring-ring data-[drop-invalid=true]:bg-destructive/10 data-[drop-invalid=true]:ring-1 data-[drop-invalid=true]:ring-destructive';

/**
 * 行内新建目录命名行（用户实测反馈后的文件系统语义版）：自持草稿态（预填「新建目录」、
 * 挂载即聚焦全选，键入即覆盖）。**本次新建动作内一次性收口**——Enter 提交、Esc 取消、
 * 失焦提交三路都以「提交受理 / 取消」终结行内态，不存在悬空的命名行。
 * 失焦语义（与 Windows 资源管理器同构）：草稿 trim 非空 → 以该名提交；trim 为空 → 视同
 * 取消（不留无名目录）。提交结果（落库成功/失败）由 Workspace 收口：失败 toast 原因并
 * **同时关闭命名行**——失败不留在编辑态，故不存在「用户已离开却每次点击都重发一次失败
 * 请求并抢回焦点」的焦点陷阱（失败后以再点「新建目录」重试，与资源管理器同）。
 * 命名行只承载「新建」这一次动作：提交后该目录即为普通目录行，重命名须经工具栏/行内
 * 「⋯」菜单显式触发——目录是否为空不影响任何呈现（空目录不渲染任何占位行）。
 * 类名 lt-create-row 与 aria-label「新目录名称」为 E2E/组件测试锚点。
 */
function CreateDirRow({
  onConfirm,
  onCancel,
}: {
  /** 提交草稿名（trim 非空）：落库结果由 Workspace 收口（成功/失败均终结行内态） */
  onConfirm(name: string): void;
  onCancel(): void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('新建目录');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 挂载后手动聚焦并全选（不用 autoFocus：React 批处理多次 commit 间 jsdom 焦点时序不稳，
  // effect 时点 DOM 已提交连接，聚焦一次到位）
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  /** 收口解析：空名取消、非空提交（Enter 与失焦共用同一路径，语义不因触发方式分叉） */
  function resolveRow(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) onCancel();
    else onConfirm(trimmed);
  }
  return (
    <li className="lt-create-row list-none">
      <div className="flex items-center gap-1.5 rounded-sm px-2 py-1">
        {/* chevron 与类型图标占位（对齐命名行与树行纵向栅格；命名中无折叠语义） */}
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <FolderPlus
          aria-hidden="true"
          className="size-4 shrink-0 text-amber-500 dark:text-amber-400"
        />
        <input
          ref={inputRef}
          aria-label="新目录名称"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring duration-100 ease-out animate-in fade-in"
          onKeyDown={(e) => {
            // 输入法组合期（中文拼音等）的 Enter 是「确认候选词」而非「提交命名」，放行给 IME
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              resolveRow();
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          // 失焦提交（点击树内任意处/工具栏/画布，或应用失焦后离开本行）：与 Enter 同一收口路径
          onBlur={resolveRow}
        />
      </div>
    </li>
  );
}

/** 展开判定：展开集命中且子级已装载（懒加载未装载层视觉折叠，chevron 不转不换图标） */
function isExpandedNode(node: TreeNode, expanded: ReadonlySet<number>): boolean {
  return node.loaded && expanded.has(node.meta.id);
}

/**
 * 树节点行（行内菜单承载容器 + 主按钮 + 子级容器）：主按钮占余宽，行尾「⋯」触发钮
 * 20px 独立成钮；目录行前置 chevron（展开旋转 90°，transform 合成器路径），文件行以
 * 等宽占位保持类型图标纵向对齐。行容器持有 data-tree-node-id / data-tree-node-type
 * （拖拽命中判定锚；不复用 ⋯ 触发钮的 button[data-node-id]——E2E 定位锚语义不拓宽），
 * 并承载拖拽三变体（源行弱化 / 合法落点 / 非法落点，蓝图 C.3）
 */
function TreeItem({
  node,
  selectedId,
  expanded,
  dirPickMode,
  pickTargetId,
  creatingDirParentId,
  dragSourceId,
  dropTargetId,
  dropTargetValid,
  dragging,
  onToggle,
  onSelect,
  onConfirmCreateDir,
  onCancelCreateDir,
  onRename,
  onStartMove,
  onTrash,
  onRowPointerDown,
  consumeDragClick,
}: {
  readonly node: TreeNode;
  readonly selectedId: number | null;
  readonly expanded: ReadonlySet<number>;
  readonly dirPickMode: boolean;
  readonly pickTargetId: number | null;
  readonly creatingDirParentId: number | null;
  /** 拖拽源行 id（null=无拖拽会话）：源行弱化 opacity-40 */
  readonly dragSourceId: number | null;
  /** 当前命中落点行 id（null=无命中） */
  readonly dropTargetId: number | null;
  /** 命中落点是否合法（false 且命中本行=非法落点破坏色提示） */
  readonly dropTargetValid: boolean;
  /** 拖拽会话进行中（本行命中判定仅在进行中呈现） */
  readonly dragging: boolean;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  onConfirmCreateDir(parentId: number, name: string): void;
  onCancelCreateDir(): void;
  onRename(id: number): void;
  onStartMove(id: number): void;
  onTrash(nodeId: number): void;
  /** 行主按钮 pointerdown（拖拽手势入口，判定归 TreePanel） */
  onRowPointerDown(e: React.PointerEvent<HTMLButtonElement>, meta: NodeMeta): void;
  /** 点击前消费拖拽残留（越阈拖拽后落回源行的 click 不作点选/开签，蓝图 C.1） */
  consumeDragClick(): boolean;
}): React.JSX.Element {
  const isDir = node.meta.nodeType === 'dir';
  const expandedNode = isExpandedNode(node, expanded);
  // 类型图标按展开态换形（FolderOpen）、按类型着色（treeIconClassFor，不随行态变化）
  const Icon = treeIconFor(node.meta, expandedNode);
  return (
    // 行容器为 group：「⋯」触发钮的悬停/焦点显形作用域（见 ROW_MENU_TRIGGER_CLASS 注）
    <li className="list-none">
      <div
        className={`group flex items-center ${TREE_ROW_DRAG_CLASS}`}
        data-tree-node-id={node.meta.id}
        data-tree-node-type={node.meta.nodeType}
        data-drag-source={
          dragging && dragSourceId === node.meta.id && node.meta.id !== ROOT_ID ? 'true' : undefined
        }
        data-drop-target={
          dragging && dropTargetValid && dropTargetId === node.meta.id ? 'true' : undefined
        }
        data-drop-invalid={
          dragging && !dropTargetValid && dropTargetId === node.meta.id ? 'true' : undefined
        }
      >
        <button
          type="button"
          aria-current={node.meta.id === selectedId ? 'true' : undefined}
          data-pick-target={
            dirPickMode && isDir && node.meta.id === pickTargetId ? 'true' : undefined
          }
          disabled={dirPickMode && !isDir}
          className={TREE_ROW_BUTTON_CLASS}
          onPointerDown={(e) => {
            onRowPointerDown(e, node.meta);
          }}
          onClick={() => {
            // 拖拽残留消费（蓝图 C.1）：越阈拖拽取消后落回源行的 click 不作点选/开签
            if (consumeDragClick()) return;
            // 目录点选模式：dir 点选上抛（Workspace 按流程记账目标），file 点选已被 disabled 拦截
            if (dirPickMode) {
              if (isDir) onSelect(node.meta);
              return;
            }
            if (isDir) {
              // ④目录点选 = 选中 + 展开/折叠（VS Code 同构语义）：onSelect 让 Workspace
              // 记账树选中（新建/导入落点随点选目录），onToggle 切换展开态；两回调同批
              // 提交，互不依赖先后
              onSelect(node.meta);
              onToggle(node.meta.id);
            } else {
              onSelect(node.meta);
            }
          }}
        >
          {/* aria-hidden 图标不进可访问名/文本内容——既有测试以名称 textContent/角色名
              精确寻址，逐字保留。chevron 旋转表达折叠/展开（100ms transform 过渡） */}
          {isDir ? (
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-100 ${
                expandedNode ? 'rotate-90' : ''
              }`}
            />
          ) : (
            <span aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <Icon aria-hidden="true" className={`size-4 shrink-0 ${treeIconClassFor(node.meta)}`} />
          <span className="truncate">{node.meta.name}</span>
        </button>
        {/* 行内「⋯」菜单（Task 10）：根不渲染（根不可 rename/move/trash）；移动项与工具栏
            同款在点选模式期间禁用（防模式内再进模式）。键盘管理（方向键/Enter/Esc/焦点
            回落）由 radix dropdown-menu 自带；拖拽等价路径=「移动到…」（WCAG 2.5.7：
            拖拽不是唯一方式，蓝图 C.6） */}
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
            {/* 面板动效对齐蓝图基线 100ms（模板默认 150ms；消费侧覆写，reduced-motion
                全局降级覆盖） */}
            <DropdownMenuContent align="start" className="duration-100">
              <DropdownMenuItem onSelect={() => onRename(node.meta.id)}>
                <Pencil aria-hidden="true" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem disabled={dirPickMode} onSelect={() => onStartMove(node.meta.id)}>
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
      {expandedNode ? (
        // ⑤子级渲染条件 = 展开判定（isExpandedNode：loaded 且在展开集）——修复 M3 起
        // 「装载即恒可见」的存量缺陷（原条件 isDir && node.loaded 使折叠从未真正收起子级，
        // chevron M7 落地后才显形为「收起无反应」）。折叠仅隐藏渲染：loaded 保持、子级
        // 数据保留（隐藏非卸载数据），再展开立即以保留数据渲染无空窗，数据过期由既有
        // stale 重取效应与 onToggle 展开恒重取刷新。
        // 嵌套层经缩进 + 左侧连线表达层级（设计系统文档 §7.2 树列表形态）；展开入场
        // fade 100ms（opacity 合成器路径，折叠→展开卸载重挂时重播，reduced-motion 全局降级）；
        // 行内新建目录命名行渲染于子级首位（VS Code 新建项位置语义）
        <ul className="m-0 ml-4 list-none border-l border-border pl-1 duration-100 ease-out animate-in fade-in">
          {creatingDirParentId === node.meta.id ? (
            <CreateDirRow
              onConfirm={(name) => onConfirmCreateDir(node.meta.id, name)}
              onCancel={onCancelCreateDir}
            />
          ) : null}
          {node.children.map((child) => (
            <TreeItem
              key={child.meta.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              dirPickMode={dirPickMode}
              pickTargetId={pickTargetId}
              creatingDirParentId={creatingDirParentId}
              dragSourceId={dragSourceId}
              dropTargetId={dropTargetId}
              dropTargetValid={dropTargetValid}
              dragging={dragging}
              onToggle={onToggle}
              onSelect={onSelect}
              onConfirmCreateDir={onConfirmCreateDir}
              onCancelCreateDir={onCancelCreateDir}
              onRename={onRename}
              onStartMove={onStartMove}
              onTrash={onTrash}
              onRowPointerDown={onRowPointerDown}
              consumeDragClick={consumeDragClick}
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
  // ②顶层列表跳过合成根行（用户数据目录即默认根，不在树中展示「根」节点行——VS Code
  // 侧栏同构）：根为单节点合成约定（Workspace 挂载首拉后 roots 恒为 [合成根] 且挂载即
  // loaded），顶层直接呈现根子级。收窄保守：仅「恰一节点且 id=根约定值」才按合成根展开
  // 子级，其余形态（含首拉前的空树）原样渲染——树数据模型（Workspace roots/懒加载）不动，
  // 只改呈现层
  const firstRoot = props.roots[0];
  const visibleRoots =
    props.roots.length === 1 && firstRoot !== undefined && firstRoot.meta.id === ROOT_ID
      ? firstRoot.children
      : props.roots;
  // —— M9 面 B：树导航引用（Esc 清除选中的焦点域判定）——
  const navRef = useRef<HTMLElement | null>(null);
  // —— M9 面 C：拖拽会话——命令态 ref（高频路径）+ 呈现态 state（源行弱化/落点/幽灵形态）
  const dragRef = useRef<DragSession | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  // 幽灵跟随层 ref：pointermove 直写 transform（零过渡零 React 渲染，蓝图 C.2 红线）
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // 越阈标记（click 抑制）：pointerdown 重置、越阈置位、行 onClick 消费
  const dragEngagedRef = useRef(false);
  // 幽灵收场定时器句柄：新手势起拖前取消上一会话的收场计时（防其迟到把新幽灵清空）
  const ghostExitTimerRef = useRef<number | null>(null);
  // 在途手势收口（clearListeners + dwell + 接管态）：卸载兜底经此调用（Minor 5——组件卸载
  // 不走 pointerup，残留的 onMove 仍可越阈复活接管态并对已卸载组件 setState）
  const teardownGestureRef = useRef<(() => void) | null>(null);
  // expanded/roots 实时镜像（pointermove/dwell 回调闭包在连点/懒加载场景下必陈旧——
  // Workspace expandedRef 同款同步模式）
  const expandedRef = useRef(props.expanded);
  useEffect(() => {
    expandedRef.current = props.expanded;
  }, [props.expanded]);
  const rootsRef = useRef(props.roots);
  useEffect(() => {
    rootsRef.current = props.roots;
  }, [props.roots]);
  // dirPickMode 实时镜像（拖拽监听器闭包持稳，pick 模式进出不影响在途会话判定）
  const dirPickModeRef = useRef(props.dirPickMode);
  useEffect(() => {
    dirPickModeRef.current = props.dirPickMode;
  }, [props.dirPickMode]);

  // Esc 清除树选中（M9 面 B 键盘等价，蓝图 B.3）：焦点在资源树 nav 内、未被其他消费者
  // defaultPrevented、非 pick 模式（pick 目标只由显式点选改变）才生效；菜单/浮层打开时
  // 焦点在 portal 内（不在 nav 内）天然不误触
  useEffect(() => {
    if (props.dirPickMode) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const nav = navRef.current;
      if (nav === null || !(e.target instanceof Node) || !nav.contains(e.target)) return;
      props.onClearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [props.dirPickMode, props.onClearSelection]);

  /** 命中判定（蓝图 C.3）：elementFromPoint → 最近 [data-tree-node-id]；幽灵 pointer-events-none
   * 不参与命中，拖拽期画布 pointer-events 穿透（theme.css body.lt-tree-dragging） */
  function hitTest(x: number, y: number): DragHit | null {
    const el = document.elementFromPoint(x, y);
    const holder = el !== null ? el.closest<HTMLElement>('[data-tree-node-id]') : null;
    if (holder === null) return null;
    const id = Number(holder.dataset.treeNodeId);
    if (!Number.isInteger(id)) return null;
    return { id, type: holder.dataset.treeNodeType ?? '' };
  }

  /** 落点合法性（蓝图 C.3）：纯判定在 treeModel.canDropOn（目录且非自身/非自身后代/
   * 非源当前父级——同父移动=无动作，moveNode 亦会撞同名约束，不伪装成可放置） */
  function verdictFor(source: NodeMeta, hit: DragHit | null): boolean {
    if (hit === null) return false;
    return canDropOn(rootsRef.current, source, hit.id, hit.type);
  }

  /** 清驻留展开计时器（目标变化/收口两路共用，成对纪律） */
  function resetDwell(session: DragSession): void {
    if (session.dwellTimer !== null) {
      window.clearTimeout(session.dwellTimer);
      session.dwellTimer = null;
    }
  }

  /**
   * 行主按钮 pointerdown（拖拽手势入口，蓝图 C.1 状态机）：window 级成对挂卸
   * move/up/cancel/keydown（M8 分隔条先例）；未越阈抬起=零副作用（点击语义原样）；
   * 越阈=起拖（body.lt-tree-dragging 全局接管 + 幽灵渲染 + engaged 置位抑制 click）。
   * 收口（抬起/取消同路径）：摘 body 类、清驻留计时器、播收场动画后卸载幽灵——
   * pointercancel 必须同清理（漏摘态会把画布永久置为 pointer-events-none）
   */
  function onRowPointerDown(e: React.PointerEvent<HTMLButtonElement>, meta: NodeMeta): void {
    if (e.button !== 0) return;
    if (dirPickModeRef.current) return; // pick 模式点选语义优先，禁用拖拽（蓝图 C.1）
    if (dragRef.current !== null) return; // 会话进行中忽略新手势
    dragEngagedRef.current = false;
    const session: DragSession = {
      source: meta,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      targetId: null,
      targetValid: false,
      dwellTimer: null,
    };
    dragRef.current = session;
    // 上一会话的幽灵收场计时若仍在途，先行取消（Minor 4：防迟到 setDragView(null) 清空新幽灵）
    if (ghostExitTimerRef.current !== null) {
      window.clearTimeout(ghostExitTimerRef.current);
      ghostExitTimerRef.current = null;
    }
    // 收口登记（Minor 5：卸载兜底经此清 window 监听器，防卸载后 onMove 复活接管态）
    teardownGestureRef.current = (): void => {
      clearListeners();
      resetDwell(session);
      resetTakeover();
    };
    const onMove = (move: PointerEvent): void => {
      const s = dragRef.current;
      if (s === null) return;
      if (!s.active) {
        if (Math.hypot(move.clientX - s.startX, move.clientY - s.startY) < TREE_DRAG_THRESHOLD_PX) {
          return;
        }
        // 起拖：全局接管态 + 幽灵渲染 + click 抑制置位（蓝图 C.1）；幽灵初始位=越阈时刻
        // 指针位（非按下位，避免首帧回跳）
        s.active = true;
        dragEngagedRef.current = true;
        document.body.classList.add('lt-tree-dragging');
        setDragView({
          source: s.source,
          startX: move.clientX,
          startY: move.clientY,
          targetId: null,
          targetValid: false,
          phase: 'drag',
        });
      }
      // 幽灵跟随：直写 transform（零 transition，位置零延迟，蓝图 C.4 红线）
      if (ghostRef.current !== null) {
        ghostRef.current.style.transform = `translate3d(${String(move.clientX + GHOST_OFFSET_PX)}px, ${String(move.clientY + GHOST_OFFSET_PX)}px, 0)`;
      }
      // 命中判定仅在目标变化时进 state（蓝图 C.1：pointermove 高频路径零 React 渲染）
      const hit = hitTest(move.clientX, move.clientY);
      const valid = verdictFor(s.source, hit);
      const hitId = hit?.id ?? null;
      if (hitId !== s.targetId || valid !== s.targetValid) {
        s.targetId = hitId;
        s.targetValid = valid;
        setDragView((prev) =>
          prev === null ? prev : { ...prev, targetId: hitId, targetValid: valid },
        );
        resetDwell(s);
        // 合法折叠目录驻留自动展开（蓝图 C.1：单层 600ms，走既有 onToggle 含懒加载）
        if (valid && hit !== null) {
          const node = findNode(rootsRef.current, hit.id);
          const collapsed =
            node !== null && node.meta.nodeType === 'dir' && !expandedRef.current.has(hit.id);
          if (collapsed) {
            s.dwellTimer = window.setTimeout(() => {
              onToggleRef.current(hit.id);
            }, TREE_DRAG_EXPAND_DWELL_MS);
          }
        }
      }
    };
    const clearListeners = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
    };
    const resetTakeover = (): void => {
      document.body.classList.remove('lt-tree-dragging');
    };
    /**
     * 收口（抬起/取消/Esc 同路径）：合法抬起=drop 收场（跟随层 180ms 过渡飞向落点行中心，
     * 卡片退场）+ onDropMove 落库；其余=cancel 原位退场。幽灵摘除在收场动画播完后
     * （GHOST_EXIT_MS 与类串 duration-180 同源）——「先卸载再补动画」会丢退场
     */
    const finish = (committed: boolean): void => {
      const s = dragRef.current;
      if (s === null) return;
      clearListeners();
      resetDwell(s);
      resetTakeover();
      teardownGestureRef.current = null;
      // 抑制标记宏任务后复位：click 同步于 pointerup 后、宏任务前到达（同源行抬起仍被
      // 消费）；Esc/pointercancel/树外抬起等不产生行 click 的路径不再残留标记吞掉后续
      // 键盘 Enter/新点击（Major 1 修复）
      window.setTimeout(() => {
        dragEngagedRef.current = false;
      }, 0);
      if (!s.active) {
        // 未越阈：纯点击路径，零副作用零动画
        dragRef.current = null;
        setDragView(null);
        return;
      }
      const drop = committed && s.targetValid && s.targetId !== null;
      const phase: DragView['phase'] = drop ? 'drop' : 'cancel';
      if (drop && s.targetId !== null) {
        // 跟随层 transform 改写为落点行中心（transition 类随 phase 切换同时生效——
        // CSS transition 以 after-change style 的 transition-property 判定，可触发插值）
        const holder = document.querySelector<HTMLElement>(
          `[data-tree-node-id="${String(s.targetId)}"]`,
        );
        if (holder !== null && ghostRef.current !== null) {
          const rect = holder.getBoundingClientRect();
          ghostRef.current.style.transform = `translate3d(${String(rect.left + rect.width / 2 - 24)}px, ${String(rect.top + rect.height / 2 - 24)}px, 0)`;
        }
        props.onDropMove(s.source.id, s.targetId);
      }
      setDragView((prev) =>
        prev === null ? prev : { ...prev, phase, targetId: s.targetId, targetValid: s.targetValid },
      );
      dragRef.current = null;
      ghostExitTimerRef.current = window.setTimeout(() => {
        setDragView(null);
      }, GHOST_EXIT_MS);
    };
    const onUp = (up: PointerEvent): void => {
      finish(up.button === 0);
    };
    const onCancel = (): void => {
      finish(false);
    };
    const onKey = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape') return;
      // Esc 取消拖拽并阻断同刻其它 Esc 消费（蓝图 C.1）
      key.preventDefault();
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    // capture 阶段：先于「空白区清除选中」的 bubble 监听器消费 Esc 并 preventDefault，
    // 防同刻「取消拖拽 + 清除树选中」双触发（蓝图 C.1）
    window.addEventListener('keydown', onKey, true);
  }

  /** 点击前消费拖拽残留（蓝图 C.1）：越阈拖拽后浏览器仍会对源行派发 click，不作点选 */
  function consumeDragClick(): boolean {
    if (dragEngagedRef.current) {
      dragEngagedRef.current = false;
      return true;
    }
    return false;
  }

  // onToggle 实时镜像（dwell 计时器回调闭包持稳，展开集更新不重挂计时器）
  const onToggleRef = useRef(props.onToggle);
  useEffect(() => {
    onToggleRef.current = props.onToggle;
  }, [props.onToggle]);

  // 拖拽会话卸载兜底（M8 分隔条同款）：组件卸载不会走到 pointerup——漏摘 body 类会把
  // 画布永久置为 pointer-events-none；在途手势的 window 监听器一并摘除（Minor 5）
  useEffect(() => {
    return () => {
      teardownGestureRef.current?.();
      teardownGestureRef.current = null;
      const session = dragRef.current;
      if (session !== null) resetDwell(session);
      document.body.classList.remove('lt-tree-dragging');
    };
  }, []);

  const dragging = dragView !== null && dragView.phase === 'drag';
  // 幽灵图标形态（源行同形：目录按当前展开态换 Folder/FolderOpen，「抓住的就是你看到的那个」）
  const ghostNode = dragView !== null ? findNode(props.roots, dragView.source.id) : null;
  const ghostExpanded = ghostNode !== null && isExpandedNode(ghostNode, props.expanded);
  const GhostIcon = dragView !== null ? treeIconFor(dragView.source, ghostExpanded) : null;
  return (
    <nav
      ref={navRef}
      aria-label="资源树"
      // 装配完成信号锚（E2E 三 spec 等待点）：roots 非空 = Workspace mount 首拉
      // listChildren 已应用到树——空库也有合成根，置位语义与原「根按钮出现」完全等价；
      // data-* 属性为既有锚点先例（行内菜单 data-node-id）
      data-ready={props.roots.length > 0 ? 'true' : undefined}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="lt-tree-toolbar flex items-center gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          aria-label="新建目录"
          title="新建目录"
          className={ICON_BUTTON}
          onClick={() => props.onStartCreateDir(contextParentId)}
        >
          <FolderPlus aria-hidden="true" className="size-4" />
        </button>
        <button
          type="button"
          aria-label="导入 HTML 文件"
          title="导入 HTML 文件"
          className={ICON_BUTTON}
          onClick={props.onImportHtml}
        >
          <FileUp aria-hidden="true" className="size-4" />
        </button>
        {trashTarget !== null ? (
          <button
            type="button"
            aria-label="删除"
            title="删除"
            className={ICON_BUTTON}
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
              className={ICON_BUTTON}
              onClick={() => props.onRename(actionTarget)}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              aria-label="移动到…"
              title="移动到…"
              disabled={actionTarget === ROOT_ID || props.dirPickMode}
              className={ICON_BUTTON}
              onClick={() => props.onStartMove(actionTarget)}
            >
              <FolderInput aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : null}
      </div>
      {props.rootPath !== null ? (
        // ②保存路径小字 → M9 升级为「根目录」可点选入口（蓝图 B.2）：根行隐藏后本条即根的
        // 代理行——点击上抛 onSelectRoot（常规模式=树选中根；pick 模式=目标定为根），命中态
        // 经 aria-current 高亮（单一事实来源：显式选中根时才点亮）；同时承载拖拽落点
        // （data-tree-node-id="1" data-tree-node-type="dir"，data-drop-target 与目录行同形）。
        // h-6（24px）比树行矮一档=次级信息位阶；类名 lt-tree-root-path 为既有 E2E/测试锚点
        <button
          type="button"
          className="lt-tree-root-path flex h-6 w-full shrink-0 min-w-0 items-center gap-1.5 border-b border-border px-2 text-left text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground data-[pick-target=true]:bg-primary/10 data-[pick-target=true]:ring-1 data-[pick-target=true]:ring-ring data-[drop-target=true]:bg-primary/10 data-[drop-target=true]:ring-1 data-[drop-target=true]:ring-ring data-[drop-invalid=true]:bg-destructive/10 data-[drop-invalid=true]:ring-1 data-[drop-invalid=true]:ring-destructive"
          aria-label={`根目录：${props.rootPath}`}
          aria-current={props.rootSelected ? 'true' : undefined}
          title={props.rootPath}
          data-tree-node-id={ROOT_ID}
          data-tree-node-type="dir"
          data-pick-target={
            props.dirPickMode && props.pickTargetId === ROOT_ID ? 'true' : undefined
          }
          data-drop-target={
            dragging && dragView !== null && dragView.targetValid && dragView.targetId === ROOT_ID
              ? 'true'
              : undefined
          }
          data-drop-invalid={
            dragging && dragView !== null && !dragView.targetValid && dragView.targetId === ROOT_ID
              ? 'true'
              : undefined
          }
          onClick={props.onSelectRoot}
        >
          <Folder
            aria-hidden="true"
            className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400"
          />
          <span className="truncate">{props.rootPath}</span>
        </button>
      ) : null}
      {/* 顶层列表占满余高并自滚动（页面级不滚动，设计系统文档 §二）；类名 lt-tree-list 为
          M9 空白区锚（蓝图 B.2，替代易断的结构锚）。空白区 pointerdown（M9 面 B）=失焦回落：
          左键、目标非交互元素（行钮/菜单钮/命名输入/路径条）、非 pick 模式（pick 目标只由
          显式点选改变，蓝图 B.6）→ 清除树选中，新建/导入/粘贴落点随之回落根；pointerdown
          （而非 click）使行内命名行的失焦提交先于清除选中完成（蓝图 §八 R7 真机验证项） */}
      <ul
        className="lt-tree-list m-0 min-h-0 flex-1 list-none overflow-auto p-2 text-sm"
        onPointerDown={(e) => {
          if (e.button !== 0 || props.dirPickMode) return;
          const target = e.target instanceof Element ? e.target : null;
          if (target !== null && target.closest('button, input, a') !== null) return;
          props.onClearSelection();
        }}
      >
        {/* ②根层命名行回归顶层：根行已不渲染，TreeItem 内 ROOT_ID 命中分支自然不再生效
            （无双行）；目标父=根时命名行渲染于顶层列表首位 */}
        {props.creatingDirParentId === ROOT_ID ? (
          <CreateDirRow
            onConfirm={(name) => props.onConfirmCreateDir(ROOT_ID, name)}
            onCancel={props.onCancelCreateDir}
          />
        ) : null}
        {visibleRoots.map((node) => (
          <TreeItem
            key={node.meta.id}
            node={node}
            selectedId={props.selectedId}
            expanded={props.expanded}
            dirPickMode={props.dirPickMode}
            pickTargetId={props.pickTargetId}
            creatingDirParentId={props.creatingDirParentId}
            dragSourceId={dragView?.source.id ?? null}
            dropTargetId={dragView?.targetId ?? null}
            dropTargetValid={dragView?.targetValid ?? false}
            dragging={dragging}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            onConfirmCreateDir={props.onConfirmCreateDir}
            onCancelCreateDir={props.onCancelCreateDir}
            onRename={props.onRename}
            onStartMove={props.onStartMove}
            onTrash={props.onTrash}
            onRowPointerDown={onRowPointerDown}
            consumeDragClick={consumeDragClick}
          />
        ))}
      </ul>
      {/* 拖拽幽灵（M9 面 C，蓝图 C.2）：两层结构 portal 到 document.body——侧栏内容层的
          animate-in 会写 transform（合成器路径入场），fixed 后代在该窗口内改以动画层为
          包含块并落入裁剪面（M8 已实测该陷阱）；body portal 零依赖侧栏结构。
          跟随层 .lt-drag-ghost：fixed left-0 top-0 + inline transform 直写（拖拽期零
          transition），drop 收场时由收口逻辑改写 transform 指向落点行中心并挂 transition
          类（data-[phase=drop]:transition-transform）插值飞行；动画层 .lt-drag-ghost-card：
          48×48 正方形卡片（4px 标尺，蓝图 C.2 尺寸裁决），类型图标=源行同形同色
          （「抓住的就是你看到的那个」），入场 fade+zoom 100ms、drop/cancel 两路退场均
          fill-mode-forwards（reduced-motion 下防回弹滞留）。aria-hidden：纯视觉反馈不进
          可访问树（无键盘拖拽=播报无受益者，等价路径「移动到…」已覆盖，蓝图 C.6） */}
      {dragView !== null
        ? createPortal(
            <div
              ref={ghostRef}
              className={`lt-drag-ghost pointer-events-none fixed left-0 top-0 z-50 data-[phase=drop]:transition-transform data-[phase=drop]:duration-180 data-[phase=drop]:ease-out`}
              data-phase={dragView.phase}
              style={{
                transform: `translate3d(${String(dragView.startX + GHOST_OFFSET_PX)}px, ${String(dragView.startY + GHOST_OFFSET_PX)}px, 0)`,
              }}
              aria-hidden="true"
            >
              <div
                className={`lt-drag-ghost-card flex size-12 items-center justify-center rounded-lg border border-border bg-popover shadow-md ${
                  dragView.phase === 'drag'
                    ? 'duration-100 ease-out animate-in fade-in zoom-in-95'
                    : dragView.phase === 'drop'
                      ? 'duration-180 ease-in animate-out fade-out zoom-out-50 fill-mode-forwards'
                      : 'duration-180 ease-in animate-out fade-out zoom-out-90 fill-mode-forwards'
                }`}
              >
                {GhostIcon === null ? null : (
                  <GhostIcon
                    aria-hidden="true"
                    className={`size-6 ${treeIconClassFor(dragView.source)}`}
                  />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </nav>
  );
}

/**
 * 新建上下文父：选中 dir → 其本身；file → 其 parentId；未选 → 根（id=1 约定，与 resolvePath('/')
 * 同源）。④目录点选即记账选中（selectedId 可为目录），工具栏新建由此落到当前点选目录
 */
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
