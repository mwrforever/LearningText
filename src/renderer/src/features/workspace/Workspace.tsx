/**
 * VS Code 式工作台中枢（M6 spec §2，FR-SHELL-01/02 修订版；M4 起的会话/保存/树/导入导出
 * 语义整体保留）：
 * —— 壳层（M6 批次①）——自绘标题栏（TitleBar，应用内菜单经命令处理器分发）+ 活动栏
 * （ActivityBar，三视图切换 + 设置入口）+ 侧栏（树/搜索/回收站内容 + 图标操作头）+
 * 编辑画布区（TabBar + 设置标签页/编辑|预览对/欢迎页）+ 状态栏（StatusBar，保存态/文档数/
 * 主题循环/设置）。布局记忆 = shell.layout v4（侧栏折叠/宽度/活动视图，settings schema v4）。
 * —— 标签模型（M6 扩型）——设置作为特殊伪标签（settingsOpen + activeId 哨兵 'settings'，
 * 不占 MAX_TABS）；媒体/HTML 文件一律开标签（D4/D6），D20 媒体弱选中双源已退役。
 * —— 画布（M6 spec §3，批次②）——HTML 标签 = 保活沙箱 iframe（HtmlCanvas，所见即所得：
 * 编辑上报 lt:doc-edit → 画布缓存 + SaveController.edit；刷新抑制为结构性保证——无写后
 * 重载机制，外部变更经画布浮动钮显式拉取）；媒体标签 = MediaCanvas 原生组件直载；文本
 * 标签 = EditorPanel（CM 源码，仅非 HTML）。滚动同步（scrollSync/双槽桥/D13/D14）随
 * 「编辑面=渲染面」整体退役（spec D5）。
 * —— 既有语义（M4/M5）——tabs/activeTab 状态机（tabModel 纯函数）、TabSessions per-tab
 * 会话、openFile 前置拦截（媒体/HTML 开签分流、二进制拒开、CM 文本大小三分支）、
 * SaveController 保存管线（edit/flush/flushActive/关签 flush）、树懒加载与广播同步、
 * rename/move 模态与选择模式、revealInTree 树侧定位、recent/workspace 域串行写链与启动
 * 恢复、快速打开浮层、导入导出链路与进度面板、主题装配（.dark 切换 + matchMedia）。
 * —— 树交互修复批次（用户实测反馈②④⑤）——②隐藏合成根行（根子级顶层直出 + 数据目录
 * 挂载期装载供树栏保存路径小字）；④目录点选 = 记账树选中（reveal 覆盖，新建/导入落点随
 * 点选目录，文件点选仍开签）；⑤展开集实时镜像（expandedRef 同步写，快速连点防闭包旧值
 * 回滚）。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { DEFAULT_LAYOUT } from '../../../../shared/settings-constants';
import type {
  RecentEntry,
  SettingsData,
  ShellLayout,
  WorkspaceSettings,
} from '../../../../shared/settings-contract';
import type { BackupEntry } from '../../../../shared/backup-contract';
import type {
  ExportProgress,
  ImportConflict,
  ImportProgress,
} from '../../../../shared/io-contract';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { toLocalIsoTime } from '../../../../shared/time';
import type { ShellCommand } from '../../../../shared/shell-contract';
import type { DataDirInfo } from '../../../../shared/storage-contract';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog';
import { RadioGroup, RadioGroupItem } from '@components/ui/radio-group';
import {
  planWorkspaceRestore,
  pruneRecentByNodes,
  recordRecent,
  throttleTrailing,
  type RecentInput,
} from '../recent/recentModel';
import { createEditorState } from '../editor/codemirror';
import { EditorPanel } from '../editor/EditorPanel';
import { SaveController } from '../editor/saveController';
import { TabSessions } from '../editor/tabSessions';
import { HtmlCanvas } from '../canvas/HtmlCanvas';
import { MediaCanvas } from '../canvas/MediaCanvas';
import { previewableMime } from '../preview/previewableMime';
import {
  applyBroadcast,
  collectStaleExpanded,
  findNode,
  isDescendant,
  makeTreeRoot,
  markStale,
  withChildren,
  type TreeNode,
} from '../tree/treeModel';
import { RenameDialog } from '../tree/RenameDialog';
import { TreePanel, type TreePaneView } from '../tree/TreePanel';
import { ImportHtmlDialog } from '../io/ImportHtmlDialog';
import { TrashPanel } from '../trash/TrashPanel';
import { SearchPanel } from '../search/SearchPanel';
import { QuickOpenDialog } from '../quickopen/QuickOpenDialog';
import { SettingsPage } from '../settings/SettingsPage';
import { resolveTheme, type ThemeIntent } from '../settings/themeResolver';
import { ActivityBar } from '../shell/ActivityBar';
import { StatusBar } from '../shell/StatusBar';
import { TitleBar } from '../shell/TitleBar';
import { WelcomePage } from '../shell/WelcomePage';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { ICON_BUTTON, PRIMARY_BUTTON, TOOL_BUTTON } from '../ui/classStrings';
import { TabBar } from './TabBar';
import { ratioFromPointer } from './layoutModel';
import { PROGRESS_EXIT_MS, useExitPresence } from './ioProgressPresence';
import {
  EMPTY_TABS_OP,
  MAX_TABS,
  closeSettingsTab,
  closeTab,
  openSettingsTab,
  openTab,
  setTabDirty,
  updateTabMeta,
  type TabsOp,
} from './tabModel';

export function Workspace(): React.JSX.Element {
  const [roots, setRoots] = useState<readonly TreeNode[]>([]);
  // 展开集种子含合成根（ROOT_ID 常量在模块底部声明，函数体运行时已初始化）：②根行隐藏后
  // 根子级顶层直出不依赖展开集，但 stale 重取效应以 expanded.has 为门——根不入集则顶层
  // moved/renamed 广播后的旧父层重取永不发生，旧名/已移走副本将永久残留（E2E 实证）。根行
  // 已无 UI 折叠入口，恒驻展开集无副作用
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set([ROOT_ID]));
  // 展开集实时镜像（settingsRef/tabsRef 同款同步模式）：⑤快速连点下事件闭包 expanded 必
  // 陈旧——两次连点各读同一旧集合、翻转互相覆盖回滚，正是「收起/展开点击偶发无反应」的
  // 根因。写入纪律：所有写路径统一「读镜像 → 算新值 → 同步写镜像 → setState」，镜像才是
  // 事件时刻的事实源，setState 只承载渲染提交。刻意不用「setState(updater) 内记账副作用」
  // 形态：updater 由 React 推迟到渲染期才求值（仅队列空闲时才急切求值），同事件内前置
  // setState（如目录点选先 setRevealSelectionId）会让调用侧读不到 updater 内的记账结果
  const expandedRef = useRef<ReadonlySet<number>>(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  // 标签操作状态机（M6 扩型）：设置伪标签存在标记与 'settings' 哨兵激活见 tabModel
  const [tabsOp, setTabsOp] = useState<TabsOp>(EMPTY_TABS_OP);
  const [debounceMs, setDebounceMs] = useState(300);
  const [autoSaveMs, setAutoSaveMs] = useState(3000);
  // 壳层布局态（FR-SHELL-01 修订版，v4）：侧栏折叠/宽度/活动视图；启动时由 settingsGet 恢复
  const [layout, setLayout] = useState<ShellLayout>(DEFAULT_LAYOUT);
  // 布局就绪标记（M8）：settingsGet 应用布局后才置位——在此之前不挂过渡/入场类，避免把
  // 「默认布局 → 记忆布局」的装载覆盖播成动画（非用户动作驱动的动效是廉价感来源）
  const [layoutReady, setLayoutReady] = useState(false);
  // move 选择模式（M4 spec §6.2 D8；M5 批次④ Task 10 源锚退役）：null=未进入；sourceId=
  // 进入模式时直传的移动源（树工具栏传选中 id、行内菜单传本行 id——不再读 tabsOp.activeId，
  // 消灭「覆盖高亮/激活态瞬态错位」窗口），targetId=已点选的目标目录（null=尚待点选）。
  // 模式期间 file 点选禁用、dir 点选仅记账目标，sourceId 恒不变
  const [moveMode, setMoveMode] = useState<{ sourceId: number; targetId: number | null } | null>(
    null,
  );
  // move 请求在途（确认钮防重复提交）
  const [moveInFlight, setMoveInFlight] = useState(false);
  // 行内重命名模态目标（M4 spec §6.2 D8）：null=关闭；name 取树内当前名预填
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  // rename 请求在途（模态确认钮防重复提交）
  const [renameInFlight, setRenameInFlight] = useState(false);
  // 行内新建目录（M7，VS Code 式原地命名）：目标父 id（null=无命名行）；父未展开时进入
  // 即自动展开装载（行内命名行渲染于子级首位，需父 loaded）
  const [creatingDirParentId, setCreatingDirParentId] = useState<number | null>(null);
  // 行内新建目录请求在途（确认防重复提交；ref 而非 state——见 confirmCreateDir 注：同任务
  // 连发提交时 state 闭包会读到旧值而穿透守卫）
  const createDirInFlightRef = useRef(false);
  // HTML 文件导入草稿（M7，FR-IO-01 文件形态）：io:pick-file 产出源路径 + 目标父目录
  // （确认浮层非模态，打开期间树中点选目录即改目标——dirPickMode 与 move 共用语义），
  // null=浮层关闭
  const [importHtmlDraft, setImportHtmlDraft] = useState<{
    readonly sourcePath: string;
    readonly targetParentId: number;
  } | null>(null);
  // HTML 文件导入请求在途（浮层确认钮防重复提交）
  const [importHtmlInFlight, setImportHtmlInFlight] = useState(false);
  // 应用内确认弹窗（M8 反馈批次，取代原生 window.confirm）：请求态 + Promise 兑现器——
  // 既有流程（大文件打开 / 未保存退出）在原生 confirm 下是同步阻塞读值，换成浮层后必须
  // Promise 化，调用点 await 语义与分支结构保持不变
  const [confirmRequest, setConfirmRequest] = useState<{
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly destructive: boolean;
  } | null>(null);
  const confirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  // 树栏视图态（M6 起由 layout.activityView 承载持久化，本态为渲染派生镜像——v4 装载前
  // 默认 'tree'；写入口 switchView/updateLayout 同步持久化）
  const [view, setView] = useState<TreePaneView>('tree');
  // 侧栏宽度拖拽进行中（M8 拖拽微交互）：驱动 data-dragging 三处消费——aside 摘除宽度过渡
  // （拖拽必须直跟手）、分隔条颜色固化（指针离开 4px 轨后 hover 面失效）、画布 pointer-events
  // 穿透（指针越过 iframe 时光标才由壳层接管）。每次拖拽仅两次渲染（按下/抬起），不在
  // pointermove 高频路径上
  const [sidebarDragging, setSidebarDragging] = useState(false);
  // 树内定位选中覆盖（M5 Task 7 评审 fix，spec §2.2「在树中显示/定位打开」）：M4 架构
  // selected 即 activeTab，reveal 不开标签但需树内高亮——以覆盖值临时接管 TreePanel 的
  // selectedId；activeId 一变（开标签/切签/关签补位）即回落，用户焦点变化优先于 reveal 残留
  const [revealSelectionId, setRevealSelectionId] = useState<number | null>(null);
  // 快速打开浮层开关（M5 批次① Task 6）：唯一写入口是 shell:command dispatch（菜单
  // Ctrl+P），点选/取消由浮层经 onOpenChange 回传收口
  const [quickOpen, setQuickOpen] = useState(false);
  // 欢迎页「最近打开」镜像（M6 spec §2.5）：settingsGet 装载 + 记录/剔除后刷新（刷新函数
  // refreshRecent 在下方；不改写 QuickOpenDialog 自持数据链）
  const [recentOpened, setRecentOpened] = useState<readonly RecentEntry[]>([]);
  // 状态栏文档总数（M6 spec §2.6）：vfs:count 汇总，启动装载 + 树广播后刷新；null = 未装载
  const [docCount, setDocCount] = useState<number | null>(null);
  // 外观域（M5 批次③ Task 8）：意图（持久化值）与解析结果（驱动 .dark 类与编辑器主题
  // props）。解析初值 light——spec §4.3 D10「首帧默认 light，装配后切换，闪变定档为已知边界」
  const [themeIntent, setThemeIntent] = useState<ThemeIntent>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [editorFontSize, setEditorFontSize] = useState(14);
  // 备份域（M5 批次③ Task 9）：每日自动备份开关显示值 + 备份条目列表（设置页打开期间
  // 拉取与 backup:done 广播刷新，见下方 effect；Workspace 只做数据提升，页面纯受控）
  const [backupAutoEnabled, setBackupAutoEnabled] = useState(true);
  // 启动恢复工作区开关显示值（workspace.restoreOnStart，spec §3.2 默认开；settingsGet 装载回灌）
  const [restoreOnStart, setRestoreOnStart] = useState(true);
  const [backups, setBackups] = useState<readonly BackupEntry[]>([]);
  // 导入域（M5 批次⑥ Task 12）：待确认导入草稿（源路径/目标父/策略——确认弹层受控态，
  // null=关闭）与进行中进度（io:progress 广播驱动；invoke 返回即收口置 null——收口后由
  // useExitPresence 保留快照播 240ms 退场再卸载，实时值仍由本 state 持有）
  const [importDraft, setImportDraft] = useState<{
    readonly sourcePaths: readonly string[];
    readonly targetParentId: number;
    readonly conflict: ImportConflict;
  } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  // 导出域（M5 批次⑥ Task 13）：进行中导出进度（io:progress kind:export 广播驱动；
  // invoke 返回即收口置 null，退场过渡同导入），无取消语义（FR-IO-02 未要求）
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  // 进度面板退场存在性（缺陷修复①配套）：收口 null 后保留快照播 240ms 滑出再卸载；
  // 退场期间新广播到达自动复位回入场（hook 内竞态防护）。原始 state 保留——
  // cancelRunningImport 读实时值、各 invoke 续体写 null 的既有语义不变，本 hook 只承接呈现
  const importPresence = useExitPresence(importProgress, PROGRESS_EXIT_MS);
  const exportPresence = useExitPresence(exportProgress, PROGRESS_EXIT_MS);
  // 数据目录域（M6 批次③）：布局展示值（设置标签打开期间装载）与迁移确认弹层目标
  const [storageInfo, setStorageInfo] = useState<DataDirInfo | null>(null);
  const [storageChangeTarget, setStorageChangeTarget] = useState<string | null>(null);
  // HTML 画布编辑缓存（M6 spec §3.3）：nodeId → 最新 lt:doc-edit 序列化 HTML——画布标签
  // 保存管线的事实源（SaveController.getDoc 消费）；无条目 = 加载后未编辑（flush no-op）
  const canvasDocsRef = useRef(new Map<number, string>());
  // 布局实时镜像（settingsRef/tabsRef 同款同步模式）：拖拽 pointerup 持久化必须读「此刻」
  // 布局——pointermove 高频更新下事件闭包 layout 必陈旧；事件处理器内同步记账，渲染期不写
  const layoutRef = useRef<ShellLayout>(layout);
  // 标签会话容器（M4 spec §3）：TabSessions 为可变容器、随 Workspace 生命周期持有；
  // 渲染期惰性初始化单例（75647f2 先例豁免：仅首次渲染建一次，非副作用）
  const sessionsRef = useRef<TabSessions | null>(null);
  if (sessionsRef.current === null) sessionsRef.current = new TabSessions();
  const sessions = sessionsRef.current;
  // 设置运行时镜像：SaveController 仅构造一次，deps 闭包直接捕获 state 会固化首渲染值
  // （设置装载后陈旧）；经 effect 同步 ref，保证「调用时刻」读到最新设置（渲染期不写 ref）
  const settingsRef = useRef({ debounceMs, autoSaveMs });
  useEffect(() => {
    settingsRef.current = { debounceMs, autoSaveMs };
  }, [debounceMs, autoSaveMs]);
  // tabsOp 实时镜像：openFile 的 readFile 回调属异步续体，闭包 tabsOp 必陈旧（快速连点
  // 时中间态丢失）——触顶判定读 ref（settingsRef 同款同步模式），保证回调执行时刻读最新标签数
  const tabsRef = useRef(tabsOp);
  useEffect(() => {
    tabsRef.current = tabsOp;
  }, [tabsOp]);
  // 全局脏态镜像：confirm-close 判定用（shell 命令回调持稳态引用，禁闭包 tabsOp）
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = tabsOp.tabs.some((t) => t.dirty);
  }, [tabsOp]);
  // 导出选中镜像（M5 批次⑥ Task 13）：shell 命令回调持稳态引用（dirtyRef 同款同步模式）——
  // 命令订阅 effect 恒挂载期一份，闭包 tabsOp/roots 必陈旧；镜像值 = 树选中上下文中的
  // 可导出节点（reveal 覆盖 ?? 激活标签，命中且非根且在树内），无则 null（引导提示）
  const exportSelectionRef = useRef<number | null>(null);
  // 树选中上下文（reveal 覆盖 ?? 激活 doc 标签）：激活态为设置哨兵（'settings'）时无树选中
  const selectedTreeId =
    revealSelectionId ?? (typeof tabsOp.activeId === 'number' ? tabsOp.activeId : null);
  useEffect(() => {
    const selectedId = selectedTreeId;
    exportSelectionRef.current =
      selectedId !== null && selectedId !== ROOT_ID && findNode(roots, selectedId) !== null
        ? selectedId
        : null;
  }, [selectedTreeId, roots]);
  // reveal 选中覆盖回收：activeId 变化即用户改变焦点（开签/切签/关签补位），覆盖值让位
  //（初始挂载同样触发一次，值为 null 无副作用）。④交互下目录点选也会置覆盖选中：其后
  // 点文件开签 → activeId 变 → 选中迁移到新标签节点（预期行为——用户焦点变化优先）
  useEffect(() => {
    setRevealSelectionId(null);
  }, [tabsOp.activeId]);
  // —— 最近打开 / 工作区会话持久化（M5 批次②，settings recent/workspace 域）——
  // 设置写串行链：recent/workspace 域全部写经「get→merge→set」promise 链逐笔串行——启动
  // 恢复期多个记录点近同时完成，裸并发各自 get 读到同一旧值、后写覆盖先写丢条目；串行化
  // 保证每笔写基于前一笔落盘后的全量（persistLayout 用户交互写节奏稀疏，维持既有裸写不动）
  const settingsWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  // 标签操作写节流（D8 尾沿 300ms）：openTab/closeTab/activate 合并为尾沿一次全量写，防
  // 快速连续操作打爆 settings；渲染期惰性初始化单例（sessionsRef 同款豁免），闭包仅捕获
  // tabsRef/settingsWriteChainRef 等稳定引用（首渲染实例恒等价，见 persistTabsFromRef）
  const tabWriteThrottleRef = useRef<ReturnType<typeof throttleTrailing> | null>(null);
  if (tabWriteThrottleRef.current === null) {
    tabWriteThrottleRef.current = throttleTrailing(persistTabsFromRef, 300);
  }
  // 激活标签由 tabs 状态派生（单一事实来源，禁另存副本）
  const activeTab = tabsOp.tabs.find((t) => t.meta.id === tabsOp.activeId) ?? null;
  // 保存管线控制器（M4 spec §2）：渲染期惰性初始化单例（sessionsRef 同款豁免）；
  // deps 注入写桥与会话快照，控制器自身只持状态机与计时器句柄
  const saveControllerRef = useRef<SaveController | null>(null);
  if (saveControllerRef.current === null) {
    saveControllerRef.current = new SaveController({
      debounceMs: () => settingsRef.current.debounceMs,
      autoSaveMs: () => settingsRef.current.autoSaveMs,
      // 事实源优先级：画布缓存（HTML 标签，lt:doc-edit 上报）→ CM 会话（文本标签）
      getDoc: (id) =>
        canvasDocsRef.current.get(id) ?? sessions.get(id)?.state.doc.toString() ?? null,
      write: (id, text) =>
        window.api
          .writeFile({ nodeId: id, content: new TextEncoder().encode(text) })
          .then((r) => r.ok),
      onDirtyChange: (id, dirty) => setTabsOp((prev) => setTabDirty(prev, id, dirty)),
    });
  }
  const saveController = saveControllerRef.current;

  // 启动装配：设置加载（失败回退默认由服务侧保证，此处仅防 IPC 层异常）+ 根 children 首拉
  useEffect(() => {
    let alive = true;
    void window.api.settingsGet().then((result) => {
      if (alive && result.ok) {
        setDebounceMs(result.value.preview.debounceMs);
        setAutoSaveMs(result.value.editor.autoSaveMs);
        // 外观域装载（M5 Task 8）：意图/字号进 state，.dark 切换与编辑器外观重配由主题装配
        // effect / EditorPanel 外观 props 派生应用（意图变化即重跑）
        setThemeIntent(result.value.appearance.theme);
        setEditorFontSize(result.value.appearance.editorFontSize);
        // 备份域装载（M5 Task 9）：每日自动备份开关显示值
        setBackupAutoEnabled(result.value.backup.autoEnabled);
        // 启动恢复开关装载（spec §3.2）：开关显示值进 state（恢复执行仍在下方按装载值判定）
        setRestoreOnStart(result.value.workspace.restoreOnStart);
        // 布局记忆恢复（FR-SHELL-01 修订版）：活动视图随布局一并恢复；ref 同步记账
        layoutRef.current = result.value.shell.layout;
        setLayout(result.value.shell.layout);
        setView(result.value.shell.layout.activityView);
        // 布局就绪（M8）：首帧恒以 DEFAULT_LAYOUT 渲染、装载后才覆盖——过渡/入场类在就绪前
        // 一律不挂，避免「默认布局 → 恢复布局」在每次启动时报一次非用户动作驱动的动画
        setLayoutReady(true);
        // 欢迎页最近打开镜像装载（M6 spec §2.5）
        setRecentOpened(result.value.recent.opened);
        // 工作区恢复（M5 批次②）：开关开启才恢复；恢复链异步贯穿存活校验，卸载即中止
        if (result.value.workspace.restoreOnStart) {
          void restoreWorkspace(result.value.workspace, () => alive);
        }
      }
    });
    void window.api.listChildren({ parentId: ROOT_ID }).then((result) => {
      if (alive && result.ok) {
        setRoots([
          withChildren(
            makeTreeRoot(ROOT_NODE),
            result.value.map((meta) => makeTreeRoot(meta)),
          ),
        ]);
      }
    });
    void window.api.countNodes().then((result) => {
      if (alive && result.ok) setDocCount(result.value);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 启动恢复链（M5 批次②）：逐个 getNode 验活 → planWorkspaceRestore 出恢复计划（失效
   * 剔除 + active 右邻继承）→ 一次性写修剪后的 workspace 域（后续恢复即使全部失败也不残留
   * 死引用）→ 逐个恢复式 openFile（confirm 豁免、拒开红线照常；顺序 await 保证标签序 =
   * 会话序）→ 聚焦计划激活点（逐个打开后激活态停在末位，计划点已不在会话则保持现状）。
   * isAlive 由装配 effect 注入（mount 存活标记），卸载后各续体即中止。
   */
  async function restoreWorkspace(
    workspace: WorkspaceSettings,
    isAlive: () => boolean,
  ): Promise<void> {
    // 逐个验活：主进程 getNode 按 deleted_at IS NULL 过滤，trash/purge 节点一律 NOT_FOUND
    const metas = await Promise.all(
      workspace.tabNodeIds.map(async (id) => {
        const found = await window.api.getNode({ nodeId: id });
        return found.ok ? found.value : null;
      }),
    );
    if (!isAlive()) return;
    const metaById = new Map<number, NodeMeta>();
    const aliveIds = new Set<number>();
    for (const meta of metas) {
      if (meta !== null) {
        metaById.set(meta.id, meta);
        aliveIds.add(meta.id);
      }
    }
    const plan = planWorkspaceRestore(workspace.tabNodeIds, workspace.activeTabNodeId, aliveIds);
    // 修剪结果即刻落盘（串行队列）：失效 id 出清，与后续恢复进度解耦
    queueSettingsWrite((settings) => ({
      ...settings,
      workspace: {
        ...settings.workspace,
        tabNodeIds: [...plan.restoreIds],
        activeTabNodeId: plan.activeId,
      },
    }));
    for (const id of plan.restoreIds) {
      if (!isAlive()) return;
      const meta = metaById.get(id);
      if (meta !== undefined) await openFile(meta, { restore: true });
    }
    if (!isAlive()) return;
    const plannedActive = plan.activeId;
    if (plannedActive !== null) {
      // 聚焦计划激活点：该点恢复失败（readFile 失败/触顶拒开）时保持末位现状，不指空
      setTabsOp((prev) =>
        prev.tabs.some((t) => t.meta.id === plannedActive)
          ? { ...prev, activeId: plannedActive }
          : prev,
      );
    }
  }

  // 树广播订阅（cleanup 成对）：结构同步 + stale 展开层重取（spec §4.3）；rename/move 后
  // meta 同步链（spec §6.1）：getNode 反查新鲜 meta 回写标签（selected 即 activeTab，
  // 路径/预览自然新鲜）；未开标签时 updateTabMeta 按 id 精确同步、无命中即无副作用
  useEffect(() => {
    const unsubscribe = window.api.onVfsChanged((broadcast) => {
      setRoots((prev) => applyBroadcast(prev, broadcast));
      const event = broadcast.event;
      if (event.type === 'renamed' || event.type === 'moved') {
        void window.api.getNode({ nodeId: event.nodeId }).then((result) => {
          if (result.ok) {
            setTabsOp((prev) => updateTabMeta(prev, result.value.id, result.value));
            // 新父层标记 stale（moved 展示同步的另一半，markStaleAround 只能标树内旧父）：
            // 契约广播不带目标父 id，从新鲜 meta.parentId 反查——已展开可见则 stale 重取
            // 效应立即可见新落点；折叠未装载时本标记为 no-op，展开时 onToggle 恒重取兜底
            const newParentId = result.value.parentId;
            if (newParentId !== null) {
              setRoots((prev) => markStale(prev, newParentId));
            }
          }
        });
      }
      // trash/purge 后剔除最近打开中的失效条目（事务提交后广播，宪法 B.3-4——到达即事实）
      if (event.type === 'trashed' || event.type === 'purged') {
        pruneDeadRecent();
      }
      // 状态栏文档总数刷新（M6 spec §2.6）：树变更广播后重查（COUNT 查询 <5ms，NFR-03 余量内）
      void window.api.countNodes().then((result) => {
        if (result.ok) setDocCount(result.value);
      });
    });
    return unsubscribe;
  }, []);

  // stale 重取：展开集变化或 roots 更新后，收集 stale 且已展开的节点逐个 listChildren
  useEffect(() => {
    const staleIds = collectStaleExpanded(roots, expanded);
    for (const id of staleIds) {
      void window.api.listChildren({ parentId: id }).then((result) => {
        if (result.ok) {
          setRoots((prev) =>
            replaceNode(prev, id, (node) =>
              withChildren(
                node,
                result.value.map((meta) => makeTreeRoot(meta)),
              ),
            ),
          );
        }
      });
    }
  }, [roots, expanded]);

  // 备份列表装载（M5 批次③ Task 9）：设置标签打开期间首拉 + backup:done 广播重拉；订阅随
  // 设置标签进出成对摘除（关闭即无列表可刷新，不必常驻监听），alive 防卸载后续体回写
  useEffect(() => {
    if (!tabsOp.settingsOpen) return undefined;
    let alive = true;
    const refresh = (): void => {
      void window.api.backupList().then((result) => {
        if (alive && result.ok) setBackups(result.value);
      });
    };
    refresh();
    const unsubscribe = window.api.onBackupDone(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tabsOp.settingsOpen]);

  // 数据目录布局装载（M6 批次③）：设置标签打开期间拉取（低频显式查询，随标签进出即可）
  useEffect(() => {
    if (!tabsOp.settingsOpen) return undefined;
    let alive = true;
    void window.api.getDataDirInfo().then((result) => {
      if (alive && result.ok) setStorageInfo(result.value);
    });
    return () => {
      alive = false;
    };
  }, [tabsOp.settingsOpen]);

  // 数据目录根路径挂载期装载（②树栏保存路径小字展示源）：挂载取一次即可——数据目录仅经
  // 设置「更改数据位置」迁移变更且迁移成功即重启应用，挂载期快照恒有效；上方设置期装载
  // effect 保留不动，两路共用同一 storageInfo 态
  useEffect(() => {
    let alive = true;
    void window.api.getDataDirInfo().then((result) => {
      if (alive && result.ok) setStorageInfo(result.value);
    });
    return () => {
      alive = false;
    };
  }, []);

  // io 进度订阅（M5 批次⑥ Task 12/13，挂载期常驻 + cleanup 成对摘除）：io:progress 广播
  // 为导入/导出可辨识联合（kind 判别字段，A.1-4），按 kind 分流入各自进度面板；完成态
  // 清理由 importNodes/exportNodes invoke 续体收口（toast + 收尾），广播不负责终态
  useEffect(() => {
    return window.api.onIoProgress((progress) => {
      if (progress.kind === 'import') {
        setImportProgress(progress);
      } else {
        setExportProgress(progress);
      }
    });
  }, []);

  function onToggle(id: number): void {
    // ⑤从实时镜像取「此刻」展开集而非渲染闭包旧值（快速连点防回滚）；镜像同步写先于
    // setState——同一事件内第二次点击读到的已是第一次写入后的集合
    const next = new Set(expandedRef.current);
    let willExpand: boolean;
    if (next.has(id)) {
      next.delete(id);
      willExpand = false;
    } else {
      next.add(id);
      // 仅展开分支需要懒加载拉取（折叠只是隐藏渲染，子级数据保留不重拉）
      willExpand = true;
    }
    expandedRef.current = next;
    setExpanded(next);
    if (willExpand) {
      // IPC 副作用在状态写入后发起（镜像已同步，时序确定；渲染期不发起任何副作用）
      void window.api.listChildren({ parentId: id }).then((result) => {
        if (result.ok) {
          setRoots((prev) =>
            replaceNode(prev, id, (node) =>
              withChildren(
                node,
                result.value.map((m) => makeTreeRoot(m)),
              ),
            ),
          );
        }
      });
    }
  }

  /**
   * 进入行内新建目录（M7，VS Code 式原地命名；树工具栏钮与菜单「新建目录」共用）：
   * 目标父未展开则先展开装载（命名行渲染于子级首位需父 loaded），已展开不动——避免
   * 重复拉取（onToggle 展开分支自带 listChildren 回写）。
   */
  function startCreateDir(parentId: number): void {
    // 目标父重复进入幂等（同值覆盖，连点无副作用）；展开判定读实时镜像（渲染闭包在
    // 连点场景下必陈旧，⑤同类问题）
    setCreatingDirParentId(parentId);
    if (!expandedRef.current.has(parentId)) onToggle(parentId);
  }

  /**
   * 行内命名提交（Enter / 失焦）：createNode 以用户输入名建目录，**成功与失败都收口命名行**
   * ——成功由 created 广播挂入树，失败 toast 呈现原因；失败不留在编辑态是刻意的（留在编辑态
   * 会让「用户已离开」的每次点击都重发一次失败请求并抢回焦点，构成焦点陷阱；与资源管理器
   * 「失败即结束，重试=再点新建」同语义）。
   * 在途守卫用 ref：同一任务内连发提交（程序化 blur / 自动化驱动）时状态量尚未提交值更新，
   * 闭包读到的仍是旧值，会穿透守卫重复上报——ref 写读同步，与 applyLayout 的 ref 先行记账同源。
   */
  function confirmCreateDir(parentId: number, name: string): void {
    if (createDirInFlightRef.current) return;
    createDirInFlightRef.current = true;
    void window.api.createNode({ parentId, name, nodeType: 'dir' }).then((result) => {
      createDirInFlightRef.current = false;
      if (!result.ok) showToast(`创建目录失败：${result.error.message}`);
      setCreatingDirParentId(null);
    });
  }

  /** 行内命名取消（Esc/失焦/空名 Enter） */
  function cancelCreateDir(): void {
    setCreatingDirParentId(null);
  }

  /**
   * 应用内确认（M8 反馈批次）：返回 Promise 的确认弹窗请求——调用点 `await` 后按布尔分支，
   * 与原生 window.confirm 的同步读值语义等价（原生框为 OS 皮肤、与应用设计语言脱节，
   * 用户实测反馈「弹窗需要优化样式设计」）。兑现器用 ref：同一任务内弹窗开合只经本函数
   * 与 settleConfirm 两个出口，ref 读写同步、不受 state 提交时序影响。
   */
  function askConfirm(request: {
    readonly title: string;
    readonly description: string;
    readonly confirmLabel: string;
    readonly destructive: boolean;
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmRequest(request);
    });
  }

  /** 确认弹窗落定（确认/取消共用出口）：先清请求态与兑现器，再兑现——防重复兑现与悬挂 */
  function settleConfirm(confirmed: boolean): void {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmRequest(null);
    resolve?.(confirmed);
  }

  /**
   * 导入 HTML 文件入口（树工具栏钮 / 菜单「导入 HTML 文件…」/Ctrl+N / 欢迎页共用）：
   * 主进程弹 HTML 文件选择框（单选，html/htm 过滤），取消（空清单）静默返回；选定即打开
   * 确认浮层，名称预填磁盘文件名（浮层内可改），目标父目录此刻推导（树选中上下文）。
   */
  function beginImportHtml(): void {
    void window.api.pickHtmlFile().then((picked) => {
      if (!picked.ok) {
        showToast(`选择 HTML 文件失败：${picked.error.message}`);
        return;
      }
      const file = picked.value[0];
      if (file === undefined) return; // 用户取消选择：不弹确认浮层
      setImportHtmlDraft({ sourcePath: file, targetParentId: deriveTreeContextParentId() });
    });
  }

  /**
   * 确认导入文件：io:import 单文件源（conflict 固定 rename——浮层已承载显式命名，重名
   * 递增 `name (2).ext` 不打断）+ sourceName（导入即重命名）。结果收口四件事：
   * ① toast 计数（D17 口径）；② 树刷新双通道（confirmImport 同款：整树 stale + 目标父
   * 直调回写——合成根与已折叠已装载目录两个 stale 盲区由直调补口）；③ 导入即打开：
   * importedNodeIds[0] 反查 meta 走 openFile 统一入口（HTML → 画布所见即所得渲染）；
   * ④ 进度面板收口 setImportProgress(null)（与 confirmImport 同款——成功失败都收，漏写
   * 会让面板在 io:progress 广播后永不消失，触发退场过渡）。
   * 失败 toast 并保留浮层（源文件/目标仍有效时可改名重试）。
   * @param name 浮层名称输入（trim 非空，空名确认钮已禁用不达此处）
   */
  function confirmImportHtml(name: string): void {
    if (importHtmlDraft === null) return;
    const draft = importHtmlDraft;
    setImportHtmlInFlight(true);
    void window.api
      .importNodes({
        sourcePaths: [draft.sourcePath],
        targetParentId: draft.targetParentId,
        conflict: 'rename',
        sourceName: name,
      })
      .then((result) => {
        setImportHtmlInFlight(false);
        // 进度面板收口：invoke 返回即终态（无论成败），置 null 交由退场存在性 hook 播过渡
        setImportProgress(null);
        if (result.ok) {
          setImportHtmlDraft(null);
          const { imported, skipped, failed, importedNodeIds } = result.value;
          showToast(`导入完成：新增 ${imported}、跳过 ${skipped}、失败 ${failed}`);
          setRoots((prev) => markAllStale(prev));
          // 盲区补口：目标父目录子级直调回写（onToggle 同款 withChildren 形态）
          void window.api.listChildren({ parentId: draft.targetParentId }).then((children) => {
            if (children.ok) {
              setRoots((prev) =>
                replaceNode(prev, draft.targetParentId, (node) =>
                  withChildren(
                    node,
                    children.value.map((meta) => makeTreeRoot(meta)),
                  ),
                ),
              );
            }
          });
          // 导入即打开：跳过名称反查（rename 策略可能递增改名），新节点 id 直寻
          const newNodeId = importedNodeIds[0];
          if (newNodeId !== undefined) {
            void window.api.getNode({ nodeId: newNodeId }).then((meta) => {
              if (meta.ok) void openFile(meta.value);
            });
          }
        } else {
          showToast(`导入失败：${result.error.message}`);
        }
      });
  }

  /** 取消导入文件（浮层取消钮/Esc）：清草稿即关闭（无在途写侧副作用需回滚） */
  function cancelImportHtml(): void {
    setImportHtmlDraft(null);
  }

  function onTrash(nodeId: number): void {
    void window.api.trashNode({ nodeId }).then((result) => {
      // 标签存在（CM 会话或画布/媒体标签）则经 closeTabById 收场（flush 落库 → 管线/会话/
      // 画布缓存/标签同步清理，资源成对）；激活态补位由 closeTab 状态机承担（右邻优先）
      if (
        result.ok &&
        (sessions.has(nodeId) || tabsRef.current.tabs.some((t) => t.meta.id === nodeId))
      ) {
        closeTabById(nodeId);
      }
    });
  }

  /**
   * 树侧定位（spec §2.2 两条路径共用：点击「定位打开」的树侧展开 + 「在树中显示」）：
   * 按命中 virtualPath 逐段 resolvePath 求祖先链 id → 逐层 listChildren 就地补拉子级
   * （树懒加载语义：仅并入展开集不会自动装载未加载层，须 onToggle 同款 withChildren 回写；
   * 层间 await 串行，保证下层 graft 时上层 children 已入 React updater 队列）→ 展开集合
   * 并入 + reveal 选中覆盖。祖先段解析失败静默跳过（容错不抛错，后续层级照常）。
   * 目录命中连同其自身展开（子级可见——「展开选中」），文件命中展开至父级止。
   * 消费形态：onOpen 为 fire-and-forget（openFile 并行，开签后 activeId 变化自动收走
   * 覆盖选中）；onReveal 在其完成后由调用侧 setView('tree') 回树。
   */
  async function revealInTree(node: NodeMeta): Promise<void> {
    setRevealSelectionId(node.id);
    const segments = node.virtualPath.split('/').filter((segment) => segment !== '');
    const levels = node.nodeType === 'dir' ? segments.length : segments.length - 1;
    const expandIds = new Set<number>();
    for (let level = 1; level <= levels; level += 1) {
      const path = `/${segments.slice(0, level).join('/')}`;
      const resolved = await window.api.resolvePath({ virtualPath: path });
      if (!resolved.ok) continue;
      const ancestorId = resolved.value.nodeId;
      expandIds.add(ancestorId);
      const children = await window.api.listChildren({ parentId: ancestorId });
      if (children.ok) {
        setRoots((prev) =>
          replaceNode(prev, ancestorId, (n) =>
            withChildren(
              n,
              children.value.map((meta) => makeTreeRoot(meta)),
            ),
          ),
        );
      }
    }
    // 展开并集基于实时镜像计算（异步续体里渲染闭包 expanded 必陈旧，⑤同款镜像纪律）；
    // 并集只增不减、天然幂等，连续多次 reveal 互不覆盖
    const merged = new Set(expandedRef.current);
    for (const id of expandIds) merged.add(id);
    expandedRef.current = merged;
    setExpanded(merged);
  }

  /**
   * 设置全量串行写（recent/workspace/appearance/preview/editor 域唯一写出口）：get→apply→set
   * 经 promise 链逐笔串行。串行化的必要性：启动恢复期多个记录点近同时完成，裸并发读改写
   * 各自读到同一旧值、后写覆盖先写丢条目；串行链使每笔写基于前一笔落盘后的全量。返回本笔
   * 写结果（false = get 失败放弃 / set 失败 / IPC 层异常），供设置页表单「失败 toast 回滚
   * 显示」消费；链尾 catch 维持吞异常不断链语义（queueSettingsWrite 同口径）。
   */
  function enqueueSettingsWrite(
    apply: (settings: SettingsData) => SettingsData | Promise<SettingsData>,
  ): Promise<boolean> {
    const outcome = new Promise<boolean>((resolve) => {
      settingsWriteChainRef.current = settingsWriteChainRef.current
        .then(async () => {
          try {
            const current = await window.api.settingsGet();
            if (!current.ok) {
              resolve(false);
              return;
            }
            const written = await window.api.settingsSet(await apply(current.value));
            resolve(written.ok);
          } catch {
            resolve(false);
          }
        })
        .catch(() => {
          resolve(false);
        });
    });
    return outcome;
  }

  /** 既有 fire-and-forget 口径（recent/workspace/布局写入方）：结果不消费 */
  function queueSettingsWrite(
    apply: (settings: SettingsData) => SettingsData | Promise<SettingsData>,
  ): void {
    void enqueueSettingsWrite(apply);
  }

  // —— 主题装配（M5 批次③ Task 8，spec §4.3 D10）——

  /**
   * 主题装配 effect：意图 → resolveTheme 解析 → documentElement .dark 切换（设计系统文档
   * §八双主题唯一开关）；编辑器侧外观经 resolvedTheme props 传导至 EditorPanel 的外观
   * compartment 同 state 重配（doc/undo/光标/滚动全保留）。system 态经 matchMedia 监听
   * 跟随系统偏好，监听随 effect 进出成对挂卸。评审 Minor 1 守卫：解析主题与字号均未变化
   * 时 setResolvedTheme bail-out → EditorPanel 外观 props 不变 → 零重配派发（显式
   * light/dark 下系统偏好翻转不再触发编辑器换装）。
   */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (): void => {
      const resolved = resolveTheme(themeIntent, media.matches);
      // .dark 挂文档根元素：语义变量与 dark: 变体全站即时生效（切换零重排）
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      // 值不变时返回原 state 触发 bail-out，避免无谓提交（首次装配同值亦不产生第二次渲染）
      setResolvedTheme((prev) => (prev === resolved ? prev : resolved));
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => {
      media.removeEventListener('change', applyTheme);
    };
  }, [themeIntent]);

  // —— 设置页表单回调（M5 批次③ Task 8）：即改即存 + 失败 toast 回滚显示 ——

  /**
   * 主题意图变更：意图入 state（.dark 切换与编辑器外观重配由主题装配 effect 派生应用，
   * 回滚亦同路径逆放）；持久化失败 toast 后回滚意图
   */
  function changeThemeIntent(intent: ThemeIntent): void {
    const previous = themeIntent;
    setThemeIntent(intent);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      appearance: { ...settings.appearance, theme: intent },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setThemeIntent(previous);
      }
    });
  }

  /** 编辑器字号变更：状态即改即存（EditorPanel 经外观 props 变化同 state 重配），失败回滚显示 */
  function changeEditorFontSize(fontSize: number): void {
    const previous = editorFontSize;
    setEditorFontSize(fontSize);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      appearance: { ...settings.appearance, editorFontSize: fontSize },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setEditorFontSize(previous);
      }
    });
  }

  /** 预览去抖变更：状态即改即存（SaveController 经 settingsRef 镜像读取新值），失败回滚显示 */
  function changeDebounceMs(debounceMs: number): void {
    const previous = debounceMs;
    setDebounceMs(debounceMs);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      preview: { debounceMs },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setDebounceMs(previous);
      }
    });
  }

  /** 自动保存间隔变更：同预览去抖口径 */
  function changeAutoSaveMs(autoSaveMs: number): void {
    const previous = autoSaveMs;
    setAutoSaveMs(autoSaveMs);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      editor: { autoSaveMs },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setAutoSaveMs(previous);
      }
    });
  }

  /** 每日自动备份开关变更（backup 域即改即存）：同外观/编辑器域失败 toast 回滚口径 */
  function changeBackupAutoEnabled(enabled: boolean): void {
    const previous = backupAutoEnabled;
    setBackupAutoEnabled(enabled);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      backup: { autoEnabled: enabled },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setBackupAutoEnabled(previous);
      }
    });
  }

  /** 启动恢复工作区开关变更（workspace 域即改即存）：同备份域失败 toast 回滚口径；
      workspace 域合并保留 tabNodeIds/activeTabNodeId（域整体替换会清空会话记录） */
  function changeRestoreOnStart(enabled: boolean): void {
    const previous = restoreOnStart;
    setRestoreOnStart(enabled);
    void enqueueSettingsWrite((settings) => ({
      ...settings,
      workspace: { ...settings.workspace, restoreOnStart: enabled },
    })).then((ok) => {
      if (!ok) {
        showToast('设置保存失败，已恢复原值');
        setRestoreOnStart(previous);
      }
    });
  }

  /** 立即备份：低频显式操作；成败 toast 呈现，列表刷新经 backup:done 广播到达 */
  function createBackupNow(): void {
    void window.api.backupCreate().then((result) => {
      if (result.ok) {
        showToast(`已创建备份 ${result.value.fileName}`);
      } else {
        showToast(`备份失败：${result.error.message}`);
      }
    });
  }

  /**
   * 还原到指定备份（数据覆盖级操作，已经 alert-dialog 强确认到达）：成功响应
   * { relaunch: true } 后主进程随即重启——本调用续体可能因进程退出不落地，故成功侧
   * 不做任何 UI 收尾；失败（未达 relaunch）toast 呈现原因
   */
  function restoreBackupNow(fileName: string): void {
    void window.api.backupRestore({ fileName }).then((result) => {
      if (!result.ok) {
        showToast(`还原失败：${result.error.message}`);
      }
    });
  }

  // —— 数据目录域（M6 批次③，FR-AUX-03 修订版）：打开 / 更改迁移 ——

  /** 打开当前数据目录（root 已在主进程启动期登记入册，openPath 登记簿校验直达） */
  function openStorageDir(): void {
    if (storageInfo === null) return;
    void window.api.openPath({ dir: storageInfo.root }).then((result) => {
      if (!result.ok) {
        showToast(`打开目录失败：${result.error.message}`);
      }
    });
  }

  /**
   * 更改数据位置入口：主进程弹目录选择框（单选，产出即入登记簿），取消静默；选定即打开
   * 强确认弹层（迁移为全库覆盖级动作，列明迁移内容与重启语义）
   */
  function beginChangeStorageDir(): void {
    void window.api.pickDirectory({ multiple: false }).then((picked) => {
      if (!picked.ok) {
        showToast(`选择数据目录失败：${picked.error.message}`);
        return;
      }
      const dir = picked.value[0];
      if (dir === undefined) return; // 用户取消选择：不弹确认层
      setStorageChangeTarget(dir);
    });
  }

  /**
   * 确认迁移（数据覆盖级操作，已经 alert-dialog 强确认到达）：发起 storage:change-data-dir
   * ——成功响应 { relaunch: true } 后主进程随即重启，续体可能不落地故成功侧不做 UI 收尾；
   * 失败（未达 relaunch）toast 呈现原因并清确认态
   */
  function confirmChangeStorageDir(): void {
    if (storageChangeTarget === null) return;
    void window.api.changeDataDir({ targetDir: storageChangeTarget }).then((result) => {
      if (!result.ok) {
        showToast(`数据迁移失败：${result.error.message}`);
        setStorageChangeTarget(null);
      }
    });
  }

  // —— 导入链路（M5 批次⑥ Task 12，FR-IO-01）：目录选择 → 策略确认弹层 → io:import ——

  /**
   * 树选中上下文父推导（导入目标 / 菜单新建目录 / 文件导入的共用锚，M7 自 deriveImportTargetParentId
   * 泛化改名）：取树选中上下文（reveal 覆盖选中 ?? 激活标签对应节点——与 TreePanel
   * selectedId 同源），命中且为目录即取其 id；文件选中/无命中/无选中一律回落根。④起目录
   * 点选即置 reveal 选中，目录不开标签也能成为新建/导入落点（与搜索「在树中显示」同源语义）。
   */
  function deriveTreeContextParentId(): number {
    const selectedId = selectedTreeId;
    if (selectedId === null) return ROOT_ID;
    const node = findNode(roots, selectedId);
    return node !== null && node.meta.nodeType === 'dir' ? node.meta.id : ROOT_ID;
  }

  /**
   * 导入入口（菜单「导入…」命令唯一触发）：主进程弹目录选择框（多选），取消（空清单）
   * 静默返回；选定即打开确认弹层，目标父目录此刻推导、策略默认跳过（spec §7.1）。
   */
  function beginImport(): void {
    void window.api.pickDirectory({ multiple: true }).then((picked) => {
      if (!picked.ok) {
        showToast(`选择导入目录失败：${picked.error.message}`);
        return;
      }
      if (picked.value.length === 0) return; // 用户取消选择：不弹确认层
      setImportDraft({
        sourcePaths: picked.value,
        targetParentId: deriveTreeContextParentId(),
        conflict: 'skip',
      });
    });
  }

  /**
   * 确认导入：发起 io:import（长任务，invoke 结果即终态收口）——清弹层；结果到达后
   * 清进度面板、D17 计数 toast、树刷新双通道：① 整树标记 stale（已展开目录经既有
   * stale 重取效应刷新）；② 目标父目录子级直接 listChildren 回写（评审 Important：
   * 合成根永不在 expanded 集、已装载已折叠目录不进 stale 收集——两盲区由直调补口，
   * 与 ① 并存互不依赖，导入默认落点=根由此保证顶层新项立即可见）。批量导入无逐节点
   * 广播，树刷新统一在结果收口（无逐节点 VfsChanged）。
   */
  function confirmImport(): void {
    if (importDraft === null) return;
    const draft = importDraft;
    setImportDraft(null);
    // 载荷按契约展开为可变数组（ImportRequest zod 形态；draft 态保持 readonly 不可变，A.1-10）
    void window.api
      .importNodes({
        sourcePaths: [...draft.sourcePaths],
        targetParentId: draft.targetParentId,
        conflict: draft.conflict,
      })
      .then((result) => {
        setImportProgress(null);
        if (result.ok) {
          const { imported, skipped, failed } = result.value;
          showToast(`导入完成：新增 ${imported}、跳过 ${skipped}、失败 ${failed}`);
          setRoots((prev) => markAllStale(prev));
          // 盲区补口：目标父目录子级直调回写（onToggle 同款 withChildren 形态；
          // withChildren 置 stale=false，本节点退出 stale 重取，避免二次冗余拉取）
          void window.api.listChildren({ parentId: draft.targetParentId }).then((children) => {
            if (children.ok) {
              setRoots((prev) =>
                replaceNode(prev, draft.targetParentId, (node) =>
                  withChildren(
                    node,
                    children.value.map((meta) => makeTreeRoot(meta)),
                  ),
                ),
              );
            }
          });
        } else {
          showToast(`导入失败：${result.error.message}`);
        }
      });
  }

  /** 取消导入：按进度载荷中的 importId 寻址（首个进度广播到达即可取消，D16 当前批完成后停） */
  function cancelRunningImport(): void {
    const progress = importProgress;
    if (progress === null) return;
    void window.api.cancelImport({ importId: progress.importId });
  }

  // —— 导出链路（M5 批次⑥ Task 13，FR-IO-02）：选中子树 → 目录选择 → io:export → 完成动作 ——

  /**
   * 导出入口（菜单「导出…」命令唯一触发）：导出目标读 exportSelectionRef 实时镜像
   * （命令回调闭包态必陈旧），无选中先引导提示；主进程弹目录选择框（单选），取消
   * （空清单）静默返回；选定即发起 io:export（长任务，invoke 结果即终态收口）——
   * 完成清进度面板、计数 toast 携带「打开目录」动作钮（openPath 回传本次对话框产出的
   * 目录串，主进程按登记簿校验后经系统文件管理器打开）。
   */
  function beginExport(): void {
    const nodeId = exportSelectionRef.current;
    if (nodeId === null) {
      showToast('请先在树中选择要导出的文件夹或文件');
      return;
    }
    void window.api.pickDirectory({ multiple: false }).then((picked) => {
      if (!picked.ok) {
        showToast(`选择导出目录失败：${picked.error.message}`);
        return;
      }
      const dir = picked.value[0];
      if (dir === undefined) return; // 用户取消选择：静默返回
      void window.api.exportNodes({ nodeId, targetDir: dir }).then((result) => {
        setExportProgress(null);
        if (result.ok) {
          const { exported, skipped, failed } = result.value;
          showToast(`导出完成：写出 ${exported}、跳过 ${skipped}、失败 ${failed}`, {
            label: '打开目录',
            onClick: () => {
              void window.api.openPath({ dir });
            },
          });
        } else {
          showToast(`导出失败：${result.error.message}`);
        }
      });
    });
  }

  /**
   * 最近打开记录点（openFile 聚焦/新建两会话分支共用）：时刻由写入方以本地 ISO 补齐
   * （shared/time.ts 既有格式），经串行队列全量 get→merge→set 写 recent 域。断言理由
   * （A.1-5）：recordRecent 顶部条目盖 now 戳、其余元素原样透传，入参来自 settings 持久化
   * 形态（全元素含 openedAt），输出按超集知识收窄回 RecentEntry[]。
   */
  function recordRecentOpen(node: NodeMeta): void {
    const entry: RecentInput = { nodeId: node.id, virtualPath: node.virtualPath, name: node.name };
    // 欢迎页镜像同步置顶：recordRecent 顶部条目盖 now 戳、输出为 RecentEntry[]（断言理由
    // 同下方持久化写入方——入参形态来自 settings 持久化值，A.1-5 超集知识收窄）
    setRecentOpened(
      (prev) => recordRecent(prev, entry, toLocalIsoTime(new Date())) as RecentEntry[],
    );
    queueSettingsWrite((settings) => ({
      ...settings,
      recent: {
        opened: recordRecent(
          settings.recent.opened,
          entry,
          toLocalIsoTime(new Date()),
        ) as RecentEntry[],
      },
    }));
  }

  /**
   * 工作区会话持久化（节流尾沿写体）：读 tabsRef 实时镜像（事件闭包 tabsOp 必陈旧），
   * 全量 get→merge→set 写 workspace 域；restoreOnStart 用户开关原样保留。
   * 激活态为设置哨兵（'settings'）时落 null——workspace 域只记 doc 标签，设置标签不恢复
   */
  function persistTabsFromRef(): void {
    const op = tabsRef.current;
    queueSettingsWrite((settings) => ({
      ...settings,
      workspace: {
        ...settings.workspace,
        tabNodeIds: op.tabs.map((t) => t.meta.id),
        activeTabNodeId: typeof op.activeId === 'number' ? op.activeId : null,
      },
    }));
  }

  /**
   * 最近打开失效剔除（trash/purge 广播后，回收站面板与树栏删除两入口共同经广播到达）：
   * 对持久化条目逐个 getNode 验活（trash/purge 节点一律 NOT_FOUND），存活集外全部剔除并
   * 写回。断言理由（A.1-5）：pruneRecentByNodes 为纯过滤透传，输出元素即输入元素（含
   * openedAt）。验活在队列续体内对 freshly-get 的列表执行，与并发写天然不竞态。
   */
  function pruneDeadRecent(): void {
    queueSettingsWrite(async (settings) => {
      const opened = settings.recent.opened;
      const aliveFlags = await Promise.all(
        opened.map((entry) => window.api.getNode({ nodeId: entry.nodeId }).then((r) => r.ok)),
      );
      const aliveIds = new Set(
        opened.filter((_, i) => aliveFlags[i] === true).map((entry) => entry.nodeId),
      );
      const pruned = pruneRecentByNodes(opened, aliveIds) as RecentEntry[];
      // 欢迎页镜像同步剔除（与持久化同一过滤结果）
      setRecentOpened(pruned);
      return {
        ...settings,
        recent: { opened: pruned },
      };
    });
  }

  // —— 树 rename/move（M4 spec §6.2 D8）——
  // move 模式派生量（渲染期纯读）：源 = 进入模式时直传的 id（Task 10 起不再锚 activeId），
  // 目标为自身/其后代时确认禁用 + 提示（isDescendant 不含自身，自移在此并判）
  const moveSourceId = moveMode?.sourceId ?? null;
  const moveTargetId = moveMode !== null ? moveMode.targetId : null;
  const moveInvalid =
    moveSourceId !== null &&
    moveTargetId !== null &&
    (moveTargetId === moveSourceId || isDescendant(roots, moveSourceId, moveTargetId));
  // 目录点选模式合成（M7：TreePanel 以单组 props 承载 move / import-html 两流程——
  // dir 点选=选定目标、file 点选禁用、目标高亮；两流程互斥，同时仅一流程在途）
  const dirPickMode = moveMode !== null || importHtmlDraft !== null;
  const pickTargetId =
    moveMode !== null ? moveMode.targetId : (importHtmlDraft?.targetParentId ?? null);

  /**
   * 树点选统一入口：目录点选模式下 dir 点选临时变为「选定目标」记账（file 点选已被
   * TreePanel 禁用），合法性判定归各流程确认钮——move 记账 moveMode.targetId，HTML 文件
   * 导入改写 importHtmlDraft.targetParentId（M7：非模态浮层打开期间树中点选目录即改导入
   * 位置）。常规模式下：④目录点选 = 记账树选中（reveal 覆盖机制天然支持目录高亮，且目录
   * 点选不改 activeId——选中持续保持，新建/导入落点随点选目录）；文件节点照旧 openFile
   * （activeId 变化自动收走 reveal 覆盖，树选中迁移到新标签节点）
   */
  function onSelectNode(node: NodeMeta): void {
    if (moveMode !== null) {
      if (node.nodeType === 'dir') {
        setMoveMode((prev) => (prev === null ? prev : { ...prev, targetId: node.id }));
      }
      return;
    }
    if (importHtmlDraft !== null) {
      if (node.nodeType === 'dir') {
        setImportHtmlDraft((prev) => (prev === null ? prev : { ...prev, targetParentId: node.id }));
      }
      return;
    }
    if (node.nodeType === 'dir') {
      setRevealSelectionId(node.id);
      return;
    }
    openFile(node);
  }

  /**
   * 进入 move 选择模式（树工具栏钮 / 行内「⋯」菜单共用）：源 = 入参 id 直传
   * （Task 10 起脱离 selectedId 锚），目标待点选
   */
  function startMove(id: number): void {
    setMoveMode({ sourceId: id, targetId: null });
  }

  /** 确认移动：目标非法/未定直接返回（钮已禁用的同源守卫）；成功退出模式，失败 toast 保留模式可重试 */
  function confirmMove(): void {
    if (moveSourceId === null || moveTargetId === null || moveInvalid) return;
    setMoveInFlight(true);
    void window.api.moveNode({ nodeId: moveSourceId, targetDirId: moveTargetId }).then((result) => {
      setMoveInFlight(false);
      if (result.ok) {
        // 成功退出选择模式；树路径展示与标签 meta 由 moved 广播链刷新（spec §6.1）
        setMoveMode(null);
      } else {
        showToast(`移动失败：${result.error.message}`);
      }
    });
  }

  /** 重命名入口（树工具栏钮 / 行内「⋯」菜单共用）：取树内当前名预填模态；树未命中静默忽略（菜单入口以本行 id 直传） */
  function onRename(id: number): void {
    const node = findNode(roots, id);
    if (node === null) return;
    setRenameTarget({ id, name: node.meta.name });
  }

  /** 确认重命名：成功关闭模态，失败 toast 保留模态可改后重试；树/meta 由 renamed 广播链刷新 */
  function confirmRename(newName: string): void {
    if (renameTarget === null) return;
    setRenameInFlight(true);
    void window.api.renameNode({ nodeId: renameTarget.id, newName }).then((result) => {
      setRenameInFlight(false);
      if (result.ok) {
        setRenameTarget(null);
      } else {
        showToast(`重命名失败：${result.error.message}`);
      }
    });
  }

  // move 选择模式 Esc 退出（spec §6.2 D8）与导入确认浮层 Esc 关闭（M7）：keydown 监听
  // 随各自模式进出成对挂卸；二者互斥（dirPickMode 由两流程共用，同时仅一流程在途）
  useEffect(() => {
    if (moveMode === null && importHtmlDraft === null) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMoveMode(null);
        setImportHtmlDraft(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moveMode, importHtmlDraft]);

  /**
   * 视图切离统一入口（Task 4 deferred Esc 双监听耦合的顺手闭环，M5 批次④ Task 10）：
   * search/trash 态内容不含 move 选择条，moveMode 若带离 tree 会在返回后带残态复现
   * （且双 Esc 监听并存时一次按键双态齐动）——切离即复位；返回 tree 不经此口。
   * M6 起活动视图写统一经 updateLayout（本地态 + shell.layout v4 持久化一次完成）
   */
  function switchViewAway(next: Exclude<TreePaneView, 'tree'>): void {
    setMoveMode(null);
    setImportHtmlDraft(null);
    updateLayout({ activityView: next });
    setView(next);
  }

  /** 活动视图统一写入口（活动栏点击/Esc 返回共用）：持久化 + 本地态一次完成 */
  function switchView(next: TreePaneView): void {
    if (next !== 'tree') {
      setMoveMode(null);
      setImportHtmlDraft(null);
    }
    updateLayout({ activityView: next });
    setView(next);
  }

  // search/trash 态 Esc 返回资源树（M5 → M6 活动视图语义）：与 moveMode Esc 同款 window
  // 级成对挂卸；search/trash 态下 Esc 退出（spec §2.2），输入焦点不阻断（window 级监听）
  useEffect(() => {
    if (view === 'tree') return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') switchView('tree');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [view]);

  /**
   * 打开文件为标签（树点选/新建文件/启动恢复统一入口），三分流（M6 spec §3.3/D4/D6）：
   * ① HTML → 画布标签（不读库不建 CM 会话，iframe 经 vfs:// 直载，所见即所得编辑）；
   * ② 媒体（image/audio）→ 媒体标签（MediaCanvas 原生组件直载，无会话）；
   * ③ 其余文本 → 大小三分支前置判定（spec §2.4 裁决 D7）→ readFile → CM 会话（二进制
   *    非媒体的二进制维持拒开 toast）。
   * 三分流共同尾段：同文件唯一实例仅聚焦（聚焦/新建都记录 recent 域、尾沿写 workspace 域）。
   * CM 分支的 opts.restore（M5 批次② D7 恢复豁免）：启动恢复路径跳过 5–50MB 征询（会话
   * 重建不得卡在启动模态），>50MB 拒开与 MAX_TABS 护栏照常生效；HTML/媒体分支浏览器直载
   * 无建档卡顿，无征询语义。await 化使启动恢复可顺序驱动（标签序 = 会话序）。
   * @param node 目标文件节点 meta（树数据/恢复验活反查所得）
   * @param opts.restore 是否为启动恢复式打开（true 时豁免软阈值 confirm；缺省 false）
   * @returns 打开流程完成信号（拒绝/失败亦正常返回；恢复链据此串行推进）
   */
  async function openFile(node: NodeMeta, opts?: { readonly restore?: boolean }): Promise<void> {
    const mediaKind = node.mimeType !== null ? previewableMime(node.mimeType) : null;
    // HTML 与媒体：画布直载（无 CM 会话、无大文件征询）；MAX_TABS 护栏仍生效
    if (node.mimeType === 'text/html' || mediaKind !== null) {
      // 同开上限护栏：必须先判满再进标签状态机（openTab 触顶静默拒开，防标签集与预期脱节）；
      // 判定读 tabsRef 实时态（闭包 tabsOp 在并发续体下必陈旧）
      const alreadyOpen = tabsRef.current.tabs.some((t) => t.meta.id === node.id);
      if (!alreadyOpen && tabsRef.current.tabs.length >= MAX_TABS) {
        showToast(`最多同时打开 ${MAX_TABS} 个标签，请先关闭部分标签`);
        return;
      }
      recordRecentOpen(node);
      setTabsOp((prev) => openTab(prev, node));
      tabWriteThrottleRef.current?.call();
      return;
    }
    if (node.mimeType === null || !isTextLike(node.mimeType)) {
      showToast('该文件类型暂不支持打开（仅 HTML/媒体/文本）');
      return;
    }
    // 大小三分支前置判定（spec §2.4 裁决 D7，阈值 5MB/50MB；size 为字节——NodeMeta 契约）：
    // >50MB 直接拒开且不发起 readFile（超大文档读入解码必拖垮渲染层，无征询意义）；5–50MB
    // 经用户确认放行（大文档 CM 建档可能卡顿，交由用户权衡；恢复路径豁免征询——启动期无人
    // 应答模态，红线仍生效）；≤5MB 直开（现行为）。判定只读 meta 本地字段、同步完成，天然
    // 早于任何 IPC；MAX_TABS 判满仍留在 readFile 续体内——tabsRef 实时态只在异步续体时刻
    // 才有意义（快速连点的中间态），前置同步判定反而引入并发窗口（见续体内注释）
    if (node.size > LARGE_FILE_HARD_LIMIT_BYTES) {
      showToast('文件超过 50MB，无法打开');
      return;
    }
    if (
      node.size > LARGE_FILE_SOFT_LIMIT_BYTES &&
      opts?.restore !== true &&
      !(await askConfirm({
        title: '打开大文件',
        description: '大文件打开可能卡顿，是否继续？',
        confirmLabel: '继续打开',
        destructive: false,
      }))
    ) {
      return;
    }
    const result = await window.api.readFile({ nodeId: node.id });
    if (!result.ok) {
      showToast(`打开失败：${result.error.message}`);
      return;
    }
    // 同文件唯一实例（tabModel openTab 幂等语义）：会话已在，聚焦既有标签即可；聚焦同样是
    // 「最近使用」，与新建分支一样记录 recent + 尾沿写 workspace 激活态
    if (sessions.has(node.id)) {
      recordRecentOpen(node);
      setTabsOp((prev) => openTab(prev, node));
      tabWriteThrottleRef.current?.call();
      return;
    }
    // 同开上限护栏（spec §3「同开上限 20（超限提示先关）」）：必须先判满再建会话——
    // openTab 触顶静默拒开，若先 sessions.open 会残留无标签的孤儿会话（悬挂会话时序
    // 缺陷）；判定读 tabsRef 实时态，闭包 tabsOp 在并发续体下必陈旧
    if (tabsRef.current.tabs.length >= MAX_TABS) {
      showToast(`最多同时打开 ${MAX_TABS} 个标签，请先关闭部分标签`);
      return;
    }
    // mimeType 已过 isTextLike 白名单，`??` 仅为可空契约的收尾窄化
    sessions.open(
      node.id,
      createEditorState({
        doc: new TextDecoder().decode(result.value.content),
        mimeType: node.mimeType ?? 'text/plain',
        handlers: {
          // 库以新实例整体替换 state（A.1-9）：会话态同步 + 输入回路进保存管线（双计时器调度落库）
          onDocChanged: (text, state) => {
            sessions.updateState(node.id, state);
            saveController.edit(node.id, text);
          },
          onScroll: (top) => sessions.updateScroll(node.id, top),
        },
        // 外观参数取当前渲染闭包值（openFile 每次渲染重建，事件时刻即最新外观）
        appearance: { theme: resolvedTheme, fontSize: editorFontSize },
      }),
    );
    recordRecentOpen(node);
    setTabsOp((prev) => openTab(prev, node));
    tabWriteThrottleRef.current?.call();
  }

  /**
   * HTML 画布编辑上报（M6 spec §3.3）：lt:doc-edit 序列化结果进画布缓存（getDoc 事实源）
   * 并驱动保存管线（双计时器调度落库）——替代 CM updateListener 在 HTML 路径的位置
   */
  function handleDocEdit(nodeId: number, html: string): void {
    canvasDocsRef.current.set(nodeId, html);
    saveController.edit(nodeId, html);
  }

  /**
   * 关闭标签（TabBar/onTrash 共用入口）：先 flush 确保脏内容落库，再清管线态与会话、
   * 摘标签（spec §2.2-5 关标签 flush 后关）；flush 遇写在途/失败态的确认放弃交互
   * 归 M4 打磨批次，此处 flush 后即关
   */
  function closeTabById(id: number): void {
    saveController.flush(id);
    saveController.tabClosed(id);
    sessions.close(id);
    canvasDocsRef.current.delete(id); // HTML 画布缓存随签清理（资源成对）
    setTabsOp((prev) => closeTab(prev, id));
    tabWriteThrottleRef.current?.call(); // 标签集/激活态变更 → workspace 域尾沿写（D8）
  }

  /**
   * 激活标签（TabBar 点选统一入口）：仅改 activeId（tabs 不动），workspace 域随尾沿写
   */
  function activateTab(id: number): void {
    setTabsOp((prev) => ({ ...prev, activeId: id }));
    tabWriteThrottleRef.current?.call();
  }

  /**
   * 布局本地应用（FR-SHELL-01）：仅更新本地态，不触发持久化。拖拽 pointermove 高频路径
   * 专用——若每次移动都 get→merge→set 写设置将造成 settings 写风暴；ref 先行同步记账，
   * 保证 pointerup 持久化读到最终比例（不依赖 React 提交时序）
   */
  function applyLayout(patch: Partial<ShellLayout>): void {
    layoutRef.current = { ...layoutRef.current, ...patch };
    setLayout(layoutRef.current);
  }

  /**
   * 布局持久化：get→merge→set 全量写回（Task 1 settings 全量读写语义，shell 域整体替换，
   * preview/editor 域原样保留）；get 失败静默放弃本次写回（服务侧默认值兜底，无本地可回退态）
   */
  function persistLayout(next: ShellLayout): void {
    void window.api.settingsGet().then((r) => {
      if (r.ok) void window.api.settingsSet({ ...r.value, shell: { layout: next } });
    });
  }

  /** 折叠切换统一入口（单击语义，无高频风险）：本地态与持久化一次完成 */
  function updateLayout(patch: Partial<ShellLayout>): void {
    applyLayout(patch);
    persistLayout(layoutRef.current);
  }

  /**
   * 侧栏宽度拖拽：pointermove 仅本地态（写风暴防护，见 applyLayout），pointerup 一次性
   * 持久化；监听器 window 级成对移除（资源成对纪律）。偏移取容器左缘，换算与钳制归
   * layoutModel 纯函数。拖拽期三处视觉/命中态（见 onDividerPointerDown 内注释）
   */
  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    const host = e.currentTarget.parentElement;
    if (host === null) return;
    // 拖拽态：aside 摘除宽度过渡（直跟手）、分隔条颜色加深一档（「已接管」台阶）、
    // 画布指针穿透、光标与选区全局固化
    setSidebarDragging(true);
    document.body.classList.add('lt-col-dragging');
    const onMove = (move: PointerEvent): void => {
      const rect = host.getBoundingClientRect();
      const offset = move.clientX - rect.left;
      applyLayout({ sidebarWidthRatio: ratioFromPointer(rect.width, offset) });
    };
    // 收口（抬起与异常取消同路径）：先恢复过渡能力与光标（清态瞬间宽度未变，不会触发过渡），
    // 再落库最终比例；pointercancel 必须同清理——漏摘态会把画布永久置为 pointer-events-none
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setSidebarDragging(false);
      document.body.classList.remove('lt-col-dragging');
      persistLayout(layoutRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // 激活标签同步给控制器（flushActive 语义基准；tabModel 补位/聚焦后随 activeId 联动）。
  // 激活态为设置哨兵（'settings'）时同步 null——设置页无保存管线语义，flushActive no-op
  useEffect(() => {
    const activeNodeId = typeof tabsOp.activeId === 'number' ? tabsOp.activeId : null;
    saveController.setActiveNode(activeNodeId);
  }, [tabsOp.activeId, saveController]);

  // 主题三态循环（状态栏切换钮）：light → dark → system → light，与既有持久化链共用入口
  function cycleThemeIntent(): void {
    const next: ThemeIntent =
      themeIntent === 'light' ? 'dark' : themeIntent === 'dark' ? 'system' : 'light';
    changeThemeIntent(next);
  }

  /**
   * 外壳命令统一处理器（M6 spec §2.2）：原生菜单/加速器（application menu → shell:command
   * 订阅）与应用内菜单（TitleBar 直调）同一收口——switch 分支穷举 ShellCommand 联合
   * （宪法 A.1-4，never 兜底由穷举性承担）。
   */
  function handleShellCommand(command: ShellCommand): void {
    switch (command.type) {
      case 'save':
        // 菜单「保存」/Ctrl+S：立即写激活标签（管线 flush 语义，无激活为 no-op）
        saveController.flushActive();
        break;
      case 'import-html':
        // 菜单「导入 HTML 文件…」/Ctrl+N（M7，原 new-file 语义升级）：文件选择 → 确认
        // 浮层 → 单文件导入即打开链入口
        beginImportHtml();
        break;
      case 'new-dir':
        // 菜单「新建目录」/Ctrl+Shift+N：行内命名流程入口（M7 起与树工具栏钮同语义，
        // 目标落树选中上下文目录——无选中落根）
        startCreateDir(deriveTreeContextParentId());
        break;
      case 'quick-open':
        // 菜单「快速打开」/Ctrl+P：置开关浮层（数据自持，点选经 onPick 回 openFile）
        setQuickOpen(true);
        break;
      case 'global-search':
        // 菜单「全局搜索」/Ctrl+Shift+F（M5 Task 7）：切入 search 活动视图（切离复位 move 态）
        switchViewAway('search');
        break;
      case 'open-settings':
        // 菜单「设置…」/CmdOrCtrl+,（M6 spec §2.4）：打开/聚焦设置伪标签
        setTabsOp((prev) => openSettingsTab(prev));
        break;
      case 'import':
        // 菜单「导入…」（M5 批次⑥ Task 12）：目录选择 → 策略确认弹层 → io:import 链入口
        beginImport();
        break;
      case 'export':
        // 菜单「导出…」（M5 批次⑥ Task 13）：选中子树 → 目录选择 → io:export 链入口
        beginExport();
        break;
      case 'confirm-close':
        // 关窗确认链（spec §2.3 修订版）：无脏直接放行 forceClose；有脏弹**应用内确认弹窗**
        // （M8 反馈批次取代原生 window.confirm——原选型理由为「Playwright 可经 page.on('dialog')
        // 驱动」，应用内浮层由 DOM 直接驱动，可驱动性更强且样式与应用一致），
        // 用户确认才放行（取消则留在应用）。放行动作即 shell:force-close，
        // 主进程 requestClose 置 allowClose 标记后重入 close 直通
        if (!dirtyRef.current) {
          void window.api.forceClose();
          return;
        }
        void askConfirm({
          title: '退出应用',
          description: '有未保存的更改，确定退出？',
          confirmLabel: '退出',
          destructive: true,
        }).then((confirmed) => {
          if (confirmed) void window.api.forceClose();
        });
        break;
    }
  }

  // 外壳命令订阅（cleanup 成对）：菜单命令 dispatch + 关窗确认链（spec §2.3/§5.2）。
  // 命令体经 handleShellCommand（TitleBar 与本订阅共用）；订阅仅装配一次，状态读取走
  // ref 镜像（M4 以来既定口径），故依赖只列 saveController
  useEffect(() => {
    return window.api.onShellCommand(handleShellCommand);
  }, [saveController]);

  // 卸载清全部计时器（成对释放，宪法资源纪律）
  useEffect(() => {
    return () => {
      saveController.dispose();
    };
  }, [saveController]);

  // 标签写节流卸载释放（资源成对）：先 flush 落掉挂起写（关窗前 300ms 窗口内的标签操作
  // 不丢），再 dispose 清 timer 与挂起体——此后不再触发（throttleTrailing dispose 语义）
  useEffect(() => {
    const throttle = tabWriteThrottleRef.current;
    return () => {
      throttle?.flush();
      throttle?.dispose();
    };
  }, []);

  // —— 渲染段（M6 spec §2 壳层）——
  // 画布标签分类（M6 spec §3.3）：HTML → 所见即所得画布（保活 iframe 集）；媒体 → 原生
  // 组件；其余文本 → CM（EditorPanel 仅随激活文本标签挂载）
  const activeTabKind =
    activeTab === null
      ? 'none'
      : activeTab.meta.mimeType === 'text/html'
        ? 'html'
        : activeTab.meta.mimeType !== null && previewableMime(activeTab.meta.mimeType) !== null
          ? 'media'
          : 'code';
  const htmlTabs = tabsOp.tabs.filter((t) => t.meta.mimeType === 'text/html');
  // 设置伪标签激活判定（哨兵值）；状态栏脏态（仅 doc 标签参与）
  const settingsActive = tabsOp.activeId === 'settings';
  const hasDirty = tabsOp.tabs.some((t) => t.dirty);
  // 侧栏内容层退场存在性（M8 折叠过渡）：折叠时不瞬时卸载——内容层保留快照播完退场再卸载
  //（「折叠后内容真的卸载、面板订阅随卸载回收」的既有语义不变，仅推迟一个过渡时长）。
  // 载荷取布尔量而非视图值：退场期渲染的仍是离开时那个视图（view 状态未变，判定直接用 view）。
  // 本 hook 只贡献「是否仍在场」这一个挂载门；退场**呈现态直读 layout.sidebarCollapsed**
  //（它就是退场事实本身，走 hook 的 leaving 会晚一帧，见下 sidebarContentMounted）
  const sidebarContent = useExitPresence(
    layout.sidebarCollapsed ? null : 'present',
    SIDEBAR_TOGGLE_MS,
  );
  // 挂载门：未折叠恒挂载；折叠后仅在退场存在性未清空期间继续渲染（播完即卸载）。
  // 展开方向必须即时挂载（不能用 sidebarContent 单独判定——presence 由 effect 驱动，会晚一帧
  // 造成「窄条钮已卸载、内容层未出现」的空窗与一次空帧焦点丢失）
  const sidebarContentMounted = !layout.sidebarCollapsed || sidebarContent !== null;
  // 折叠/展开的焦点交接（键盘可达性）：折叠后内容层（含折叠钮）整体卸载，焦点必须移交窄条
  // 展开钮；展开后交回侧栏头折叠钮。目标 ref 为空表示对应层尚未挂载（展开首帧），此时
  // **不消费意图**、等下一轮 effect（依赖含 sidebarContent）再落地——早先无条件消费会让
  // 展开方向静默丢焦点到 body
  const railExpandRef = useRef<HTMLButtonElement | null>(null);
  const headerCollapseRef = useRef<HTMLButtonElement | null>(null);
  const pendingSidebarFocusRef = useRef<'rail' | 'header' | null>(null);
  useEffect(() => {
    const target = pendingSidebarFocusRef.current;
    if (target === null) return;
    const element = target === 'rail' ? railExpandRef.current : headerCollapseRef.current;
    if (element === null) return;
    pendingSidebarFocusRef.current = null;
    element.focus();
  }, [layout.sidebarCollapsed, sidebarContent]);
  // 拖拽会话的卸载兜底：body 级拖拽类只在拖拽收口时摘除，而组件卸载（窗口销毁 / 开发期
  // 热重载）不会走到 pointerup——漏摘会让后续任何界面停在 col-resize 光标与禁选态
  //（资源成对纪律：add 与 remove 各有归属）
  useEffect(() => () => document.body.classList.remove('lt-col-dragging'), []);

  return (
    // 工作台容器：标题栏 + 主体行（活动栏|侧栏|分隔条|画布区）+ 状态栏（M6 spec §2 结构）
    <div className="lt-workspace flex min-h-0 flex-1 flex-col">
      <TitleBar platform={window.api.platform} onCommand={handleShellCommand} />
      <div
        className="group/drag flex min-h-0 flex-1 overflow-hidden"
        data-dragging={sidebarDragging ? 'true' : undefined}
      >
        <ActivityBar
          view={view}
          settingsActive={settingsActive}
          onViewChange={switchView}
          onOpenSettings={() => setTabsOp((prev) => openSettingsTab(prev))}
        />
        {/* 侧栏（M8 动效批次：单一常驻 aside）：折叠/展开共用同一元素——原实现是两个 <aside>
            三元互斥渲染，跨元素没有插值起点，几何过渡在物理上不可能。折叠态宽 w-12（48px
            窄条），展开态宽为内联百分比，两者由 transition-[width] 插值（Chromium 支持 %↔px
            长度插值，实测 250→48px 逐帧连续）。overflow-hidden 是折叠期的裁剪面（内容层尚未
            卸载时先被裁掉，不溢出到画布）；relative 为窄条层定位基准。拖拽期与启动装载期摘除
            宽度过渡——§6.2 红线：拖拽 pointermove 路径禁任何 transition（必须直跟手）；
            装载期（layoutReady 前）摘除是为避免「默认布局 → 恢复布局」在启动时报一次无动机动画 */}
        <aside
          className={`lt-sidebar relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-background${
            // 拖拽期摘除宽度过渡（§6.2 红线：拖拽 pointermove 路径禁任何 transition，必须直跟手）。
            // 用类串条件而非 group-data 变体——实测 `group-data-*/transition-none` 不进构建产物
            // （同名变体挂 pointer-events-none 却正常生成，属该组合的静默失效），故取可核证的直白路径
            sidebarDragging || !layoutReady ? '' : ' transition-[width] duration-180'
          }${layout.sidebarCollapsed ? ' lt-sidebar-collapsed w-12' : ''}`}
          style={
            layout.sidebarCollapsed
              ? undefined
              : { width: `${(layout.sidebarWidthRatio * 100).toFixed(2)}%` }
          }
        >
          {/* 折叠窄条层（绝对定位左缘 + 恒 48px，py-1 与侧栏头折叠钮同基线）：几何不随 aside
              宽度变化——收缩过程中展开钮就在自己的最终位置被逐帧揭示，不随侧栏横向平移。
              展开钮由 sidebarCollapsed 直接门控（不挂在退场存在性上）：折叠点击后即刻挂载、
              展开后即刻卸载（组件测试以真时钟同步断言两者，等不起 180ms）。入场只许纯
              opacity——Playwright 可点性判定要求包围盒稳定，任何 slide/zoom 都会把点击推迟到动画结束 */}
          {layout.sidebarCollapsed ? (
            <div className="absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-1">
              <button
                ref={railExpandRef}
                type="button"
                aria-label="展开侧栏"
                title="展开侧栏"
                className={`${ICON_BUTTON} duration-100 ease-out animate-in fade-in`}
                onClick={() => {
                  pendingSidebarFocusRef.current = 'header';
                  updateLayout({ sidebarCollapsed: false });
                }}
              >
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              </button>
            </div>
          ) : null}
          {/* 内容层（侧栏头 + 活动视图）：折叠时淡出 SIDEBAR_TOGGLE_MS 后才卸载（见 sidebarContent）。
              退场呈现态直读 sidebarCollapsed（无 effect 滞后到帧）；opacity 走 transition 而非
              animate-*：CSS 过渡天然从「当前值」续走，连点折叠/展开不会闪断，且 reduced-motion
              下终态（opacity-0）是声明值、不会像 fill-mode:none 的动画那样回弹成不透明 */}
          {sidebarContentMounted ? (
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                layout.sidebarCollapsed
                  ? SIDEBAR_CONTENT_EXIT_CLASSES
                  : SIDEBAR_CONTENT_ENTER_CLASSES
              }`}
            >
              {/* 侧栏头（M6 spec §2.3）：随活动视图换题与操作（返回/折叠图标钮）。
                  bg-muted/50 与标签条同为 h-9 chrome 面（跨分隔条相邻、必须同值才成连续
                  横带——取设计系统文档 §7.2 面板标题栏标尺值；树工具栏不再着色，
                  二级头靠面差拉开层级）。标题 min-w-0 truncate + 按钮组 shrink-0：折叠过程中
                  侧栏会窄至 48px，标题截断而折叠钮恒贴右缘（否则 flex 溢出推出错位） */}
              <div className="lt-sidebar-header flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/50 px-2">
                <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                  {view === 'trash' ? '回收站' : view === 'search' ? '全局搜索' : '资源树'}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {view !== 'tree' ? (
                    <button
                      type="button"
                      aria-label="返回资源树"
                      title="返回资源树"
                      className={ICON_BUTTON}
                      onClick={() => switchView('tree')}
                    >
                      <ArrowLeft aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                  <button
                    ref={headerCollapseRef}
                    type="button"
                    aria-label="折叠侧栏"
                    title="折叠侧栏"
                    className={ICON_BUTTON}
                    onClick={() => {
                      pendingSidebarFocusRef.current = 'rail';
                      updateLayout({ sidebarCollapsed: true });
                    }}
                  >
                    <PanelLeftClose aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </div>
              {/* 视图切换面：key=活动视图——切换重挂重播 100ms 入场（蓝图「面板切换 fade 100ms」
                  基线）；侧栏头不参与 key（返回钮焦点不因切视图丢失）。启动装载期不挂入场类
                  （恢复的 activityView 与默认值不同时报一次无动机动画，见 layoutReady） */}
              <div
                key={view}
                className={`flex min-h-0 min-w-0 flex-1 flex-col ${
                  layoutReady ? SIDEBAR_VIEW_SWITCH_CLASSES : ''
                }`}
              >
                {view === 'tree' ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <TreePanel
                      roots={roots}
                      selectedId={selectedTreeId}
                      expanded={expanded}
                      dirPickMode={dirPickMode}
                      pickTargetId={pickTargetId}
                      creatingDirParentId={creatingDirParentId}
                      rootPath={storageInfo === null ? null : storageInfo.root}
                      onToggle={onToggle}
                      onSelect={onSelectNode}
                      onStartCreateDir={startCreateDir}
                      onConfirmCreateDir={confirmCreateDir}
                      onCancelCreateDir={cancelCreateDir}
                      onTrash={onTrash}
                      onRename={onRename}
                      onStartMove={startMove}
                      onImportHtml={beginImportHtml}
                    />
                    {/* move 选择模式操作条（spec §6.2 D8）：目标未定/自身或后代/在途时确认禁用；
                        Esc 或取消退出。引导文案（§6.2 字面，Task 10 补欠账）于目标未定时呈现，
                        与「不能移动到自身或其后代」提示互斥（后者以目标已定为前提） */}
                    {moveMode !== null ? (
                      <div
                        className="lt-move-bar flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-2 py-1"
                        role="group"
                        aria-label="移动选择模式"
                      >
                        {moveTargetId === null ? (
                          <span className="lt-move-hint text-xs text-muted-foreground">
                            在树中选择目标目录并确认
                          </span>
                        ) : null}
                        {moveInvalid ? (
                          <span className="lt-move-hint text-xs text-destructive">
                            不能移动到自身或其后代
                          </span>
                        ) : null}
                        <button
                          type="button"
                          aria-label="确认移动"
                          disabled={moveTargetId === null || moveInvalid || moveInFlight}
                          className={PRIMARY_BUTTON}
                          onClick={confirmMove}
                        >
                          确认移动
                        </button>
                        <button
                          type="button"
                          aria-label="取消移动"
                          className={TOOL_BUTTON}
                          onClick={() => setMoveMode(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : view === 'search' ? (
                  // search 态：搜索面板数据自持（查询态在面板内部）。点选=定位打开（spec §2.2）：
                  // 树侧展开（revealInTree）+ openFile 统一入口（大文件/二进制拦截与 recent 记录
                  // 一并生效，开签后 activeId 变化自动收走 reveal 覆盖选中）；「在树中显示」=
                  // revealInTree 定位 + 关搜索态回树（不开标签，目录结果的有效动作）
                  <SearchPanel
                    onOpen={(node) => {
                      void revealInTree(node);
                      void openFile(node);
                    }}
                    onReveal={(node) => {
                      void revealInTree(node);
                      switchView('tree');
                    }}
                  />
                ) : (
                  // trash 态：回收站面板整体替换树内容（move 选择条归树态，不渲染）；
                  // 面板数据自持（首拉 + trash 域广播重拉），随态卸载即退订
                  <TrashPanel />
                )}
              </div>
            </div>
          ) : null}
        </aside>
        {/* 侧栏分隔条（可拖拽调宽；w-1 显式命中区——flex 行内无宽度类则分隔条实际 0px，
            hit-test 永不命中（E2E 探针实证的产品缺陷，M6 批次④修复））。折叠时不响应拖拽，
            故同时摘除 col-resize 光标与 hover 高亮——不可用的操作不该有可用性承诺；
            拖拽期经 data-dragging 把轨色加深一档（hover 同色无法表达「已接管」） */}
        <div
          className={`lt-divider lt-divider-sidebar w-1 shrink-0 bg-border ${
            layout.sidebarCollapsed
              ? ''
              : 'cursor-col-resize transition-colors duration-100 hover:bg-ring/50 data-[dragging=true]:bg-ring'
          }`}
          role="separator"
          aria-orientation="vertical"
          data-dragging={sidebarDragging ? 'true' : undefined}
          onPointerDown={layout.sidebarCollapsed ? undefined : onDividerPointerDown}
        />
        {/* 编辑画布区（M6 spec §2.4）：标签栏 + 类型化画布（所见即所得/媒体/CM 文本/
            设置标签页/欢迎页，随激活标签类型切换——spec §3.3） */}
        <section className="lt-canvas flex min-h-0 min-w-0 flex-1 flex-col bg-background group-data-[dragging=true]/drag:pointer-events-none">
          {tabsOp.tabs.length > 0 || tabsOp.settingsOpen ? (
            <TabBar
              tabs={tabsOp.tabs}
              activeId={tabsOp.activeId}
              settingsOpen={tabsOp.settingsOpen}
              onActivate={activateTab}
              onClose={closeTabById}
              onActivateSettings={() => setTabsOp((prev) => openSettingsTab(prev))}
              onCloseSettings={() => setTabsOp((prev) => closeSettingsTab(prev))}
            />
          ) : null}
          {settingsActive ? (
            <SettingsPage
              theme={themeIntent}
              editorFontSize={editorFontSize}
              debounceMs={debounceMs}
              autoSaveMs={autoSaveMs}
              backups={backups}
              backupAutoEnabled={backupAutoEnabled}
              onBackupAutoEnabledChange={changeBackupAutoEnabled}
              restoreOnStart={restoreOnStart}
              onRestoreOnStartChange={changeRestoreOnStart}
              onCreateBackup={createBackupNow}
              onRestoreBackup={restoreBackupNow}
              onThemeChange={changeThemeIntent}
              onFontSizeChange={changeEditorFontSize}
              onDebounceChange={changeDebounceMs}
              onAutoSaveChange={changeAutoSaveMs}
              storageInfo={storageInfo}
              onOpenStorageDir={openStorageDir}
              onChangeStorageDir={beginChangeStorageDir}
            />
          ) : activeTabKind === 'html' ? (
            // 所见即所得画布（spec §3.3）：全部 HTML 标签保活渲染，激活可见后台隐藏；
            // 编辑经 lt:doc-edit → handleDocEdit 进保存管线；无预览面板（编辑面=渲染面）
            <HtmlCanvas
              tabs={htmlTabs}
              activeId={typeof tabsOp.activeId === 'number' ? tabsOp.activeId : null}
              activeDirty={activeTab?.dirty ?? false}
              onDocEdit={handleDocEdit}
            />
          ) : activeTabKind === 'media' && activeTab !== null ? (
            <MediaCanvas node={activeTab.meta} />
          ) : activeTab !== null ? (
            <EditorPanel
              sessions={sessions}
              activeTab={activeTab}
              debounceMs={debounceMs}
              theme={resolvedTheme}
              editorFontSize={editorFontSize}
              onSaveRequest={() => saveController.flushActive()}
            />
          ) : (
            // 欢迎页（M6 spec §2.5）：无激活 doc 标签且未开设置时的「首页」空态
            <WelcomePage
              recent={recentOpened.slice(0, 10)}
              onOpenRecent={(nodeId) => {
                void window.api.getNode({ nodeId }).then((result) => {
                  if (result.ok) {
                    void openFile(result.value);
                  } else {
                    showToast('文档不存在或已删除');
                  }
                });
              }}
              onImportHtml={beginImportHtml}
              onImport={beginImport}
              onQuickOpen={() => setQuickOpen(true)}
            />
          )}
        </section>
      </div>
      {/* 树态浮层（行内重命名模态 / HTML 导入确认浮层）：M8 起挂工作台根层——侧栏内容层的
          animate-in 会写 transform（合成器路径入场），使 fixed 后代改以动画层为包含块并落入
          裁剪面；门条件「树视图且侧栏展开」与原渲染位置（侧栏树分支内）等价。
          重命名模态：预填当前名，确认/取消经 RenameDialog 回传
          HTML 导入浮层：非模态——打开期间树中点选目录即改导入目标（dirPickMode 合成下发）；
          名称可改（导入即重命名），重名固定 rename 递增不打断；确认后导入即打开画布渲染 */}
      {view === 'tree' && !layout.sidebarCollapsed && renameTarget !== null ? (
        <RenameDialog
          nodeName={renameTarget.name}
          inFlight={renameInFlight}
          onConfirm={confirmRename}
          onCancel={() => setRenameTarget(null)}
        />
      ) : null}
      {view === 'tree' && !layout.sidebarCollapsed && importHtmlDraft !== null ? (
        <ImportHtmlDialog
          sourcePath={importHtmlDraft.sourcePath}
          targetName={findNode(roots, importHtmlDraft.targetParentId)?.meta.name ?? '根'}
          inFlight={importHtmlInFlight}
          onConfirm={confirmImportHtml}
          onCancel={cancelImportHtml}
        />
      ) : null}
      {/* 快速打开浮层（M5 批次① Task 6）：radix portal 渲染，关闭即卸载内容；
          点选回传走 openFile 统一入口（大文件/二进制拦截与 recent 记录一并生效） */}
      <QuickOpenDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onPick={(node) => void openFile(node)}
      />
      {/* 导入进度面板（M5 批次⑥ Task 12）：io:progress 广播驱动，toast 形态的等价呈现
          （批次粒度更新，不逐节点）；bottom-14 让位 toast 队列（完成 toast 同屏不重叠）。
          退场存在性 hook 驱动：收口后保留快照播滑出过渡（PROGRESS_EXIT_CLASSES）再卸载，
          退场期 pointer-events-none 防「取消」误点 */}
      {importPresence !== null ? (
        <div
          className={`lt-import-progress fixed bottom-14 right-4 z-50 flex w-80 flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md tabular-nums ${
            importPresence.leaving ? PROGRESS_EXIT_CLASSES : PROGRESS_ENTER_CLASSES
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {importPresence.value.phase === 'scanning'
                ? '正在扫描导入源…'
                : `正在导入（${importPresence.value.done}/${importPresence.value.total}）`}
            </span>
            <button
              type="button"
              aria-label="取消导入"
              className="inline-flex h-5 shrink-0 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={cancelRunningImport}
            >
              取消
            </button>
          </div>
          <span className="lt-import-progress-path truncate text-muted-foreground">
            {importPresence.value.currentPath}
          </span>
        </div>
      ) : null}
      {/* 导出进度面板（M5 批次⑥ Task 13）：与导入面板同形态呈现（写盘无事务，批次粒度）；
          无取消语义（FR-IO-02 未要求），invoke 结果到达即收口，退场过渡与导入面板一致 */}
      {exportPresence !== null ? (
        <div
          className={`lt-export-progress fixed bottom-14 right-4 z-50 flex w-80 flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md tabular-nums ${
            exportPresence.leaving ? PROGRESS_EXIT_CLASSES : PROGRESS_ENTER_CLASSES
          }`}
          role="status"
          aria-live="polite"
        >
          <span className="font-medium">
            {exportPresence.value.phase === 'collecting'
              ? '正在准备导出…'
              : `正在导出（${exportPresence.value.done}/${exportPresence.value.total}）`}
          </span>
          <span className="lt-export-progress-path truncate text-muted-foreground">
            {exportPresence.value.currentPath}
          </span>
        </div>
      ) : null}
      {/* 导入确认弹层（M5 批次⑥ Task 12）：目标父目录展示 + 重名策略三选（alert-dialog +
          radio 组，形态按设计系统文档——破坏性/带参操作先确认再执行） */}
      {importDraft !== null ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            // 关闭面（Esc/取消/确认后的自动收起）统一清草稿
            if (!open) setImportDraft(null);
          }}
        >
          <AlertDialogContent className="p-4 duration-240">
            {/* 打磨（M5 Task 15）：消费侧类覆写对齐设计系统标尺——浮层内边距 16px（p-4，
                覆写模板 p-6）与标题字号 display 档 16px（text-base，覆写模板 text-lg 18px
                体外值）；duration-240 覆写模板浮层默认 200ms（§6.1「浮层出入场 normal 240ms」
                体外档位，M8 补齐——自研浮层/进度面板/toast 均已是 240ms）
                经 cn/tailwind-merge 合并为「外部类覆盖内部类」合法场景（D28） */}
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">导入</AlertDialogTitle>
              <AlertDialogDescription>
                将所选磁盘文件夹导入到「
                {findNode(roots, importDraft.targetParentId)?.meta.name ?? '根'}
                」；同名冲突按下方策略处理
              </AlertDialogDescription>
            </AlertDialogHeader>
            <RadioGroup
              aria-label="重名策略"
              className="flex flex-col gap-2"
              value={importDraft.conflict}
              onValueChange={(value) => {
                // radix 回调为宽 string：与字面量成员逐一比对收窄（禁 as 断言，A.1-5）
                setImportDraft((prev) => {
                  if (prev === null) return prev;
                  if (value === 'skip' || value === 'rename' || value === 'overwrite') {
                    return { ...prev, conflict: value };
                  }
                  return prev;
                });
              }}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="skip" />
                跳过
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="rename" />
                重命名
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="overwrite" />
                覆盖（同名移入回收站）
              </label>
            </RadioGroup>
            <AlertDialogFooter>
              <AlertDialogCancel aria-label="取消导入" className="h-8 text-xs">
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                aria-label="确认导入"
                className="h-8 text-xs"
                onClick={confirmImport}
              >
                确认导入
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {/* 数据迁移确认弹层（M6 批次③，FR-AUX-03）：数据覆盖级操作——列明迁移内容与
          「成功后自动重启」语义；失败（目标非法/复制出错）由主进程回滚并 toast 呈现 */}
      {storageChangeTarget !== null ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setStorageChangeTarget(null);
          }}
        >
          <AlertDialogContent className="p-4 duration-240">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">更改数据位置</AlertDialogTitle>
              <AlertDialogDescription>
                将把数据库、设置与备份迁移到「{storageChangeTarget}」，完成后应用将自动重启。
                迁移期间请勿关闭应用；失败时原位置数据不受影响
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel aria-label="取消迁移" className="h-8 text-xs">
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                aria-label="确认迁移"
                className="h-8 text-xs"
                onClick={confirmChangeStorageDir}
              >
                确认迁移
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {/* 应用内确认弹窗（M8 反馈批次）：大文件打开 / 未保存退出的确认面——Promise 化请求
          （askConfirm）兑现为「确认/取消」两分支，取消不触发任何写侧动作 */}
      {confirmRequest !== null ? (
        <ConfirmDialog
          title={confirmRequest.title}
          description={confirmRequest.description}
          confirmLabel={confirmRequest.confirmLabel}
          destructive={confirmRequest.destructive}
          onConfirm={() => {
            settleConfirm(true);
          }}
          onCancel={() => {
            settleConfirm(false);
          }}
        />
      ) : null}
      {/* 状态栏（M6 spec §2.6）：保存态 + 文档总数 + 主题循环 + 设置入口 */}
      <StatusBar
        dirty={hasDirty}
        docCount={docCount}
        theme={themeIntent}
        onCycleTheme={cycleThemeIntent}
        onOpenSettings={() => setTabsOp((prev) => openSettingsTab(prev))}
      />
    </div>
  );
}

/**
 * M1 根节点约定 id=1（v1 种子）；listChildren('/') 的 parent meta 由根约定合成
 * （id→path 无通道，spec §4.3 不缓存路径原则）。合成字段仅用于展示：
 * mimeType 契约为「目录 null」；createdAt 不参与业务，取固定占位值。
 */
const ROOT_ID = 1;
const ROOT_NODE: NodeMeta = {
  id: ROOT_ID,
  parentId: null,
  nodeType: 'dir',
  name: '根',
  virtualPath: '/',
  mimeType: null,
  size: 0,
  createdAt: '2026-09-18T00:00:00.000+08:00',
  updatedAt: '2026-09-18T00:00:00.000+08:00',
};

/**
 * 大文件阈值常量（spec §2.4 裁决 D7，计划缺口补齐）：单位字节（NodeMeta.size 契约）。
 * 软阈值 5MB 为「直开不征询」上限，硬上限 50MB 为「一律拒开」下限，二者之间须用户确认
 */
const LARGE_FILE_SOFT_LIMIT_BYTES = 5 * 1024 * 1024;
const LARGE_FILE_HARD_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * 侧栏折叠/展开过渡时长（毫秒）：与 aside 宽度过渡 `duration-180` 同源——Tailwind JIT 需
 * 字面类名，调整时长必须本常量与类串两处同步修改（同 PROGRESS_EXIT_MS 惯例）。180ms 取
 * 设计系统文档 §6.1 fast 档（内联表面过渡），240ms 档留给浮层/toast 出入场
 */
const SIDEBAR_TOGGLE_MS = 180;

/** 侧栏内容层入场类串（展开/首次挂载）：无动画——内容由宽度过渡的裁剪「帷幕式」揭示，
 * 不做淡入是为了避免「窄条钮已卸载、内容层从 0 淡入」的空窗帧；transition-opacity 只为
 * 连点折叠↔展开时从当前不透明度平滑续走（见退场串注） */
const SIDEBAR_CONTENT_ENTER_CLASSES = 'opacity-100 transition-opacity duration-100 ease-out';
/**
 * 侧栏内容层退场类串（折叠）：100ms 淡出 + pointer-events-none（退场播放期防误点）。
 * 用 CSS 过渡而非 `animate-out` 有两个硬理由：①过渡从当前值续走，连点折叠/展开不会闪断
 * （animate-in/out 是两个动画名，切换即从关键帧极值重播）；②reduced-motion 下全局把时长压到
 * 0.01ms 时，过渡的终态是声明值 `opacity-0`（元素保持不可见直到卸载），而 `animate-out` 的
 * fill-mode 为 none、动画结束后回到基础值 opacity:1 —— 会「闪回后滞留」整整一个退场时长。
 * 100ms 早于几何 180ms 结束：内容在侧栏被挤压到极端窄幅之前已基本不可见（避免挤压重排被看见）
 */
const SIDEBAR_CONTENT_EXIT_CLASSES =
  'pointer-events-none opacity-0 transition-opacity duration-100 ease-out';

/**
 * 侧栏视图切换面类串（tree/search/trash）：100ms 淡入，蓝图 §3「面板切换 fade 100ms」基线；
 * 靠 key 变化重挂载重播入场（旧面板卸载瞬时完成，列表数据面不加退场以免拖慢切换体感）
 */
const SIDEBAR_VIEW_SWITCH_CLASSES = 'duration-100 ease-out animate-in fade-in';

/** 进度面板入场动效类串（导入/导出共用）：保持既有滑入形态，duration-240 与退场对称 */
const PROGRESS_ENTER_CLASSES =
  'pointer-events-auto duration-240 ease-out animate-in fade-in slide-in-from-bottom-2';
/**
 * 进度面板退场动效类串（导入/导出共用）：滑出过渡 + pointer-events-none 防退场播放期
 * （240ms）误点「取消」；duration-240 与 ioProgressPresence 的 PROGRESS_EXIT_MS 计时
 * 同源——Tailwind JIT 需字面类名，调整时长必须两处同步修改；出场缓动 ease-in（同侧栏退场）。
 * `fill-mode-forwards` 为 reduced-motion 兜底：全局把动画压到 0.01ms 时，fill-mode none 的
 * 动画结束后会回到基础值（面板「闪回不透明 + 滞留一个退场时长」），forwards 令终态保持
 */
const PROGRESS_EXIT_CLASSES =
  'pointer-events-none duration-240 ease-in animate-out fade-out slide-out-to-bottom-2 fill-mode-forwards';

/**
 * 文本可编辑 MIME 判定（M3 textarea 版 EditorPanel 同名函数语义迁入——openFile 前置拦截
 * 唯一判定点；主进程 isTextualMime 归写库索引域，B.2 禁跨层 import）
 */
function isTextLike(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  );
}

/** 按 id 路径复制替换节点（treeModel 同款不可变风格） */
function replaceNode(
  nodes: readonly TreeNode[],
  id: number,
  fn: (node: TreeNode) => TreeNode,
): readonly TreeNode[] {
  return nodes.map((n) => {
    if (n.meta.id === id) return fn(n);
    return { ...n, children: replaceNode(n.children, id, fn) };
  });
}

/**
 * 整树标记 stale（M5 批次⑥ Task 12 导入完成收口）：批量导入无逐节点广播，树刷新统一
 * 在导入结果到达时触发——已加载且展开的目录经既有 collectStaleExpanded 效应重取子级，
 * 折叠目录保持懒加载语义（展开时 onToggle 自会重取）。不可变更新（A.1-10）。
 */
function markAllStale(nodes: readonly TreeNode[]): readonly TreeNode[] {
  return nodes.map((node) => ({ ...node, stale: true, children: markAllStale(node.children) }));
}
