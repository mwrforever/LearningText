/**
 * 编辑区（M4 spec §4）：CodeMirror 内核——单 EditorView 实例 + TabSessions 会话换入换出
 * （doc/undo/光标跨标签保留）；props 面自 M3 textarea 占位演进为会话式（node → activeTab+sessions，
 * 工作台三栏结构与 shell 插槽不重排——M3 接缝语义兑现）。二进制/空态在 Workspace.openFile
 * 前置拦截（非文本不开标签），本组件不再有二进制分支（无死分支纪律）。
 * M5 批次③ Task 8：外观联动——theme/editorFontSize 变化经外观 compartment reconfigure
 * effect 同 state 重配（doc/undo/光标/滚动全保留，CM6 官方习语；评审 Important fix round 1
 * 弃用 EditorState 整体重建——该路径丢失撤销历史）；切签换入与首挂建视图后均无条件对齐外观
 * （非激活标签 / 恢复链 mount 闭包构造的 state，compartment 内容可能滞后于当前外观——
 * M5 终审 Important：恢复式打开单标签场景的陈旧外观自愈落点在建视图分支）。
 * M5 批次⑤ Task 11：滚动同步（FR-RENDER-06）——上行：scrollDOM 监听（独立 effect 挂卸，
 * 不触碰会话 state 与 compartment，Task 8 同 state 重配机制零交互）经 100ms 节流计算比例
 * 回调 onScrollRatio（Workspace 桥接至预览投递），上报即盖章进 150ms 抑制窗（D13）；下行：
 * 经 anchorScrollRef 槽位登记「滚动到锚点」命令（预览 report 经 Workspace 中转到达），
 * 锚点 doc.indexOf 首处 scrollIntoView、未命中静默（启发式已知边界），应用前过抑制窗防回环。
 * 渲染期零副作用：view 生命周期与会话换入全在 effect（75647f2 渲染期禁写 ref 先例）。
 */
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { FileText } from 'lucide-react';
import { ratioFromScroll, shouldSuppressReport } from '../preview/scrollSync';
import type { TabState } from '../workspace/tabModel';
import { appearanceReconfigureEffect } from './codemirror';
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
   * 界面主题解析结果（M5 Task 8）：变化即对本视图 dispatch 外观 compartment reconfigure
   * effect（dark → one-dark / light → 照旧，同 state 重配保 doc/undo）；缺省 light
   * （出厂默认，测试桩场景同值）
   */
  readonly theme?: 'light' | 'dark';
  /** 编辑器字号 px（CM 根节点 font-size；变更同走 compartment 重配；缺省 14 出厂默认） */
  readonly editorFontSize?: number;
  /** 立即保存请求（保存钮 = 原生菜单同款命令）：Workspace 接 SaveController.flushActive */
  readonly onSaveRequest?: () => void;
  /**
   * 滚动同步上行出口（M5 Task 11）：编辑器滚动经 100ms 节流换算比例后回调（Workspace
   * 桥接到预览面板的 iframe postMessage；开关闸门在预览侧）。缺省（未接线/测试桩）静默
   */
  readonly onScrollRatio?: (ratio: number) => void;
  /**
   * 滚动同步下行命令槽（M5 Task 11）：面板在 effect 内登记「滚动到锚点」实现（预览
   * lt:scroll-report 经 Workspace 中转到达；锚点未命中静默、150ms 抑制窗 D13），
   * 卸载时摘除（置 null）——Workspace 持槽位中转，两侧面板互不感知
   */
  readonly anchorScrollRef?: React.RefObject<((anchorText: string) => void) | null>;
}

/** 上行比例上报节流间隔（spec §6「节流 ~100ms」定档） */
const SCROLL_REPORT_INTERVAL_MS = 100;

