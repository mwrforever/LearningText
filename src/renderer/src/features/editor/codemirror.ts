/**
 * CodeMirror 6 扩展工厂（宪法 A.1-9 / 调研 A7-10 习语）：curated 扩展集（M4 spec 裁决 D6，
 * 不引元包 basicSetup——autocompletion/closeBrackets/foldGutter 未要求）；扩展工厂函数形态，
 * 静态扩展依赖去重；监听类扩展随会话 state 闭包固定 nodeId（每会话一份，无共享可变态）。
 * M5 批次③ Task 8：工厂增外观参数（语法主题 dark → one-dark / light → defaultHighlightStyle
 * 二选一 + 根节点字号），主题/字号变更随 view 重建生效（spec §4.3 D10）。
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import type { EditorSelection, Extension, Text } from '@codemirror/state';
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

/** 会话 state 构造入参（宪法 A.7-1 参数对象化）：内容三元组 + 外观参数 + 可选初始光标 */
export interface EditorStateSpec {
  /** 初始文档：纯文本或既有 Text 实例（外观重建路径直传会话态 doc，避免字符串往返） */
  readonly doc: string | Text;
  /** 语言选择用 MIME 类型（目录节点无 MIME，调用侧以 text/plain 兜底） */
  readonly mimeType: string;
  /** 变更/滚动回报回调（监听闭包在 state 内固化 nodeId） */
  readonly handlers: EditorHandlers;
  /** 外观参数（主题 + 字号）——显式必填，防止重建路径漏传导致外观静默回退 */
  readonly appearance: EditorAppearance;
  /** 初始光标选区（外观重建路径透传会话态光标；缺省为文档起点） */
  readonly selection?: EditorSelection;
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
    // 语法主题二选一（spec §4.3 D10）：dark → one-dark（语法高亮 + 背景/光标/选区等环境色
    // 一体承载）；light → 照旧 defaultHighlightStyle（跟随语义 token 的浅色环境）
    ...(appearance.theme === 'dark' ? [oneDark] : [syntaxHighlighting(defaultHighlightStyle)]),
    // 字号动态扩展：作用于 CM 根节点，字号变更随 view 重建生效（与主题同机制，一次重建覆盖两者）
    EditorView.theme({ '&': { fontSize: `${appearance.fontSize}px` } }),
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
    selection: spec.selection,
    extensions: editorExtensions(spec.mimeType, spec.handlers, spec.appearance),
  });
}
