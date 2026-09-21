/**
 * VS Code 式工作台中枢（M6 spec §2，FR-SHELL-01/02 修订版；M4 起的会话/保存/树/导入导出
 * 语义整体保留）：
 * —— 壳层（M6 批次①）——自绘标题栏（TitleBar，应用内菜单经命令处理器分发）+ 活动栏
 * （ActivityBar，三视图切换 + 设置入口）+ 侧栏（树/搜索/回收站内容 + 图标操作头）+
 * 编辑画布区（TabBar + 设置标签页/编辑|预览对/欢迎页）+ 状态栏（StatusBar，保存态/文档数/
 * 主题循环/设置）。布局记忆 = shell.layout v4（侧栏折叠/宽度/活动视图，settings schema v4）。
 * —— 标签模型（M6 扩型）——设置作为特殊伪标签（settingsOpen + activeId 哨兵 'settings'，
 * 不占 MAX_TABS）；媒体弱选中双源（D20）暂保留，随批次②画布化退役。
 * —— 既有语义（M4/M5）——tabs/activeTab 状态机（tabModel 纯函数）、TabSessions per-tab
 * 会话、openFile 前置拦截（媒体分流/二进制拒开/大小三分支）、SaveController 保存管线
 * （edit/flush/flushActive/关签 flush）、树懒加载与广播同步、rename/move 模态与选择模式、
 * revealInTree 树侧定位、recent/workspace 域串行写链与启动恢复、快速打开浮层、导入导出
 * 链路与进度面板、主题装配（.dark 切换 + matchMedia）。
 * 滚动同步装配（M5 批次⑤，FR-RENDER-06）：编辑器↔预览双槽位中转保留至批次②（画布化
 * 后随 scrollSync 一并退役，M6 spec §3.4/D5）。
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
import { PreviewPanel } from '../preview/PreviewPanel';
import { previewableMime } from '../preview/previewableMime';
import {
  applyBroadcast,
  collectStaleExpanded,
  findNode,
  isDescendant,
  makeTreeRoot,
  withChildren,
  type TreeNode,
} from '../tree/treeModel';
import { RenameDialog } from '../tree/RenameDialog';
import { TreePanel, type TreePaneView } from '../tree/TreePanel';
import { TrashPanel } from '../trash/TrashPanel';
import { SearchPanel } from '../search/SearchPanel';
import { QuickOpenDialog } from '../quickopen/QuickOpenDialog';
import { SettingsPage } from '../settings/SettingsPage';
import { resolveTheme, type ThemeIntent } from '../settings/themeResolver';
import { ActivityBar } from '../shell/ActivityBar';
import { StatusBar } from '../shell/StatusBar';
import { TitleBar } from '../shell/TitleBar';
import { WelcomePage } from '../shell/WelcomePage';
import { showToast } from '../ui/Toast';
import { TabBar } from './TabBar';
import { ratioFromPointer } from './layoutModel';
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
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  // 标签操作状态机（M6 扩型）：设置伪标签存在标记与 'settings' 哨兵激活见 tabModel
  const [tabsOp, setTabsOp] = useState<TabsOp>(EMPTY_TABS_OP);
  const [debounceMs, setDebounceMs] = useState(300);
  const [autoSaveMs, setAutoSaveMs] = useState(3000);
  // 壳层布局态（FR-SHELL-01 修订版，v4）：侧栏折叠/宽度/活动视图；启动时由 settingsGet 恢复
  const [layout, setLayout] = useState<ShellLayout>(DEFAULT_LAYOUT);
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
  // 树栏视图态（M6 起由 layout.activityView 承载持久化，本态为渲染派生镜像——v4 装载前
  // 默认 'tree'；写入口 switchView/updateLayout 同步持久化）
  const [view, setView] = useState<TreePaneView>('tree');
  // 树内定位选中覆盖（M5 Task 7 评审 fix，spec §2.2「在树中显示/定位打开」）：M4 架构
  // selected 即 activeTab，reveal 不开标签但需树内高亮——以覆盖值临时接管 TreePanel 的
  // selectedId；activeId 一变（开标签/切签/关签补位）即回落，用户焦点变化优先于 reveal 残留
  const [revealSelectionId, setRevealSelectionId] = useState<number | null>(null);
  // 媒体只读预览双源态（M5 批次⑦ Task 14，FR-EDIT-04 + spec §8/D20）：previewNode =
  // 最近点选的媒体节点（唯一写入口 openFile 的 previewableMime 分流）；previewSource =
  // 最近操作源——'image'=媒体点选驱动、'tab'=标签驱动。预览面板展示源由二者合成：源='image'
  // 呈现 previewNode（激活标签原样保留在 TabBar 不关闭），源='tab' 呈现激活标签 meta——
  // 点图片看图、切回标签看标签，互不销毁对方状态（切回标签后 previewNode 保留，再次点图即回）
  const [previewNode, setPreviewNode] = useState<NodeMeta | null>(null);
  const [previewSource, setPreviewSource] = useState<'image' | 'tab'>('tab');
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
  // null=关闭）与进行中进度（io:progress 广播驱动；invoke 返回即收口置 null）
  const [importDraft, setImportDraft] = useState<{
    readonly sourcePaths: readonly string[];
    readonly targetParentId: number;
    readonly conflict: ImportConflict;
  } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  // 导出域（M5 批次⑥ Task 13）：进行中导出进度（io:progress kind:export 广播驱动；
  // invoke 返回即收口置 null），无取消语义（FR-IO-02 未要求）
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  // 滚动同步桥槽位（M5 批次⑤ Task 11）：两侧面板各自在 effect 内登记实现（卸载摘除成对），
  // 本组件持可空槽位互为中转——previewScrollPostRef = 「比例→预览 postMessage」（开关闸门
  // 在预览侧）；editorAnchorScrollRef = 「锚点→编辑器滚动」（150ms 抑制窗在编辑器侧）
  const previewScrollPostRef = useRef<((ratio: number) => void) | null>(null);
  const editorAnchorScrollRef = useRef<((anchorText: string) => void) | null>(null);
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
  //（初始挂载同样触发一次，值为 null 无副作用）
  useEffect(() => {
    setRevealSelectionId(null);
  }, [tabsOp.activeId]);
  // 预览源收回（M5 批次⑦，D20）：activeId 变化到非 null 即「有标签被激活」——覆盖关激活
  // 标签后的补位激活（唯一不经显式动作的标签激活路径）。全关（activeId→null）无标签可呈现，
  // 源保持：媒体预览不被「关空标签」连带清掉（标签重点/文本重开的同 id 路径 activeId 不变，
  // effect 不触发，由 activateTab/openFile 成功分支显式收回）
  useEffect(() => {
    if (tabsOp.activeId !== null) setPreviewSource('tab');
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
      getDoc: (id) => sessions.get(id)?.state.doc.toString() ?? null,
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
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
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
    setExpanded(next);
  }

  function onCreate(parentId: number, nodeType: 'dir' | 'file'): void {
    const name = nodeType === 'dir' ? '新建目录' : '新建文件.html';
    void window.api.createNode({ parentId, name, nodeType }).then((result) => {
      // created 广播到达自动挂入已加载父（treeModel insert）；重名等错误 toast 归后续批次，此处静默忽略
      // selected→activeTab 语义迁移：新建文件即开标签，承接 M3「创建即选中」的用户预期
      if (result.ok && nodeType === 'file') openFile(result.value);
    });
  }

  /**
   * 菜单命令入口（M4 spec §5.2，与树工具栏新建钮共用 onCreate 语义）：无树上下文时
   * 落根目录新建；新建文件经 onCreate 的创建即开标签回路呈现为标签
   */
  function createInContext(nodeType: 'dir' | 'file'): void {
    onCreate(ROOT_ID, nodeType);
  }

  function onTrash(nodeId: number): void {
    void window.api.trashNode({ nodeId }).then((result) => {
      // 标签存在则连同会话经 closeTabById 收场（flush 落库 → 管线/会话/标签同步清理，资源成对）；
      // 激活态补位由 closeTab 状态机承担（右邻优先），编辑区/预览随 activeTab 联动回落
      if (result.ok && sessions.has(nodeId)) {
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
    setExpanded((prev) => new Set([...prev, ...expandIds]));
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

  // —— 导入链路（M5 批次⑥ Task 12，FR-IO-01）：目录选择 → 策略确认弹层 → io:import ——

  /**
   * 目标父目录推导（spec §7.1「树选中上下文默认根」的最小实现）：取树选中上下文
   * （reveal 覆盖选中 ?? 激活标签对应节点——与 TreePanel selectedId 同源），命中且为
   * 目录即以其为导入目标父；文件选中/无命中/无选中一律回落根。目录不开标签（懒加载）
   * 也能经 reveal 命中，与 M4 以来的选中语义一致。
   */
  function deriveImportTargetParentId(): number {
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
        targetParentId: deriveImportTargetParentId(),
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

  /**
   * 树点选统一入口：常规模式走 openFile（开标签）；move 选择模式下 dir 点选临时变为
   * 「选定目标」记账（file 点选已被 TreePanel 禁用），合法性判定归确认钮。
   * 记账保留进入时直传的 sourceId（Task 10 源锚语义：模式生命周期内源恒不变）
   */
  function onSelectNode(node: NodeMeta): void {
    if (moveMode !== null) {
      if (node.nodeType === 'dir') {
        setMoveMode((prev) => (prev === null ? prev : { ...prev, targetId: node.id }));
      }
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

  // move 选择模式 Esc 退出（spec §6.2 D8）：keydown 监听随模式进出成对挂卸
  useEffect(() => {
    if (moveMode === null) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMoveMode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [moveMode]);

  /**
   * 视图切离统一入口（Task 4 deferred Esc 双监听耦合的顺手闭环，M5 批次④ Task 10）：
   * search/trash 态内容不含 move 选择条，moveMode 若带离 tree 会在返回后带残态复现
   * （且双 Esc 监听并存时一次按键双态齐动）——切离即复位；返回 tree 不经此口。
   * M6 起活动视图写统一经 updateLayout（本地态 + shell.layout v4 持久化一次完成）
   */
  function switchViewAway(next: Exclude<TreePaneView, 'tree'>): void {
    setMoveMode(null);
    updateLayout({ activityView: next });
    setView(next);
  }

  /** 活动视图统一写入口（活动栏点击/Esc 返回共用）：持久化 + 本地态一次完成 */
  function switchView(next: TreePaneView): void {
    if (next !== 'tree') {
      setMoveMode(null);
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
   * 打开文件为标签（树点选/新建文件/启动恢复统一入口）：媒体节点分流（M5 批次⑦ Task 14，
   * image/audio 切预览展示源即返，见上）→ 非文本前置拦截（不读库不开标签）→ 大小三分支
   * 前置判定（spec §2.4 裁决 D7：渲染层以 meta.size 前置判定，不发起 readFile）→ readFile
   * 成功才建会话与标签（失败 toast；续体内 MAX_TABS 判满防孤儿会话）→ 同文件唯一实例仅聚焦。
   * 两成功分支（聚焦/新建）都记录 recent 域、尾沿写 workspace 域、预览源收回标签（同 id
   * 重开时 activeId 不变、收回 effect 不触发，必须显式置 'tab'——点已激活标签/树行重开即
   * 「切回标签看标签」的用户意图，D20）。opts.restore（M5 批次② D7 恢复豁免）：启动恢复
   * 路径跳过 5–50MB 征询（会话重建不得卡在启动模态），>50MB 拒开与 MAX_TABS 护栏照常生效。
   * await 化使启动恢复可顺序驱动（标签序 = 会话序）。
   * @param node 目标文件节点 meta（树数据/恢复验活反查所得）
   * @param opts.restore 是否为启动恢复式打开（true 时豁免软阈值 confirm；缺省 false）
   * @returns 打开流程完成信号（拒绝/失败亦正常返回；恢复链据此串行推进）
   */
  async function openFile(node: NodeMeta, opts?: { readonly restore?: boolean }): Promise<void> {
    // 媒体节点分流（M5 批次⑦，FR-EDIT-04 + spec §8/D20）：image/audio 不开编辑标签、不进
    // TabBar 与保存管线，直接把预览展示源切到该节点（最近操作源='image'）；激活标签原样
    // 保留在 TabBar。不读库：img/audio 经 vfs:// 协议直载（同树懒加载，无会话可建）
    if (node.mimeType !== null && previewableMime(node.mimeType) !== null) {
      setPreviewNode(node);
      setPreviewSource('image');
      return;
    }
    if (node.mimeType === null || !isTextLike(node.mimeType)) {
      showToast('二进制文件暂不支持编辑（FR-EDIT-04 归后续批次）');
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
      !window.confirm('大文件打开可能卡顿，是否继续？')
    ) {
      return;
    }
    const result = await window.api.readFile({ nodeId: node.id });
    if (!result.ok) {
      showToast(`打开失败：${result.error.message}`);
      return;
    }
    // 同文件唯一实例（tabModel openTab 幂等语义）：会话已在，聚焦既有标签即可；聚焦同样是
    // 「最近使用」，与新建分支一样记录 recent + 尾沿写 workspace 激活态 + 预览源收回标签
    if (sessions.has(node.id)) {
      recordRecentOpen(node);
      setTabsOp((prev) => openTab(prev, node));
      setPreviewSource('tab');
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
    // 新建标签分支同款收回预览源（activeId 必变，收回 effect 亦会到达——显式置为意图直达，
    // 不依赖 effect 时序；同 id 已激活路径仅此处能收回）
    setPreviewSource('tab');
    tabWriteThrottleRef.current?.call();
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
    setTabsOp((prev) => closeTab(prev, id));
    tabWriteThrottleRef.current?.call(); // 标签集/激活态变更 → workspace 域尾沿写（D8）
  }

  /**
   * 激活标签（TabBar 点选统一入口）：仅改 activeId（tabs 不动），workspace 域随尾沿写；
   * 预览源显式收回标签（D20）——点选已激活标签时 activeId 不变、收回 effect 不触发，
   * 「切回标签看标签」的用户意图必须在此直达
   */
  function activateTab(id: number): void {
    setTabsOp((prev) => ({ ...prev, activeId: id }));
    setPreviewSource('tab');
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
   * layoutModel 纯函数
   */
  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    const host = e.currentTarget.parentElement;
    if (host === null) return;
    const onMove = (move: PointerEvent): void => {
      const rect = host.getBoundingClientRect();
      const offset = move.clientX - rect.left;
      applyLayout({ sidebarWidthRatio: ratioFromPointer(rect.width, offset) });
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistLayout(layoutRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
      case 'new-file':
        createInContext('file');
        break;
      case 'new-dir':
        createInContext('dir');
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
        // 关窗确认链（spec §2.3）：无脏直接放行 forceClose；有脏弹原生 confirm，
        // 用户确认才放行（取消则留在应用）。放行动作即 shell:force-close，
        // 主进程 requestClose 置 allowClose 标记后重入 close 直通
        if (!dirtyRef.current) {
          void window.api.forceClose();
          return;
        }
        if (window.confirm('有未保存的更改，确定退出？')) {
          void window.api.forceClose();
        }
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
  // 预览面板展示源合成（M5 批次⑦，D20 双源）：媒体驱动呈现 previewNode，标签驱动呈现激活
  // 标签；源='image' 而 previewNode 为空的组合构造上不可达，回落激活标签仅为契约收尾
  const previewDisplayNode =
    previewSource === 'image'
      ? (previewNode ?? activeTab?.meta ?? null)
      : (activeTab?.meta ?? null);
  // 树弱选中（D20 附则）：仅媒体驱动期间以 previewOnlyNodeId 呈现；源回标签即退场
  //（previewNode 值保留，仅不再驱动树高亮）
  const previewOnlyNodeId = previewSource === 'image' ? (previewNode?.id ?? null) : null;
  // 设置伪标签激活判定（哨兵值）；状态栏脏态（仅 doc 标签参与）
  const settingsActive = tabsOp.activeId === 'settings';
  const hasDirty = tabsOp.tabs.some((t) => t.dirty);

  return (
    // 工作台容器：标题栏 + 主体行（活动栏|侧栏|分隔条|画布区）+ 状态栏（M6 spec §2 结构）
    <div className="lt-workspace flex min-h-0 flex-1 flex-col">
      <TitleBar platform={window.api.platform} onCommand={handleShellCommand} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar
          view={view}
          settingsActive={settingsActive}
          onViewChange={switchView}
          onOpenSettings={() => setTabsOp((prev) => openSettingsTab(prev))}
        />
        {layout.sidebarCollapsed ? (
          <aside className="lt-sidebar lt-sidebar-collapsed flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-2">
            <button
              type="button"
              aria-label="展开侧栏"
              title="展开侧栏"
              className={SIDEBAR_ICON_BUTTON_CLASS}
              onClick={() => updateLayout({ sidebarCollapsed: false })}
            >
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            </button>
          </aside>
        ) : (
          <aside
            className="lt-sidebar flex min-h-0 min-w-0 flex-col bg-background"
            style={{ width: `${(layout.sidebarWidthRatio * 100).toFixed(2)}%` }}
          >
            {/* 侧栏头（M6 spec §2.3）：随活动视图换题与操作（返回/折叠图标钮） */}
            <div className="lt-sidebar-header flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
              <span className="text-xs font-medium text-muted-foreground">
                {view === 'trash' ? '回收站' : view === 'search' ? '全局搜索' : '资源树'}
              </span>
              <div className="flex items-center gap-1">
                {view !== 'tree' ? (
                  <button
                    type="button"
                    aria-label="返回资源树"
                    title="返回资源树"
                    className={SIDEBAR_ICON_BUTTON_CLASS}
                    onClick={() => switchView('tree')}
                  >
                    <ArrowLeft aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="折叠侧栏"
                  title="折叠侧栏"
                  className={SIDEBAR_ICON_BUTTON_CLASS}
                  onClick={() => updateLayout({ sidebarCollapsed: true })}
                >
                  <PanelLeftClose aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>
            {/* 活动视图内容：互斥渲染，随态卸载即回收内部订阅（面板各自数据自持） */}
            {view === 'tree' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <TreePanel
                  roots={roots}
                  selectedId={selectedTreeId}
                  previewOnlyNodeId={previewOnlyNodeId}
                  moveMode={moveMode !== null}
                  moveTargetId={moveTargetId}
                  onToggle={onToggle}
                  onSelect={onSelectNode}
                  onCreate={onCreate}
                  onTrash={onTrash}
                  onRename={onRename}
                  onStartMove={startMove}
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
                      className="inline-flex h-6 items-center justify-center rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                      onClick={confirmMove}
                    >
                      确认移动
                    </button>
                    <button
                      type="button"
                      aria-label="取消移动"
                      className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
                      onClick={() => setMoveMode(null)}
                    >
                      取消
                    </button>
                  </div>
                ) : null}
                {/* 行内重命名模态（spec §6.2 D8）：预填当前名，确认/取消经 RenameDialog 回传 */}
                {renameTarget !== null ? (
                  <RenameDialog
                    nodeName={renameTarget.name}
                    inFlight={renameInFlight}
                    onConfirm={confirmRename}
                    onCancel={() => setRenameTarget(null)}
                  />
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
              // trash 态：回收站面板整体替换树内容（move 选择条/重命名模态同属树态，不渲染）；
              // 面板数据自持（首拉 + trash 域广播重拉），随态卸载即退订
              <TrashPanel />
            )}
          </aside>
        )}
        {/* 侧栏分隔条（可拖拽调宽；侧栏折叠时收窄轨、不响应拖拽，比例维持记忆值） */}
        <div
          className="lt-divider lt-divider-sidebar cursor-col-resize bg-border transition-colors duration-100 hover:bg-ring/50"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={layout.sidebarCollapsed ? undefined : onDividerPointerDown}
        />
        {/* 编辑画布区（M6 spec §2.4）：标签栏 + 类型化画布（设置标签页/编辑|预览对/欢迎页）。
            编辑|预览对为批次①过渡形态（滚动同步接线保留），批次②替换为所见即所得单画布 */}
        <section className="lt-canvas flex min-h-0 min-w-0 flex-1 flex-col bg-background">
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
            />
          ) : activeTab !== null ? (
            <div className="flex min-h-0 flex-1">
              <EditorPanel
                sessions={sessions}
                activeTab={activeTab}
                debounceMs={debounceMs}
                theme={resolvedTheme}
                editorFontSize={editorFontSize}
                onSaveRequest={() => saveController.flushActive()}
                // 滚动同步接线（M5 Task 11）：比例上行中转至预览投递槽；锚点滚动命令槽交面板登记
                onScrollRatio={(ratio) => previewScrollPostRef.current?.(ratio)}
                anchorScrollRef={editorAnchorScrollRef}
              />
              <div className="lt-divider-editor w-1 shrink-0 bg-border" aria-hidden="true" />
              <div className="lt-pane-preview flex min-h-0 w-2/5 min-w-0 flex-col bg-background">
                <PreviewPanel
                  node={previewDisplayNode}
                  // 滚动同步接线（M5 Task 11）：投递槽交面板登记；锚点 report 中转至编辑器命令槽
                  scrollPostRef={previewScrollPostRef}
                  onScrollReport={(anchorText) => editorAnchorScrollRef.current?.(anchorText)}
                />
              </div>
            </div>
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
              onNewFile={() => createInContext('file')}
              onImport={beginImport}
              onQuickOpen={() => setQuickOpen(true)}
            />
          )}
        </section>
      </div>
      {/* 快速打开浮层（M5 批次① Task 6）：radix portal 渲染，关闭即卸载内容；
          点选回传走 openFile 统一入口（大文件/二进制拦截与 recent 记录一并生效） */}
      <QuickOpenDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onPick={(node) => void openFile(node)}
      />
      {/* 导入进度面板（M5 批次⑥ Task 12）：io:progress 广播驱动，toast 形态的等价呈现
          （批次粒度更新，不逐节点）；bottom-14 让位 toast 队列（完成 toast 同屏不重叠） */}
      {importProgress !== null ? (
        <div
          className="lt-import-progress pointer-events-auto fixed bottom-14 right-4 z-50 flex w-80 flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-240 animate-in fade-in slide-in-from-bottom-2 tabular-nums"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {importProgress.phase === 'scanning'
                ? '正在扫描导入源…'
                : `正在导入（${importProgress.done}/${importProgress.total}）`}
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
            {importProgress.currentPath}
          </span>
        </div>
      ) : null}
      {/* 导出进度面板（M5 批次⑥ Task 13）：与导入面板同形态呈现（写盘无事务，批次粒度）；
          无取消语义（FR-IO-02 未要求），invoke 结果到达即收口 */}
      {exportProgress !== null ? (
        <div
          className="lt-export-progress pointer-events-auto fixed bottom-14 right-4 z-50 flex w-80 flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-240 animate-in fade-in slide-in-from-bottom-2 tabular-nums"
          role="status"
          aria-live="polite"
        >
          <span className="font-medium">
            {exportProgress.phase === 'collecting'
              ? '正在准备导出…'
              : `正在导出（${exportProgress.done}/${exportProgress.total}）`}
          </span>
          <span className="lt-export-progress-path truncate text-muted-foreground">
            {exportProgress.currentPath}
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
          <AlertDialogContent className="p-4">
            {/* 打磨（M5 Task 15）：消费侧类覆写对齐设计系统标尺——浮层内边距 16px（p-4，
                覆写模板 p-6）与标题字号 display 档 16px（text-base，覆写模板 text-lg 18px
                体外值）；经 cn/tailwind-merge 合并为「外部类覆盖内部类」合法场景（D28） */}
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

/** 侧栏头图标钮标准类串（折叠/返回钮共用，M6 spec §2.3） */
const SIDEBAR_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

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
