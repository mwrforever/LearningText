/**
 * 树面板（M3 spec §6 → M7 树体验批次重制）：递归渲染 TreeNode（仅呈现/事件，数据归
 * Workspace+treeModel）。M7 交互升级（用户需求 1/3/4/5）：
 * —— 折叠可见化 ——目录行前置 chevron 指示器（折叠 ▸ / 展开 ▾，旋转 90° transform 过渡，
 * 禁高度动画——设计系统 §6「仅 transform/opacity 合成器路径」红线）；展开态目录图标
 * FolderOpen（展开集经 props 下传，M6 纯呈现批次的接口红线随功能批次解除）。
 * —— 图标区分 ——类型图标按类型着色（低饱和双主题色板，映射见 treeIconClassFor），
 * 尺寸升 16px（size-4）。
 * —— 行内新建 ——目录新建进入行内命名：目标父的子级首位渲染命名输入行
 * （CreateDirRow，Enter / 失焦提交、空草稿与 Esc 取消），确认经 onConfirmCreateDir 走
 * createNode，失败保留行内编辑态并重新聚焦可改名重试；原「固定名直接入库」路径退役。
 * 失焦提交与「新建动作一次性收口」为用户实测反馈修复（原「失焦不取消」致命名行永久
 * 滞留、空目录看似长期处于新建态；现语义与 Windows 资源管理器一致：行只承载本次新建
 * 动作，提交后即为普通目录行，重命名须显式走工具栏/行内菜单）。
 * —— 导入入口 ——「新建文件」钮升级为「导入 HTML 文件」（onImportHtml，流程归 Workspace）。
 * 目录点选模式（dirPickMode）由 move / import-html 两流程共用：dir 点选=选定目标
 * （data-pick-target 高亮），file 点选禁用——合法性判定与确认归各流程自身。
 * 行内「⋯」菜单（M5 批次④ Task 10）：每行 dropdown-menu 提供重命名/移动到…/删除（M6 起带
 * 图标），dir 与 file 均有，操作以节点 id 直传（脱离 selectedId 选中锚——目录不开标签即可
 * 操作；根为唯一例外，不渲染入口）。
 * 树交互修复批次（用户实测反馈②④⑤）：②隐藏合成根行——用户数据目录即默认根，根子级顶层
 * 直出，工具栏下方以小字展示保存路径（lt-tree-root-path）；nav data-ready 为装配完成信号锚
 * （替代原「根按钮出现」等待语义）。④目录点选 = 选中 + 展开/折叠（VS Code 同构：点选目录
 * 同时上抛 onSelect 与 onToggle，新建/导入落点随点选目录）。⑤子级渲染条件改展开判定
 * （isExpandedNode）——修复 M3 起「装载即恒可见、折叠从未真正收起子级」的存量缺陷
 * （chevron M7 落地后才显形为「收起无反应」）。
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
import type { NodeMeta } from '../../../../shared/vfs-contract';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu';
import { ICON_BUTTON } from '../ui/classStrings';
import type { TreeNode } from '../tree/treeModel';

/** 树栏视图态（M5 三态容器）：资源树 / 全局搜索（Task 7）/ 回收站（M5 批次②） */
export type TreePaneView = 'tree' | 'search' | 'trash';

/** 根节点约定 id=1（M1 v1 种子）：根不可重命名/移动（UI 禁用入口） */
const ROOT_ID = 1;

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
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
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
  'min-w-0 flex-1 flex items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground data-[pick-target=true]:bg-primary/10 data-[pick-target=true]:ring-1 data-[pick-target=true]:ring-ring';

/**
 * 行内新建目录命名行（用户实测反馈后的文件系统语义版）：自持草稿态（预填「新建目录」、
 * 挂载即聚焦全选，键入即覆盖）。**本次新建动作内一次性收口**——Enter 提交、Esc 取消、
 * 失焦提交三路都以「提交受理 / 取消」终结行内态，不存在悬空的命名行（原「失焦不取消」
 * 曾使失焦后的行永久滞留树中，用户实测为「一直处于新建状态」，已推翻）。
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
 * 等宽占位保持类型图标纵向对齐
 */
function TreeItem({
  node,
  selectedId,
  expanded,
  dirPickMode,
  pickTargetId,
  creatingDirParentId,
  onToggle,
  onSelect,
  onConfirmCreateDir,
  onCancelCreateDir,
  onRename,
  onStartMove,
  onTrash,
}: {
  readonly node: TreeNode;
  readonly selectedId: number | null;
  readonly expanded: ReadonlySet<number>;
  readonly dirPickMode: boolean;
  readonly pickTargetId: number | null;
  readonly creatingDirParentId: number | null;
  onToggle(id: number): void;
  onSelect(node: NodeMeta): void;
  onConfirmCreateDir(parentId: number, name: string): void;
  onCancelCreateDir(): void;
  onRename(id: number): void;
  onStartMove(id: number): void;
  onTrash(nodeId: number): void;
}): React.JSX.Element {
  const isDir = node.meta.nodeType === 'dir';
  const expandedNode = isExpandedNode(node, expanded);
  // 类型图标按展开态换形（FolderOpen）、按类型着色（treeIconClassFor，不随行态变化）
  const Icon = treeIconFor(node.meta, expandedNode);
  return (
    // 行容器为 group：「⋯」触发钮的悬停/焦点显形作用域（见 ROW_MENU_TRIGGER_CLASS 注）
    <li className="list-none">
      <div className="group flex items-center">
        <button
          type="button"
          aria-current={node.meta.id === selectedId ? 'true' : undefined}
          data-pick-target={
            dirPickMode && isDir && node.meta.id === pickTargetId ? 'true' : undefined
          }
          disabled={dirPickMode && !isDir}
          className={TREE_ROW_BUTTON_CLASS}
          onClick={() => {
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
              onToggle={onToggle}
              onSelect={onSelect}
              onConfirmCreateDir={onConfirmCreateDir}
              onCancelCreateDir={onCancelCreateDir}
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
  return (
    <nav
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
        // ②保存路径小字（根行隐藏后补位告知数据落点，VS Code 侧栏同构的 xs muted 形态）：
        // truncate 截断溢出，title 悬停看全路径；类名 lt-tree-root-path 为 E2E/测试锚点
        <div
          className="lt-tree-root-path shrink-0 truncate border-b border-border px-2 py-1 text-xs text-muted-foreground"
          title={props.rootPath}
        >
          {props.rootPath}
        </div>
      ) : null}
      {/* 顶层列表占满余高并自滚动（页面级不滚动，设计系统文档 §二） */}
      <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-2 text-sm">
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
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            onConfirmCreateDir={props.onConfirmCreateDir}
            onCancelCreateDir={props.onCancelCreateDir}
            onRename={props.onRename}
            onStartMove={props.onStartMove}
            onTrash={props.onTrash}
          />
        ))}
      </ul>
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
