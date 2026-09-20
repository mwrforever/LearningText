/**
 * 编辑区（M4 spec §4）：CodeMirror 内核——单 EditorView 实例 + TabSessions 会话换入换出
 * （doc/undo/光标跨标签保留）；props 面自 M3 textarea 占位演进为会话式（node → activeTab+sessions，
 * 工作台三栏结构与 shell 插槽不重排——M3 接缝语义兑现）。二进制/空态在 Workspace.openFile
 * 前置拦截（非文本不开标签），本组件不再有二进制分支（无死分支纪律）。
 * M5 批次③ Task 8：外观联动——theme/editorFontSize 变化时 Workspace 以新扩展集重建会话
 * 状态，本组件经 state 实例同一性感知后 setState 换入（滚动保留、doc/光标透传）。
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
   * 界面主题解析结果（M5 Task 8）：驱动语法主题换入（dark → one-dark / light → 照旧）——
   * Workspace 以新外观重建会话状态后，本组件经 state 实例同一性感知并 setState 换入；
   * 缺省 light（出厂默认，测试桩场景同值）
   */
  readonly theme?: 'light' | 'dark';
  /** 编辑器字号 px（CM 根节点 font-size；字号变更同走 view 重建换入；缺省 14 出厂默认） */
  readonly editorFontSize?: number;
  /** 立即保存请求（保存钮 = 原生菜单同款命令）：Workspace 接 SaveController.flushActive */
  readonly onSaveRequest?: () => void;
}

export function EditorPanel({
  sessions,
  activeTab,
  theme = 'light',
  editorFontSize = 14,
  onSaveRequest,
}: EditorPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeNodeIdRef = useRef<number | null>(null);
  // 上次应用的外观镜像：外观换入需「外观 props 变化 + 会话状态实例替换」双信号同时成立——
  // 仅凭实例不同会误伤 M4 评审 Important-1 防线（同 id 重渲染时视图为权威，会话态因测试桩
  // 或未回写输入滞后是合法态，不得以陈旧态覆盖视图）
  const lastAppearanceRef = useRef<{ theme: 'light' | 'dark'; fontSize: number }>({
    theme,
    fontSize: editorFontSize,
  });

  // 激活会话换入（外部数据到达，唯一例外 effect 域）：首挂建 view；切签 setState 换入并回写
  // 旧会话（state/scroll）；切至无激活（关末签）时 host 随占位分支卸载、视图 DOM 脱离文档不可
  // 复用——先回写会话再销毁，下次激活由会话 state 重建（doc/undo/滚动无损，A.1-9 资源成对）
  useEffect(() => {
    const view = viewRef.current;
    // 外观变化先记账（早于各分支早退）：后续提交据此判定是否处于外观重建窗口
    const appearanceChanged =
      lastAppearanceRef.current.theme !== theme ||
      lastAppearanceRef.current.fontSize !== editorFontSize;
    lastAppearanceRef.current = { theme, fontSize: editorFontSize };
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
      } else if (appearanceChanged && session.state !== view.state) {
        // 外观重建换入（M5 Task 8，spec §4.3 D10）：Workspace 在主题/字号变更时以新扩展集
        // 同步重建全部会话状态——「外观 props 变化 + state 实例替换」双信号即重建换入窗口；
        // 滚动记忆保留，doc/光标由重建态透传承载，撤销历史随状态重建归零（view 重建机制的
        // 已知边界，spec 明示「主题切换 = EditorView 重建」）
        const scrollTop = view.scrollDOM.scrollTop;
        view.setState(session.state);
        view.scrollDOM.scrollTop = scrollTop;
      }
    }
    activeNodeIdRef.current = activeTab.meta.id;
    return undefined;
  }, [activeTab, sessions, theme, editorFontSize]);

  // 卸载销毁成对（宪法资源纪律；jsdom 断言依赖 destroy 清 DOM——brief 落地注 ④）
  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  if (activeTab === null) {
    return (
      // 空态占位（content 档 14px 次要文字，居中；aria-label 锚点零变更）
      <div
        className="lt-editor-empty flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
        aria-label="编辑区占位"
      >
        未选中文件
      </div>
    );
  }
  return (
    <div className="lt-editor flex min-h-0 flex-1 flex-col">
      {/* 宿主不设 overflow：滚动语义仍归 CM6 自管（设计系统文档 §7.2） */}
      <div className="lt-editor-host min-h-0 flex-1" ref={hostRef} />
      <div className="lt-editor-bar flex items-center gap-2 border-t border-border bg-muted/50 px-2 py-1 text-xs">
        {/* M4 起保存由原生菜单 Ctrl/Cmd+S 承载（Task 6）；按钮保留为可见入口，点击即菜单同款命令
            （brief 落地注 ②：立即写语义归 Task 5 管线，本任务经 onSaveRequest 可选接线） */}
        <button
          type="button"
          className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            onSaveRequest?.();
          }}
        >
          保存
        </button>
        {/* 保存态文案：脏态转破坏色（对比度自证见设计系统文档 §3.1 #10/#16），净态次要文字。
            无冲突条件拼接用模板字面量（cn/tailwind-merge 运行时留给 shadcn 组件场景，D28 体积红线） */}
        <span
          aria-live="polite"
          className={`ml-auto ${activeTab.dirty ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {activeTab.dirty ? '未保存' : '已保存'}
        </span>
      </div>
    </div>
  );
}
