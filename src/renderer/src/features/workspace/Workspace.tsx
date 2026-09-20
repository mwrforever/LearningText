/**
 * 三栏工作台 + 多标签会话中枢（M4 spec §3）：tabs/activeTab 状态机（tabModel 纯函数不可变
 * 更新）+ TabSessions per-tab 会话容器；openFile 前置拦截（非文本 toast 拒开、readFile 成功
 * 才建会话与标签）。树数据/展开集/settings 去抖值照旧在此提升，TreePanel/TabBar/EditorPanel/
 * PreviewPanel 纯 props 消费（A.7-6 单向）。保存管线（SaveController）在此装配：编辑回路
 * edit、关标签 flush 后关、保存钮 flushActive、卸载 dispose 成对释放。三栏折叠/宽度拖拽
 * （M4 spec §5.1 FR-SHELL-01）：layoutModel 纯函数换算比例，折叠与拖拽终值经 settings
 * shell 域持久化（get→merge→set 全量写回），拖拽中仅本地态防 settings 写风暴。
 * 树 rename/move（M4 spec §6.2 D8）：重命名行内模态与 move 选择模式态在此提升；
 * renamed/moved 广播后 getNode 反查回写标签 meta（§6.1 同步链，selected 即 activeTab）。
 * move 源锚退役（M5 批次④ Task 10）：sourceId 改由入口直传（工具栏传选中 id、树行内
 * 「⋯」菜单传本行 id），不再读 tabsOp.activeId——selectedId 锚退役为树高亮专用；
 * 切往 search/trash 态即复位 move 态（Task 4 deferred Esc 双监听耦合顺手闭环）。
 * 树栏三态视图容器（M5 批次① Task 7 三态齐备）：view 'tree'|'search'|'trash' 切换——
 * 标题栏「搜索」钮/菜单 Ctrl+Shift+F 进入 search 态、「回收站」钮进入 trash 态、返回钮/Esc
 * 退出；search/trash 内容由对应面板数据自持渲染，树数据（roots/expanded）挂在 Workspace
 * 不随态销毁（spec §2.2 切回保持展开态）。呈现面（标题栏 + 三态分发）由 TreePane 插槽承载。
 * 搜索结果树侧定位（spec §2.2 评审 fix）：revealInTree 按 virtualPath 逐段 resolvePath 求
 * 祖先链 → 逐层 listChildren 就地装载 → 展开集合并入 + reveal 选中覆盖（activeId 变化即
 * 回落）；「点击定位打开」= 树侧展开 + openFile，「在树中显示」= 定位 + 关搜索态回树。
 * 最近打开与工作区恢复（M5 批次②）：openFile 成功（聚焦/新建两会话分支）记录 recent 域
 * （去重置顶，时刻由写入方补）；trash/purge 广播后对 recent 逐个验活剔除；启动时按
 * workspace 域恢复标签（planWorkspaceRestore 失效剔除 + active 右邻继承，恢复式打开豁免
 * 5–50MB 征询）；标签操作经 throttleTrailing 尾沿 300ms 写 workspace 域（D8，卸载 flush+dispose）。
 * recent/workspace 域写统一经串行 get→merge→set 队列（restoreWorkspace 同链），防启动期
 * 并发记录点丢更新；recentToItems 数据接口落在 features/quickopen（Task 6 浮层消费）。
 * 快速打开浮层（M5 批次① Task 6）：quickOpen 开关态在此提升，shell:command 'quick-open'
 * （菜单 Ctrl+P，键位单一来源）dispatch 置 true 打开；点选回传 openFile 统一入口，
 * 结果/最近打开双源数据自持在 QuickOpenDialog。
 * 设置页（M5 批次③ Task 8）：settingsOpen 全屏覆盖态（非 view 三态枚举——覆盖于工作台之上，
 * 关闭后工作台状态原样还原），入口 = 状态栏「设置」钮 + 菜单 'open-settings' 命令；主题装配
 * 在此收口（意图 → resolveTheme 解析 → documentElement .dark 切换 + resolvedTheme props 传导
 * EditorPanel 同 state 重配，system 态经 matchMedia 监听，cleanup 成对摘除）；字号/去抖/自动
 * 保存表单即改即存——经既有串行写链（get→merge→set）落盘，失败 toast 回滚显示。备份/维护区
 * （M5 批次③ Task 9）：备份条目列表在设置页打开期间拉取并随 backup:done 广播重拉（订阅成对
 * 摘除）；自动备份开关走 backup 域串行写链；立即备份/还原经专用通道（还原为数据覆盖级操作，
 * 强确认与 fire-and-forget 语义见 restoreBackupNow）。
 * 滚动同步装配（M5 批次⑤ Task 11，FR-RENDER-06）：编辑器↔预览互为命令出口——两侧面板各自
 * 在 effect 内向槽位登记实现（卸载摘除成对），本组件只持两个可空槽位互为中转，不感知协议
 * 细节：编辑器比例（100ms 节流，EditorPanel）→ 预览 postMessage（开关闸门在 PreviewPanel，
 * D14 会话级）；预览锚点 report → 编辑器滚动（150ms 抑制窗在 EditorPanel，D13）。
 * 导入链路（M5 批次⑥ Task 12，FR-IO-01）：菜单 'import' 命令 → 主进程目录选择（pickDirectory
 * 多选，取消静默）→ 确认弹层（目标父目录=树选中上下文默认根的最小推导 + 重名策略三选，
 * alert-dialog + radio 组）→ io:import 发起；onIoProgress 订阅（挂载常驻、退订成对）驱动
 * 进度面板（批次粒度，取消按 importId 寻址），invoke 结果即终态收口：D17 计数 toast +
 * 整树标记 stale（已展开目录经既有 stale 重取效应刷新导入结果）。
 * 壳插槽（toolbar/statusBar）props 预留不动（评审 D5）。
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYOUT } from '../../../../shared/settings-contract';
import type {
  RecentEntry,
  SettingsData,
  ShellLayout,
  WorkspaceSettings,
} from '../../../../shared/settings-contract';
import type { BackupEntry } from '../../../../shared/backup-contract';
import type { ImportConflict, ImportProgress } from '../../../../shared/io-contract';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { toLocalIsoTime } from '../../../../shared/time';
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
import { TreePanel, TreePane, type TreePaneView } from '../tree/TreePanel';
import { TrashPanel } from '../trash/TrashPanel';
import { SearchPanel } from '../search/SearchPanel';
import { QuickOpenDialog } from '../quickopen/QuickOpenDialog';
import { SettingsPage } from '../settings/SettingsPage';
import { resolveTheme, type ThemeIntent } from '../settings/themeResolver';
import { showToast } from '../ui/Toast';
import { TabBar } from './TabBar';
import { ratioFromPointer } from './layoutModel';
import { MAX_TABS, closeTab, openTab, setTabDirty, updateTabMeta, type TabsOp } from './tabModel';

export interface WorkspaceProps {
  /** 全局操作条插槽（M4 原生菜单的渲染层对应面）；未注入时不渲染占位条 */
  readonly toolbarSlot?: React.ReactNode;
  /** 状态栏插槽（M4+ 保存态/进度）；同上 */
  readonly statusBarSlot?: React.ReactNode;
}

