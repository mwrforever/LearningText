// 会话容器单测（M4 spec §3）：open/get/has/updateState/updateScroll/close 契约——
// state 以「库新建实例整体替换」语义回写（宪法 A.1-9），容器本身只做键值管理，无 React 依赖
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { createEditorState } from '../../../src/renderer/src/features/editor/codemirror';
import type { EditorAppearance } from '../../../src/renderer/src/features/editor/codemirror';
import { TabSessions } from '../../../src/renderer/src/features/editor/tabSessions';

/** 出厂默认外观（M5 Task 8 createEditorState 契约：appearance 显式必填） */
const APPEARANCE: EditorAppearance = { theme: 'light', fontSize: 14 };

/** 生成最小会话 state（不挂真实回调——容器单测只关心 state 引用与字段替换） */
function state(doc: string): EditorState {
  return createEditorState({
    doc,
    mimeType: 'text/plain',
    handlers: { onDocChanged: () => {}, onScroll: () => {} },
    appearance: APPEARANCE,
  });
}

describe('TabSessions', () => {
  it('open 后 has/get 可取且 scrollTop 缺省为 0；open 同 id 覆盖旧会话', () => {
    const sessions = new TabSessions();
    const first = sessions.open(2, state(''));
    expect(sessions.has(2)).toBe(true);
    expect(sessions.get(2)).toBe(first);
    expect(first.scrollTop).toBe(0);
    // 同 id 重复 open：整体覆盖（任务栏重开同文件的兜底语义，键为 nodeId 唯一）
    const second = sessions.open(2, state('覆盖'), 120);
    expect(sessions.get(2)).toBe(second);
    expect(second.scrollTop).toBe(120);
  });

  it('updateState/updateScroll 以新值整体替换对应字段', () => {
    const sessions = new TabSessions();
    sessions.open(2, state(''));
    const next = state('甲');
    sessions.updateState(2, next);
    sessions.updateScroll(2, 88);
    const session = sessions.get(2);
    expect(session?.state).toBe(next);
    expect(session?.scrollTop).toBe(88);
  });

  it('updateState/updateScroll 对未开会话为 no-op（换入竞态兜底，不抛错不建会话）', () => {
    const sessions = new TabSessions();
    expect(sessions.has(9)).toBe(false);
    sessions.updateState(9, state('孤儿'));
    sessions.updateScroll(9, 66);
    expect(sessions.has(9)).toBe(false);
  });

  it('close 后 has=false、get=undefined；close 未开会话亦 no-op', () => {
    const sessions = new TabSessions();
    sessions.open(2, state(''));
    sessions.close(2);
    expect(sessions.has(2)).toBe(false);
    expect(sessions.get(2)).toBeUndefined();
    sessions.close(404); // 未开会话再关一次，容器保持稳定
    expect(sessions.has(404)).toBe(false);
  });
});
