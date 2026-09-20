/**
 * CodeMirror 6 扩展工厂（宪法 A.1-9 / 调研 A7-10 习语）：curated 扩展集（M4 spec 裁决 D6，
 * 不引元包 basicSetup——autocompletion/closeBrackets/foldGutter 未要求）；扩展工厂函数形态，
 * 静态扩展依赖去重；监听类扩展随会话 state 闭包固定 nodeId（每会话一份，无共享可变态）。
 * M5 批次③ Task 8：工厂增外观参数（语法主题 dark → one-dark / light → defaultHighlightStyle
 * 二选一 + 根节点字号），经外观 compartment 承载——主题/字号变更由视图 dispatch reconfigure
 * effect 同 state 重配，doc/undo/光标/滚动全保留（spec §4.3 D10 两半：重建生效 + 保 doc/undo；
 * Task 8 评审 Important fix round 1：原 EditorState.create 整体重建路径丢失撤销历史，弃用）。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension, StateEffect } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { languageFor } from './language';

export interface EditorHandlers {
  /**
   * 文档变更回报（含 IME composition 期间——spec §4 已知边界）；第二参为本次更新后的库新
   * EditorState（Task 4 签名演进：Workspace 据此同步 TabSessions 会话态，A.1-9 整体替换）
   */
  readonly onDocChanged: (text: string, state: EditorState) => void;
  /** 滚动回报（会话级滚动记忆，spec §3） */
  readonly onScroll: (scrollTop: number) => void;
}

/** 编辑器外观参数（M5 Task 8）：语法主题解析结果 + 根节点字号（px 整数） */
export interface EditorAppearance {
  /** 界面主题解析结果（themeResolver 产物）：dark 注入 one-dark，light 照旧默认高亮 */
  readonly theme: 'light' | 'dark';
  /** 编辑器字号（px 整数，作用于 CM 根节点 font-size，spec §4.3 D10） */
  readonly fontSize: number;
}

/** 会话 state 构造入参（宪法 A.7-1 参数对象化）：内容三元组 + 外观参数 */
export interface EditorStateSpec {
  /** 初始文档（纯文本） */
  readonly doc: string;
  /** 语言选择用 MIME 类型（目录节点无 MIME，调用侧以 text/plain 兜底） */
  readonly mimeType: string;
  /** 变更/滚动回报回调（监听闭包在 state 内固化 nodeId） */
  readonly handlers: EditorHandlers;
  /** 外观参数（主题 + 字号）——显式必填，防止新建会话外观静默回退出厂默认 */
  readonly appearance: EditorAppearance;
}

/**
 * 外观 compartment（模块级单例）：所有会话 state 同构持有同一 compartment 实例，主题/字号
 * 变更经 reconfigure effect 在既有 state 内重配该片段——doc/undo/光标/滚动全保留。单例成立
 * 依据：每个 state 恰含一个外观 compartment 且语义同构（重配 effect 对任意会话视图等价）。
 */
const appearanceCompartment = new Compartment();

/** 外观相关扩展集：语法主题二选一（dark → one-dark 含语法高亮与环境色一体；light → 照旧
 * defaultHighlightStyle）+ 根节点字号动态主题——整体由 appearanceCompartment 承载 */
function appearanceExtension(appearance: EditorAppearance): Extension {
  return [
    appearance.theme === 'dark' ? oneDark : syntaxHighlighting(defaultHighlightStyle),
    EditorView.theme({ '&': { fontSize: `${appearance.fontSize}px` } }),
  ];
}

/** 生成外观重配 effect：由持有外观 compartment 的视图 dispatch（EditorPanel 外观 effect 消费） */
export function appearanceReconfigureEffect(appearance: EditorAppearance): StateEffect<unknown> {
  return appearanceCompartment.reconfigure(appearanceExtension(appearance));
}

/** 编辑器扩展集：行号/撤销/自绘选区/自动缩进/括号匹配/高亮/查找替换 + 键位（默认+撤销+查找+Tab 缩进） */
export function editorExtensions(
  mimeType: string,
  handlers: EditorHandlers,
  appearance: EditorAppearance,
): Extension[] {
  const language = languageFor(mimeType);
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    // 外观片段（语法主题二选一 + 字号）经 compartment 承载：主题/字号变更经 reconfigure
    // effect 同 state 重配生效（doc/undo 全保留），不经 state 整体重建
    appearanceCompartment.of(appearanceExtension(appearance)),
    search(),
    ...(language === null ? [] : [language]),
    // 可访问标签挂 contentDOM（contenteditable 文本录入元素本体）——M3 textarea
    // aria-label="编辑区" 的 CM 对应物（preview.spec getByLabel('编辑区')+fill 断言面；
    // 宿主 div 不可编辑，挂载层标签会使 fill 拒绝操作）
    EditorView.contentAttributes.of({ 'aria-label': '编辑区' }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.onDocChanged(update.state.doc.toString(), update.state);
    }),
    EditorView.domEventHandlers({
      // scroll 事件不冒泡，CM6 经 scrollTargets 监听统一路由到本回调（runHandlers("scroll")）
      scroll: (_event, view) => {
        handlers.onScroll(view.scrollDOM.scrollTop);
        return false; // 不吃事件，默认滚动行为照常
      },
    }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
  ];
}

/** 会话 state 构造（换文档新建状态不复用——宪法 A.1-9；监听闭包在 state 内固化） */
export function createEditorState(spec: EditorStateSpec): EditorState {
  return EditorState.create({
    doc: spec.doc,
    extensions: editorExtensions(spec.mimeType, spec.handlers, spec.appearance),
  });
}
