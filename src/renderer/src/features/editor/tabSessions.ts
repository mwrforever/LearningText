/**
 * 标签编辑器会话（M4 spec §3）：per-tab EditorState（doc/undo/光标随 state 天然保留）
 * + 滚动位置——切换标签经 EditorView.setState 换入换出（宪法 A.1-9），不重建 view。
 * 无 React 依赖（Workspace useRef 持有）；state 字段为「库新建实例整体替换」非原地改。
 */
import type { EditorState } from '@codemirror/state';

export interface TabSession {
  readonly nodeId: number;
  state: EditorState;
  scrollTop: number;
}

export class TabSessions {
  private map = new Map<number, TabSession>();

  open(nodeId: number, state: EditorState, scrollTop = 0): TabSession {
    const session: TabSession = { nodeId, state, scrollTop };
    this.map.set(nodeId, session);
    return session;
  }

  has(nodeId: number): boolean {
    return this.map.has(nodeId);
  }

  get(nodeId: number): TabSession | undefined {
    return this.map.get(nodeId);
  }

  /** updateListener 回路：库以新实例整体替换 state（禁原地改，A.1-9） */
  updateState(nodeId: number, state: EditorState): void {
    const session = this.map.get(nodeId);
    if (session !== undefined) session.state = state;
  }

  updateScroll(nodeId: number, scrollTop: number): void {
    const session = this.map.get(nodeId);
    if (session !== undefined) session.scrollTop = scrollTop;
  }

  close(nodeId: number): void {
    this.map.delete(nodeId);
  }
}
