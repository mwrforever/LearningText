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
 * 树栏三态视图容器（M5 批次②）：view 'tree'|'trash' 切换（search 态归 Task 7）——
 * 工具栏「回收站」钮进入、返回钮/Esc 退出；trash 态由 TrashPanel 数据自持渲染。
 * 壳插槽（toolbar/statusBar）props 预留不动（评审 D5）。
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYOUT } from '../../../../shared/settings-contract';
import type { ShellLayout } from '../../../../shared/settings-contract';
import type { NodeMeta } from '../../../../shared/vfs-contract';
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
import { TreePanel } from '../tree/TreePanel';
import { TrashPanel } from '../trash/TrashPanel';
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
  // move 选择模式（M4 spec §6.2 D8）：null=未进入；targetId=已点选的目标目录（null=尚待点选）。
  // 源节点不单独存态——进入模式要求有选中，且模式期间 file 点选禁用、dir 点选仅记账目标，
  // 选中（activeId）不可能变化，直接以 tabsOp.activeId 为源
  const [moveMode, setMoveMode] = useState<{ targetId: number | null } | null>(null);
  // move 请求在途（确认钮防重复提交）
  const [moveInFlight, setMoveInFlight] = useState(false);
  // 行内重命名模态目标（M4 spec §6.2 D8）：null=关闭；name 取树内当前名预填
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  // rename 请求在途（模态确认钮防重复提交）
  const [renameInFlight, setRenameInFlight] = useState(false);
  // 树栏视图态（M5 批次②三态容器，本任务先立 trash 态最小切换，search 态归 Task 7）：
  // 'tree'=资源树 / 'trash'=回收站；回收站面板数据自持（挂载首拉 + trash 域广播重拉），
  // Workspace 只负责态切换与退出通道（返回钮 / Esc），不代理其数据拉取
  const [view, setView] = useState<'tree' | 'trash'>('tree');
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
        // 布局记忆恢复（FR-SHELL-01）：ref 同步记账（后续拖拽持久化以恢复值为基准）
        layoutRef.current = result.value.shell.layout;
        setLayout(result.value.shell.layout);
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

  // —— 树 rename/move（M4 spec §6.2 D8）——
  // move 模式派生量（渲染期纯读）：源 = 选中节点（模式期间选中不可变，见 moveMode 注），
  // 目标为自身/其后代时确认禁用 + 提示（isDescendant 不含自身，自移在此并判）
  const moveSourceId = moveMode !== null ? tabsOp.activeId : null;
  const moveTargetId = moveMode !== null ? moveMode.targetId : null;
  const moveInvalid =
    moveSourceId !== null &&
    moveTargetId !== null &&
    (moveTargetId === moveSourceId || isDescendant(roots, moveSourceId, moveTargetId));

  /**
   * 树点选统一入口：常规模式走 openFile（开标签）；move 选择模式下 dir 点选临时变为
   * 「选定目标」记账（file 点选已被 TreePanel 禁用），合法性判定归确认钮
   */
  function onSelectNode(node: NodeMeta): void {
    if (moveMode !== null) {
      if (node.nodeType === 'dir') setMoveMode({ targetId: node.id });
      return;
    }
    openFile(node);
  }

  /** 进入 move 选择模式：目标待点选（源 = 当前选中，入口钮仅在非根选中时可达） */
  function startMove(): void {
    setMoveMode({ targetId: null });
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

  /** 重命名入口（树工具栏钮）：取树内当前名预填模态；树未命中静默忽略（入口仅在树选中时可达） */
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

  // trash 态 Esc 返回资源树（M5 批次②）：与 moveMode Esc 同款 window 级成对挂卸
  useEffect(() => {
    if (view !== 'trash') return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setView('tree');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [view]);

  /**
   * 打开文件为标签（树点选/新建文件唯一入口）：非文本前置拦截（FR-EDIT-04 归后续批次，
   * 不读库不开标签）→ 大小三分支前置判定（spec §2.4 裁决 D7：渲染层以 meta.size 前置判定，
   * 不发起 readFile）→ readFile 成功才建会话与标签（失败 toast；续体内 MAX_TABS 判满防
   * 孤儿会话）→ 同文件唯一实例仅聚焦
   */
  function openFile(node: NodeMeta): void {
    if (node.mimeType === null || !isTextLike(node.mimeType)) {
      showToast('二进制文件暂不支持编辑（FR-EDIT-04 归后续批次）');
      return;
    }
    // 大小三分支前置判定（spec §2.4 裁决 D7，阈值 5MB/50MB；size 为字节——NodeMeta 契约）：
    // >50MB 直接拒开且不发起 readFile（超大文档读入解码必拖垮渲染层，无征询意义）；5–50MB
    // 经用户确认放行（大文档 CM 建档可能卡顿，交由用户权衡）；≤5MB 直开（现行为）。判定只读
    // meta 本地字段、同步完成，天然早于任何 IPC；MAX_TABS 判满仍留在 readFile 续体内——
    // tabsRef 实时态只在异步续体时刻才有意义（快速连点的中间态），前置同步判定反而引入
    // 并发窗口（见续体内注释）
    if (node.size > LARGE_FILE_HARD_LIMIT_BYTES) {
      showToast('文件超过 50MB，无法打开');
      return;
    }
    if (
      node.size > LARGE_FILE_SOFT_LIMIT_BYTES &&
      !window.confirm('大文件打开可能卡顿，是否继续？')
    ) {
      return;
    }
    void window.api.readFile({ nodeId: node.id }).then((result) => {
      if (!result.ok) {
        showToast(`打开失败：${result.error.message}`);
        return;
      }
      // 同文件唯一实例（tabModel openTab 幂等语义）：会话已在，聚焦既有标签即可
      if (sessions.has(node.id)) {
        setTabsOp((prev) => openTab(prev, node));
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
        createEditorState(
          new TextDecoder().decode(result.value.content),
          node.mimeType ?? 'text/plain',
          {
            // 库以新实例整体替换 state（A.1-9）：会话态同步 + 输入回路进保存管线（双计时器调度落库）
            onDocChanged: (text, state) => {
              sessions.updateState(node.id, state);
              saveController.edit(node.id, text);
            },
            onScroll: (top) => sessions.updateScroll(node.id, top),
          },
        ),
      );
      setTabsOp((prev) => openTab(prev, node));
    });
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
  // switch 四分支穷举 ShellCommand 联合（宪法 A.1-4，never 兜底由穷举性承担）
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
          <aside className="lt-pane lt-pane-tree flex min-h-0 min-w-0 flex-col bg-background">
            {/* 树栏标题栏随视图态换题与操作（三态容器，M5 批次②）：tree 态提供回收站入口，
                trash 态提供返回口；折叠钮两态常驻（布局行为与视图态正交） */}
            <div className="lt-pane-titlebar flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/50 px-2">
              <span className="text-xs font-medium text-muted-foreground">
                {view === 'trash' ? '回收站' : '资源树'}
              </span>
              <div className="flex items-center gap-1">
                {view === 'trash' ? (
                  <button
                    type="button"
                    aria-label="返回资源树"
                    className="inline-flex h-5 items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
                    onClick={() => setView('tree')}
                  >
                    返回
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="打开回收站"
                    className="inline-flex h-5 items-center justify-center rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
                    onClick={() => setView('trash')}
                  >
                    回收站
                  </button>
                )}
                <button
                  type="button"
                  aria-label="折叠树栏"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => updateLayout({ treeCollapsed: true })}
                >
                  «
                </button>
              </div>
            </div>
            {view === 'trash' ? (
              // trash 态：回收站面板整体替换树内容（move 选择条/重命名模态同属树态，不渲染）；
              // 面板数据自持（首拉 + trash 域广播重拉），随态卸载即退订
              <TrashPanel />
            ) : (
              <>
                <TreePanel
                  roots={roots}
                  selectedId={tabsOp.activeId}
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
                    Esc 或取消退出。目标非法提示就地呈现（不占 toast 生命周期） */}
                {moveMode !== null ? (
                  <div
                    className="lt-move-bar flex flex-wrap items-center gap-2 border-t border-border bg-muted/50 px-2 py-1"
                    role="group"
                    aria-label="移动选择模式"
                  >
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
            )}
          </aside>
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
              onActivate={(id) => setTabsOp((prev) => ({ ...prev, activeId: id }))}
              onClose={closeTabById}
            />
          ) : null}
          <EditorPanel
            sessions={sessions}
            activeTab={activeTab}
            debounceMs={debounceMs}
            onSaveRequest={() => saveController.flushActive()}
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
            <PreviewPanel node={activeTab?.meta ?? null} />
          </section>
        )}
      </div>
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