export function Workspace({
  toolbarSlot = null,
  statusBarSlot = null,
}: WorkspaceProps): React.JSX.Element {
  const [roots, setRoots] = useState<readonly TreeNode[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [tabsOp, setTabsOp] = useState<TabsOp>({ tabs: [], activeId: null });
  const [debounceMs, setDebounceMs] = useState(300);
  const [autoSaveMs, setAutoSaveMs] = useState(3000);
  // 三栏布局态（FR-SHELL-01）：折叠三态 + 宽度比例；启动时由 settingsGet 恢复（装配 effect）
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
  // 树栏视图态（M5 三态容器，Task 7 三态齐备）：'tree'=资源树 / 'search'=全局搜索 /
  // 'trash'=回收站；search/trash 面板数据自持（各自挂载首拉 + 域广播重拉），Workspace
  // 只负责态切换与退出通道（返回钮 / Esc / 菜单命令），不代理其数据拉取
  const [view, setView] = useState<TreePaneView>('tree');
  // 树内定位选中覆盖（M5 Task 7 评审 fix，spec §2.2「在树中显示/定位打开」）：M4 架构
  // selected 即 activeTab，reveal 不开标签但需树内高亮——以覆盖值临时接管 TreePanel 的
  // selectedId；activeId 一变（开标签/切签/关签补位）即回落，用户焦点变化优先于 reveal 残留
  const [revealSelectionId, setRevealSelectionId] = useState<number | null>(null);
  // 快速打开浮层开关（M5 批次① Task 6）：唯一写入口是 shell:command dispatch（菜单
  // Ctrl+P），点选/取消由浮层经 onOpenChange 回传收口
  const [quickOpen, setQuickOpen] = useState(false);
  // 设置覆盖层开关（M5 批次③ Task 8）：入口 = 状态栏「设置」钮 + 菜单 'open-settings' 命令；
  // 非 view 三态枚举成员——覆盖于工作台之上、关闭后工作台状态原样还原
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 外观域（M5 批次③ Task 8）：意图（持久化值）与解析结果（驱动 .dark 类与编辑器主题
  // props）。解析初值 light——spec §4.3 D10「首帧默认 light，装配后切换，闪变定档为已知边界」
  const [themeIntent, setThemeIntent] = useState<ThemeIntent>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [editorFontSize, setEditorFontSize] = useState(14);
  // 备份域（M5 批次③ Task 9）：每日自动备份开关显示值 + 备份条目列表（设置页打开期间
  // 拉取与 backup:done 广播刷新，见下方 effect；Workspace 只做数据提升，页面纯受控）
  const [backupAutoEnabled, setBackupAutoEnabled] = useState(true);
  const [backups, setBackups] = useState<readonly BackupEntry[]>([]);
  // 导入域（M5 批次⑥ Task 12）：待确认导入草稿（源路径/目标父/策略——确认弹层受控态，
  // null=关闭）与进行中进度（io:progress 广播驱动；invoke 返回即收口置 null）
  const [importDraft, setImportDraft] = useState<{
    readonly sourcePaths: readonly string[];
    readonly targetParentId: number;
    readonly conflict: ImportConflict;
  } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
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
  // reveal 选中覆盖回收：activeId 变化即用户改变焦点（开签/切签/关签补位），覆盖值让位
  //（初始挂载同样触发一次，值为 null 无副作用）
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
        // 布局记忆恢复（FR-SHELL-01）：ref 同步记账（后续拖拽持久化以恢复值为基准）
        layoutRef.current = result.value.shell.layout;
        setLayout(result.value.shell.layout);
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

  // 备份列表装载（M5 批次③ Task 9）：设置页打开期间首拉 + backup:done 广播重拉；订阅随
  // 设置页进出成对摘除（关闭即无列表可刷新，不必常驻监听），alive 防卸载后续体回写
  useEffect(() => {
    if (!settingsOpen) return undefined;
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
  }, [settingsOpen]);

  // 导入进度订阅（M5 批次⑥ Task 12，挂载期常驻 + cleanup 成对摘除）：io:progress 广播
  // 驱动进度面板（批次粒度——扫描按源根推进、写入按批推进，B.3-4 事务提交后到达即事实）；
  // 完成态清理由 importNodes invoke 续体收口（toast + 树刷新），广播不负责终态
  useEffect(() => {
    return window.api.onIoProgress((progress) => {
      setImportProgress(progress);
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
    const selectedId = revealSelectionId ?? tabsOp.activeId;
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
   * 清进度面板、D17 计数 toast、树整树标记 stale（已展开目录经既有 stale 重取效应刷新，
   * 折叠目录随展开重取——导入批量写入无逐节点广播，树刷新统一在结果收口）。
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

  /**
   * 最近打开记录点（openFile 聚焦/新建两会话分支共用）：时刻由写入方以本地 ISO 补齐
   * （shared/time.ts 既有格式），经串行队列全量 get→merge→set 写 recent 域。断言理由
   * （A.1-5）：recordRecent 顶部条目盖 now 戳、其余元素原样透传，入参来自 settings 持久化
   * 形态（全元素含 openedAt），输出按超集知识收窄回 RecentEntry[]。
   */
  function recordRecentOpen(node: NodeMeta): void {
    const entry: RecentInput = { nodeId: node.id, virtualPath: node.virtualPath, name: node.name };
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
   * 全量 get→merge→set 写 workspace 域；restoreOnStart 用户开关原样保留
   */
  function persistTabsFromRef(): void {
    const op = tabsRef.current;
    queueSettingsWrite((settings) => ({
      ...settings,
      workspace: {
        ...settings.workspace,
        tabNodeIds: op.tabs.map((t) => t.meta.id),
        activeTabNodeId: op.activeId,
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
      return {
        ...settings,
        recent: { opened: pruneRecentByNodes(opened, aliveIds) as RecentEntry[] },
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
   */
  function switchViewAway(next: Exclude<TreePaneView, 'tree'>): void {
    setMoveMode(null);
    setView(next);
  }

  // search/trash 态 Esc 返回资源树（M5）：与 moveMode Esc 同款 window 级成对挂卸；
  // search 态下 Esc 退出搜索（spec §2.2），输入焦点不阻断（window 级监听）
  useEffect(() => {
    if (view === 'tree') return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setView('tree');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [view]);

  /**
   * 打开文件为标签（树点选/新建文件/启动恢复统一入口）：非文本前置拦截（FR-EDIT-04 归后续
   * 批次，不读库不开标签）→ 大小三分支前置判定（spec §2.4 裁决 D7：渲染层以 meta.size 前置
   * 判定，不发起 readFile）→ readFile 成功才建会话与标签（失败 toast；续体内 MAX_TABS 判满
   * 防孤儿会话）→ 同文件唯一实例仅聚焦。两成功分支（聚焦/新建）都记录 recent 域并尾沿写
   * workspace 域。opts.restore（M5 批次② D7 恢复豁免）：启动恢复路径跳过 5–50MB 征询
   * （会话重建不得卡在启动模态），>50MB 拒开与 MAX_TABS 护栏照常生效。await 化使启动恢复
   * 可顺序驱动（标签序 = 会话序）。
   * @param node 目标文件节点 meta（树数据/恢复验活反查所得）
   * @param opts.restore 是否为启动恢复式打开（true 时豁免软阈值 confirm；缺省 false）
   * @returns 打开流程完成信号（拒绝/失败亦正常返回；恢复链据此串行推进）
   */
  async function openFile(node: NodeMeta, opts?: { readonly restore?: boolean }): Promise<void> {
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

  /** 激活标签（TabBar 点选统一入口）：仅改 activeId（tabs 不动），workspace 域随尾沿写 */
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
   * 分隔条拖拽（树/预览共用，side 定方向）：pointermove 仅本地态（写风暴防护，见 applyLayout），
   * pointerup 一次性持久化；监听器 window 级成对移除（资源成对纪律）。树栏偏移取容器左缘、
   * 预览栏取右缘镜像，换算与钳制归 layoutModel 纯函数
   */
  function onDividerPointerDown(
    side: 'tree' | 'preview',
    e: React.PointerEvent<HTMLDivElement>,
  ): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    const host = e.currentTarget.parentElement;
    if (host === null) return;
    const onMove = (move: PointerEvent): void => {
      const rect = host.getBoundingClientRect();
      const offset = side === 'tree' ? move.clientX - rect.left : rect.right - move.clientX;
      applyLayout(
        side === 'tree'
          ? { treeWidthRatio: ratioFromPointer(rect.width, offset) }
          : { previewWidthRatio: ratioFromPointer(rect.width, offset) },
      );
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistLayout(layoutRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // 激活标签同步给控制器（flushActive 语义基准；tabModel 补位/聚焦后随 activeId 联动）
  useEffect(() => {
    saveController.setActiveNode(tabsOp.activeId);
  }, [tabsOp.activeId, saveController]);

  // 外壳命令订阅（cleanup 成对）：菜单命令 dispatch + 关窗确认链（spec §2.3/§5.2）；
  // switch 分支穷举 ShellCommand 联合（宪法 A.1-4，never 兜底由穷举性承担——联合扩型
  // 未同步追加分支时编译期即报错）
  useEffect(() => {
    return window.api.onShellCommand((command) => {
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
          // 菜单「全局搜索」/Ctrl+Shift+F（M5 Task 7）：切入树栏 search 态（三态容器，切离复位 move 态）
          switchViewAway('search');
          break;
        case 'open-settings':
          // 菜单「设置…」/CmdOrCtrl+,（M5 Task 8）：全屏覆盖设置页（工作台状态保持，关闭即还原）
          setSettingsOpen(true);
          break;
        case 'import':
          // 菜单「导入…」（M5 批次⑥ Task 12）：目录选择 → 策略确认弹层 → io:import 链入口
          beginImport();
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
    });
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

  // —— 渲染段：grid 模板列内联（M4 spec §5.1 D5）——
  // 列序：树 | 树分隔条 | 编辑器前分隔条（固定宽）| 编辑器（1fr 自适应占余）| 预览分隔条 | 预览；
  // 折叠栏收窄条（8px，仅展开钮可视），编辑器折叠收 0px（容器 display:none 保持挂载，保存管线照常）
  const gridColumns = [
    layout.treeCollapsed ? '8px' : `${(layout.treeWidthRatio * 100).toFixed(2)}%`,
    layout.treeCollapsed ? '8px' : '4px', // 分隔条
    '4px', // 编辑器前分隔条（固定宽）
    layout.editorCollapsed ? '0px' : '1fr',
    layout.previewCollapsed ? '8px' : '4px',
    layout.previewCollapsed ? '8px' : `${(layout.previewWidthRatio * 100).toFixed(2)}%`,
  ].join(' ');

  return (
    // 工作台容器（设计系统文档 §7.2）：纵向 flex 等价替代原「无行模板 grid」——插槽行
    // 自然堆叠、三栏区 1fr 占余；类名保留为测试锚点，视觉一律工具类承载
    <div className="lt-workspace flex min-h-0 flex-1 flex-col">
      {toolbarSlot}
      {/* 三栏网格容器（内联列模板；工具栏/状态栏插槽留在外层，不占三栏轨道） */}
      <div
        className="lt-panes grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: gridColumns }}
      >
        {layout.treeCollapsed ? (
          <aside className="lt-pane lt-pane-tree lt-pane-collapsed flex w-full flex-col items-center gap-1 overflow-hidden py-1">
            <button
              type="button"
              aria-label="展开树栏"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={() => updateLayout({ treeCollapsed: false })}
            >
              »
            </button>
          </aside>
        ) : (
          <TreePane
            view={view}
            onOpenSearch={() => switchViewAway('search')}
            onOpenTrash={() => switchViewAway('trash')}
            onBackToTree={() => setView('tree')}
            onCollapse={() => updateLayout({ treeCollapsed: true })}
            treeContent={
              <>
                <TreePanel
                  roots={roots}
                  selectedId={revealSelectionId ?? tabsOp.activeId}
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
              </>
            }
            searchContent={
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
                  setView('tree');
                }}
              />
            }
            trashContent={
              // trash 态：回收站面板整体替换树内容（move 选择条/重命名模态同属树态，不渲染）；
              // 面板数据自持（首拉 + trash 域广播重拉），随态卸载即退订
              <TrashPanel />
            }
          />
        )}
        {/* 树分隔条（可拖拽调宽；树栏折叠时收窄条、不响应拖拽，比例维持记忆值） */}
        <div
          className="lt-divider lt-divider-tree cursor-col-resize bg-border transition-colors duration-100 hover:bg-ring/50"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={layout.treeCollapsed ? undefined : (e) => onDividerPointerDown('tree', e)}
        />
        {/* 编辑器前分隔条（固定 4px 装饰轨）：编辑器折叠时承载展开钮——折叠容器 display:none
            的唯一展开回口（轨道 0px 内不放交互元素） */}
        {layout.editorCollapsed ? (
          <div className="lt-divider lt-divider-editor lt-divider-editor-toggle flex items-center justify-center bg-border">
            <button
              type="button"
              aria-label="展开编辑器"
              className="inline-flex h-5 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={() => updateLayout({ editorCollapsed: false })}
            >
              »
            </button>
          </div>
        ) : (
          <div className="lt-divider lt-divider-editor bg-border" aria-hidden="true" />
        )}
        <section
          className={`lt-pane lt-pane-editor flex min-h-0 min-w-0 flex-col bg-background${
            layout.editorCollapsed ? ' lt-pane-collapsed' : ''
          }`}
          style={layout.editorCollapsed ? { display: 'none' } : undefined}
        >
          <div className="lt-pane-titlebar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/50 px-2">
            <span className="text-xs font-medium text-muted-foreground">编辑器</span>
            <button
              type="button"
              aria-label="折叠编辑器"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={() => updateLayout({ editorCollapsed: true })}
            >
              «
            </button>
          </div>
          {/* TabBar 仅在有标签时占位（全关回空态，M4 spec §3）；激活=仅改 activeId（tabs 不动） */}
          {tabsOp.tabs.length > 0 ? (
            <TabBar
              tabs={tabsOp.tabs}
              activeId={tabsOp.activeId}
              onActivate={activateTab}
              onClose={closeTabById}
            />
          ) : null}
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
        </section>
        {/* 预览分隔条（可拖拽调宽；预览栏折叠时同理不响应拖拽） */}
        <div
          className="lt-divider lt-divider-preview cursor-col-resize bg-border transition-colors duration-100 hover:bg-ring/50"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={
            layout.previewCollapsed ? undefined : (e) => onDividerPointerDown('preview', e)
          }
        />
        {layout.previewCollapsed ? (
          <section className="lt-pane lt-pane-preview lt-pane-collapsed flex w-full flex-col items-center gap-1 overflow-hidden py-1">
            <button
              type="button"
              aria-label="展开预览栏"
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={() => updateLayout({ previewCollapsed: false })}
            >
              «
            </button>
          </section>
        ) : (
          <section className="lt-pane lt-pane-preview flex min-h-0 min-w-0 flex-col bg-background">
            <div className="lt-pane-titlebar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/50 px-2">
              <span className="text-xs font-medium text-muted-foreground">预览</span>
              <button
                type="button"
                aria-label="折叠预览栏"
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
                onClick={() => updateLayout({ previewCollapsed: true })}
              >
                »
              </button>
            </div>
            <PreviewPanel
              node={activeTab?.meta ?? null}
              // 滚动同步接线（M5 Task 11）：投递槽交面板登记；锚点 report 中转至编辑器命令槽
              scrollPostRef={previewScrollPostRef}
              onScrollReport={(anchorText) => editorAnchorScrollRef.current?.(anchorText)}
            />
          </section>
        )}
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
          className="lt-import-progress pointer-events-auto fixed bottom-14 right-4 z-50 flex w-80 flex-col gap-1 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-240 animate-in fade-in slide-in-from-bottom-2"
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
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>导入</AlertDialogTitle>
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
      {/* 状态栏（设计系统文档 §7.2 标准类串）：设置入口钮（M5 Task 8）；保存态/进度占位后续消费 */}
      <footer className="lt-statusbar flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted/50 px-3 text-xs text-muted-foreground">
        <button
          type="button"
          aria-label="打开设置"
          className="ml-auto inline-flex h-5 items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </button>
      </footer>
      {/* 设置覆盖层（M5 批次③ Task 8，spec §4.2 D9）：fixed 全屏覆盖于工作台之上，z-40
          低于 toast/浮层的 z-50（保存失败 toast 保持可见）；非路由非模态——工作台状态原样
          保持，返回即卸载还原；表单即改即存经回调收口（写链与回滚在 Workspace） */}
      {settingsOpen ? (
        <SettingsPage
          theme={themeIntent}
          editorFontSize={editorFontSize}
          debounceMs={debounceMs}
          autoSaveMs={autoSaveMs}
          backups={backups}
          backupAutoEnabled={backupAutoEnabled}
          onBackupAutoEnabledChange={changeBackupAutoEnabled}
          onCreateBackup={createBackupNow}
          onRestoreBackup={restoreBackupNow}
          onThemeChange={changeThemeIntent}
          onFontSizeChange={changeEditorFontSize}
          onDebounceChange={changeDebounceMs}
          onAutoSaveChange={changeAutoSaveMs}
          onBack={() => setSettingsOpen(false)}
        />
      ) : null}
      {statusBarSlot}
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
