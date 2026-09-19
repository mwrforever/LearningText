/**
 * 三栏工作台（M3 spec §6/§6.1）：状态提升中枢——树数据/展开集/选中/settings 去抖值
 * 全部在此，TreePanel/EditorPanel/PreviewPanel 纯 props 消费（A.7-6 单向）。
 * 壳插槽（toolbar/statusBar）props 预留，M4 外壳批次往缝里填不重排（评审 D5 接缝）。
 */
import { useEffect, useState } from 'react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { EditorPanel } from '../editor/EditorPanel';
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
  const [selected, setSelected] = useState<NodeMeta | null>(null);
  const [debounceMs, setDebounceMs] = useState(300);
  // 标签会话容器（M4 spec §3）：TabSessions 为可变容器、随 Workspace 生命周期持有；
  // useState 惰性初始化保证实例稳定（渲染期禁写 ref 先例，宪法 A.1-10）
  const [sessions] = useState(() => new TabSessions());

  // 启动装配：设置加载（失败回退默认由服务侧保证，此处仅防 IPC 层异常）+ 根 children 首拉
  useEffect(() => {
    let alive = true;
    void window.api.settingsGet().then((result) => {
      if (alive && result.ok) setDebounceMs(result.value.preview.debounceMs);
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
      // created 广播到达自动挂入已加载父（treeModel insert）；重名等错误 toast 归 M4，此处静默忽略
      if (result.ok && nodeType === 'file') setSelected(result.value);
    });
  }

  function onTrash(nodeId: number): void {
    void window.api.trashNode({ nodeId }).then((result) => {
      if (result.ok && selected !== null && selected.id === nodeId) setSelected(null);
    });
  }

  return (
    <div className="lt-workspace">
      {toolbarSlot}
      <aside className="lt-pane lt-pane-tree">
        <TreePanel
          roots={roots}
          selectedId={selected?.id ?? null}
          onToggle={onToggle}
          onSelect={setSelected}
          onCreate={onCreate}
          onTrash={onTrash}
        />
      </aside>
      <section className="lt-pane lt-pane-editor">
        {/* M4 Task 3 过渡桥：EditorPanel 已换会话式 props（node → activeTab+sessions）；
            标签开启/激活换入归 Task 4（TabBar 与 openFile 前置拦截），onDocChanged/保存管线归
            Task 5（SaveController）——本批 activeTab 恒空，编辑区显示空态占位 */}
        <EditorPanel
          sessions={sessions}
          activeTab={null}
          debounceMs={debounceMs}
          onDocChanged={() => undefined}
        />
      </section>
      <section className="lt-pane lt-pane-preview">
        <PreviewPanel node={selected} />
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
