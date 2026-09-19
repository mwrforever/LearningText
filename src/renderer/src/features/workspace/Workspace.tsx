/**
 * 三栏工作台 + 多标签会话中枢（M4 spec §3）：tabs/activeTab 状态机（tabModel 纯函数不可变
 * 更新）+ TabSessions per-tab 会话容器；openFile 前置拦截（非文本 toast 拒开、readFile 成功
 * 才建会话与标签）。树数据/展开集/settings 去抖值照旧在此提升，TreePanel/TabBar/EditorPanel/
 * PreviewPanel 纯 props 消费（A.7-6 单向）。保存管线（SaveController）在此装配：编辑回路
 * edit、关标签 flush 后关、保存钮 flushActive、卸载 dispose 成对释放。壳插槽（toolbar/
 * statusBar）props 预留不动（评审 D5）。
 */
import { useEffect, useRef, useState } from 'react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { createEditorState } from '../editor/codemirror';
import { EditorPanel } from '../editor/EditorPanel';
import { SaveController } from '../editor/saveController';
import { TabSessions } from '../editor/tabSessions';
import { PreviewPanel } from '../preview/PreviewPanel';
import {
  applyBroadcast,
  collectStaleExpanded,
  makeTreeRoot,
  withChildren,
  type TreeNode,
} from '../tree/treeModel';
import { TreePanel } from '../tree/TreePanel';
import { showToast } from '../ui/Toast';
import { TabBar } from './TabBar';
import { MAX_TABS, closeTab, openTab, setTabDirty, type TabsOp } from './tabModel';

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

  // 树广播订阅（cleanup 成对）：结构同步 + stale 展开层重取（spec §4.3）
  useEffect(() => {
    const unsubscribe = window.api.onVfsChanged((broadcast) => {
      setRoots((prev) => applyBroadcast(prev, broadcast));
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

  /**
   * 打开文件为标签（树点选/新建文件唯一入口）：非文本前置拦截（FR-EDIT-04 归后续批次，
   * 不读库不开标签）→ readFile 成功才建会话与标签（失败 toast）→ 同文件唯一实例仅聚焦
   */
  function openFile(node: NodeMeta): void {
    if (node.mimeType === null || !isTextLike(node.mimeType)) {
      showToast('二进制文件暂不支持编辑（FR-EDIT-04 归后续批次）');
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

  return (
    <div className="lt-workspace">
      {toolbarSlot}
      <aside className="lt-pane lt-pane-tree">
        <TreePanel
          roots={roots}
          selectedId={tabsOp.activeId}
          onToggle={onToggle}
          onSelect={openFile}
          onCreate={onCreate}
          onTrash={onTrash}
        />
      </aside>
      <section className="lt-pane lt-pane-editor">
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
          onDocChanged={(id, text) => saveController.edit(id, text)}
          onSaveRequest={() => saveController.flushActive()}
        />
      </section>
      <section className="lt-pane lt-pane-preview">
        <PreviewPanel node={activeTab?.meta ?? null} />
      </section>
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
