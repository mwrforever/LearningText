/**
 * 编辑区（M4 spec §4）：CodeMirror 内核——单 EditorView 实例 + TabSessions 会话换入换出
 * （doc/undo/光标跨标签保留）；props 面自 M3 textarea 占位演进为会话式（node → activeTab+sessions，
 * 工作台三栏结构与 shell 插槽不重排——M3 接缝语义兑现）。二进制/空态在 Workspace.openFile
 * 前置拦截（非文本不开标签），本组件不再有二进制分支（无死分支纪律）。
 * 渲染期零副作用：view 生命周期与会话换入全在 effect（75647f2 渲染期禁写 ref 先例）。
 */
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { TabState } from '../workspace/tabModel';
import { TabSessions } from './tabSessions';
// 空绑定 type import：把 window-api.ts 的全局 Window.api 声明拉入渲染层编译程序
import type {} from '../../../../shared/window-api';

export interface EditorPanelProps {
  /** 标签会话容器（Workspace 持有；state 由调用方经 createEditorState 构造后 open） */
  readonly sessions: TabSessions;
  /** 当前激活标签（null → 空态占位；会话未 open 时换入 effect 跳过） */
  readonly activeTab: TabState | null;
  /**
   * 尾沿去抖（FR-RENDER-03）——本组件暂不消费（写管线本体在 Workspace 的 SaveController，
   * Task 5 接线）；参数位按 brief 落地注 ③ 保留为 props 契约，不做解构绑定
   */
  readonly debounceMs: number;
  /**
   * 文档变更回报（Workspace → SaveController.edit，Task 5 接线）：本组件不经 props 调用——
   * CM 监听闭包在会话 state 创建时固化（createEditorState handlers 携 nodeId），此 props
   * 仅为 Task 4/5 的接线面（brief 签名逐字保留）
   */
  readonly onDocChanged: (nodeId: number, text: string) => void;
  /** 立即保存请求（保存钮 = 原生菜单同款命令）：Workspace 接 SaveController.flushActive */
  readonly onSaveRequest?: () => void;
}

export function EditorPanel({
  sessions,
  activeTab,
  onSaveRequest,
}: EditorPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeNodeIdRef = useRef<number | null>(null);

  // 激活会话换入（外部数据到达，唯一例外 effect 域）：首挂建 view；切签 setState 换入并回写
  // 旧会话（state/scroll）；切至无激活（关末签）时 host 随占位分支卸载、视图 DOM 脱离文档不可
  // 复用——先回写会话再销毁，下次激活由会话 state 重建（doc/undo/滚动无损，A.1-9 资源成对）
  useEffect(() => {
    const view = viewRef.current;
    if (activeTab === null) {
      const prevId = activeNodeIdRef.current;
      if (view !== null && prevId !== null) {
        sessions.updateState(prevId, view.state);
        sessions.updateScroll(prevId, view.scrollDOM.scrollTop);
      }
      view?.destroy();
      viewRef.current = null;
      activeNodeIdRef.current = null;
      return undefined;
    }
    const session = sessions.get(activeTab.meta.id);
    if (session === undefined) return undefined;
    if (view === null) {
      const created = new EditorView({
        parent: hostRef.current ?? undefined,
        state: session.state,
      });
      created.scrollDOM.scrollTop = session.scrollTop;
      viewRef.current = created;
    } else {
      const prevId = activeNodeIdRef.current;
      if (prevId !== null && prevId !== activeTab.meta.id) {
        // 仅换签才换入：同 id 重渲染（setTabDirty/updateTabMeta 换新对象）时视图本身持有
        // 最新权威态，此处 setState 会以切签时的陈旧会话态覆盖未回写输入，并经 updateListener
        // 以旧文本再触发 docChanged（评审 Important-1：草稿丢失/陈旧写入）
        sessions.updateState(prevId, view.state);
        sessions.updateScroll(prevId, view.scrollDOM.scrollTop);
        view.setState(session.state);
        view.scrollDOM.scrollTop = session.scrollTop;
      }
    }
    activeNodeIdRef.current = activeTab.meta.id;
    return undefined;
  }, [activeTab, sessions]);

  // 卸载销毁成对（宪法资源纪律；jsdom 断言依赖 destroy 清 DOM——brief 落地注 ④）
  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  if (activeTab === null) {
    return (
      <div className="lt-editor-empty" aria-label="编辑区占位">
        未选中文件
      </div>
    );
  }
  return (
    <div className="lt-editor">
      <div className="lt-editor-host" ref={hostRef} />
      <div className="lt-editor-bar">
        {/* M4 起保存由原生菜单 Ctrl/Cmd+S 承载（Task 6）；按钮保留为可见入口，点击即菜单同款命令
            （brief 落地注 ②：立即写语义归 Task 5 管线，本任务经 onSaveRequest 可选接线） */}
        <button
          type="button"
          onClick={() => {
            onSaveRequest?.();
          }}
        >
          保存
        </button>
        <span aria-live="polite">{activeTab.dirty ? '未保存' : '已保存'}</span>
      </div>
    </div>
  );
}