export function EditorPanel({
  sessions,
  activeTab,
  theme = 'light',
  editorFontSize = 14,
  onSaveRequest,
  onScrollRatio,
  anchorScrollRef,
}: EditorPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeNodeIdRef = useRef<number | null>(null);
  // 上次应用的外观镜像：同 id 重渲染仅在外观信号变化时派发 reconfigure（评审 Minor 1 守卫——
  // 解析主题与字号均未变化即零派发，M4 评审 Important-1 的「视图为权威」同 id 防线不变）
  const lastAppearanceRef = useRef<{ theme: 'light' | 'dark'; fontSize: number }>({
    theme,
    fontSize: editorFontSize,
  });
  // 滚动同步（M5 Task 11）：上次同步盖章时刻（D13 抑制窗基准），-Infinity 表达「从未同步」
  // ——首份预览报告不被抑制；随组件卸载整体回收（数值态无 timer 需清理）
  const lastSyncAtRef = useRef<number>(Number.NEGATIVE_INFINITY);
  // onScrollRatio 实时镜像：监听闭包持稳（随 activeTab 进出挂卸），事件时刻读最新回调
  //（settingsRef 同款模式——Workspace 传入的内联闭包随渲染换新，直捕必陈旧）
  const onScrollRatioRef = useRef(onScrollRatio);
  useEffect(() => {
    onScrollRatioRef.current = onScrollRatio;
  }, [onScrollRatio]);

  // 激活会话换入（外部数据到达，唯一例外 effect 域）：首挂建 view；切签 setState 换入并回写
  // 旧会话（state/scroll）；切至无激活（关末签）时 host 随占位分支卸载、视图 DOM 脱离文档不可
  // 复用——先回写会话再销毁，下次激活由会话 state 重建（doc/undo/滚动无损，A.1-9 资源成对）
  useEffect(() => {
    const view = viewRef.current;
    // 外观变化先记账（早于各分支早退）：后续提交据此判定是否需要同 state 重配
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
      // 首挂建 view：openFile 以当前外观构造会话 state（compartment 内容即当前值），无需对齐。
      // 例外（M5 终审 Important）：恢复式打开的会话由 Workspace 恢复链的 mount 闭包构造，
      // 可能持陈旧外观（且空态期的外观变更早已记账、appearanceChanged 恒 false）——创建分支
      // 同样无条件对齐：reconfigure 与 compartment 当前值等值时为 no-op transaction，幂等安全
      const created = new EditorView({
        parent: hostRef.current ?? undefined,
        state: session.state,
      });
      created.scrollDOM.scrollTop = session.scrollTop;
      created.dispatch({ effects: appearanceReconfigureEffect(lastAppearanceRef.current) });
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
        // 换入态可能错过非激活期的外观变更（state compartment 内容不可内省），无条件对齐：
        // 同 state 重配无 doc 变更、不进撤销栈（重配值与当前一致时为等价 no-op transaction）
        view.dispatch({
          effects: appearanceReconfigureEffect(lastAppearanceRef.current),
        });
      } else if (appearanceChanged) {
        // 外观同 state 重配（M5 Task 8，spec §4.3 D10 两半：重建生效 + 保 doc/undo）——
        // doc/光标/滚动/撤销历史全保留，仅外观 compartment 片段替换（fix round 1 起）
        view.dispatch({
          effects: appearanceReconfigureEffect(lastAppearanceRef.current),
        });
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

  // —— 滚动同步上行（M5 Task 11）：scrollDOM 独立监听 → 100ms 节流比例上报 ——
  // 声明在视图生命周期 effect 之后：同轮提交后行 effect 才能读到新建/换入后的 viewRef。
  // 监听随 activeTab 进出成对挂卸（视图实例仅在首挂/空态往返时更换，activeTab 依赖覆盖全部
  // 换点）；节流计时器为 effect 局部量，卸载/换签 cleanup 一并清除（资源成对）。本监听不触
  // 碰会话 state 与 compartment——Task 8 同 state 重配机制零交互；既有 M4 onScroll 会话
  // 回写链路（state 内建 domEventHandlers）原样并行，职责互斥（持久化归彼、同步上报归此）
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return undefined;
    const dom = view.scrollDOM;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEmitAt = Number.NEGATIVE_INFINITY;
    // 上报即盖章（D13）：随后 iframe 因 scrollTo 产生的回响 report 落入 150ms 抑制窗
    const emit = (): void => {
      lastEmitAt = Date.now();
      lastSyncAtRef.current = lastEmitAt;
      onScrollRatioRef.current?.(
        ratioFromScroll(dom.scrollTop, dom.clientHeight, dom.scrollHeight),
      );
    };
    const onDomScroll = (): void => {
      const elapsed = Date.now() - lastEmitAt;
      if (elapsed >= SCROLL_REPORT_INTERVAL_MS) {
        emit(); // 首个事件即发（跟随感）；后续事件在窗内合并、尾沿补发最新位置
        return;
      }
      if (trailingTimer !== null) return;
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        if (viewRef.current === null) return; // 空态切换后视图已销毁，不再补发
        emit();
      }, SCROLL_REPORT_INTERVAL_MS - elapsed);
    };
    dom.addEventListener('scroll', onDomScroll);
    return () => {
      dom.removeEventListener('scroll', onDomScroll);
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
    };
  }, [activeTab]);

  // —— 滚动同步下行（M5 Task 11）：向槽位登记「滚动到锚点」命令，卸载摘除成对 ——
  // 闭包经 viewRef 读当前视图（跨换签/空态往返有效，槽位登记挂载期一次）。应用同步滚动前
  // 先过 D13 抑制窗：150ms 内的预览报告视为自身上报的回响，静默忽略（回环不死循环的父侧
  // 闸门）；锚点未命中（渲染文本与源文不可对齐——启发式已知边界）与空锚点均静默零派发。
  // 滚动走 transaction effect（CM6 习语）：scrollIntoView 不改 doc/selection、不原地动 state
  useEffect(() => {
    const slot = anchorScrollRef;
    if (slot === undefined) return undefined;
    slot.current = (anchorText: string) => {
      const view = viewRef.current;
      if (view === null) return;
      if (anchorText === '') return;
      const now = Date.now();
      if (shouldSuppressReport(lastSyncAtRef.current, now)) return;
      const offset = view.state.doc.toString().indexOf(anchorText);
      if (offset === -1) return;
      lastSyncAtRef.current = now;
      view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: 'start' }) });
    };
    return () => {
      slot.current = null;
    };
  }, [anchorScrollRef]);

  if (activeTab === null) {
    return (
      // 空态占位（content 档 14px 次要文字，居中；aria-label 锚点零变更）。
      // 打磨（M5 Task 15）：裸文字空态升级为「图标 + 文案」组合空态——装饰性图标
      // aria-hidden 不进可访问性树，文本节点内容不变（E2E/单测 textContent 锚点零变更）
      <div
        className="lt-editor-empty flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground"
        aria-label="编辑区占位"
      >
        <FileText aria-hidden="true" strokeWidth={1.5} className="h-6 w-6 opacity-60" />
        <p className="m-0">未选中文件</p>
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
