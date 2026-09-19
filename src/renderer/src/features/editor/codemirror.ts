/**
 * CodeMirror 6 扩展工厂（宪法 A.1-9 / 调研 A7-10 习语）：curated 扩展集（M4 spec 裁决 D6，
 * 不引元包 basicSetup——autocompletion/closeBrackets/foldGutter 未要求）；扩展工厂函数形态，
 * 静态扩展依赖去重；监听类扩展随会话 state 闭包固定 nodeId（每会话一份，无共享可变态）。
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
import type { Extension } from '@codemirror/state';
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

/** 编辑器扩展集：行号/撤销/自绘选区/自动缩进/括号匹配/高亮/查找替换 + 键位（默认+撤销+查找+Tab 缩进） */
export function editorExtensions(mimeType: string, handlers: EditorHandlers): Extension[] {
  const language = languageFor(mimeType);
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle),
    search(),
    ...(language === null ? [] : [language]),
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
export function createEditorState(
  doc: string,
  mimeType: string,
  handlers: EditorHandlers,
): EditorState {
  return EditorState.create({ doc, extensions: editorExtensions(mimeType, handlers) });
}
