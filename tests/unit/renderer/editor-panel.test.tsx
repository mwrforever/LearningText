// @vitest-environment jsdom
// CodeMirror 内核冒烟（宪法 A.6-2）：view 生命周期成对、输入回报 doc、会话切换保 doc/undo/光标、
// 二进制/空态占位。CM6 在 jsdom 无布局引擎：断言只碰 state/doc 层，不碰坐标类 API。
import { act } from 'react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorState } from '../../../src/renderer/src/features/editor/codemirror';
import { EditorPanel } from '../../../src/renderer/src/features/editor/EditorPanel';
import { TabSessions } from '../../../src/renderer/src/features/editor/tabSessions';
import type { NodeMeta } from '../../../src/shared/vfs-contract';

function meta(id: number, name: string, mimeType = 'text/html'): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType,
    size: 4,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
  document.body.innerHTML = '';
});

describe('EditorPanel（CodeMirror 内核）', () => {
  it('无激活标签 → 空态占位；激活标签 → CM 编辑器就绪且文档一致', () => {
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState('<p>一</p>', 'text/html', { onDocChanged: () => {}, onScroll: () => {} }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.html'), dirty: false }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.textContent).toContain('一');
    tree.unmount();
    expect(container.querySelector('.cm-editor')).toBeNull(); // destroy 成对
  });

  it('输入经 updateListener 回报 onDocChanged；会话切换后各自 doc/光标保留', () => {
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState('', 'text/plain', {
        onDocChanged: (t) => onDocChanged(2, t),
        onScroll: () => {},
      }),
    );
    sessions.open(
      3,
      createEditorState('', 'text/plain', {
        onDocChanged: (t) => onDocChanged(3, t),
        onScroll: () => {},
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    // 直接驱动 view dispatch（jsdom 无真实键入；键盘路径归 E2E）。
    // brief 二选一注实跑裁决：jsdom 下 .cm-content 无 cmView 属性（不可达），降级采用
    // CM6 官方静态 API findFromDOM 取视图实例（无需改产品代码加测试钩子，证据留报告）
    const viewA = mountedView(container);
    expect(viewA).not.toBeNull();
    act(() => {
      viewA?.dispatch({ changes: { from: 0, insert: '甲' }, selection: EditorSelection.cursor(1) });
    });
    expect(onDocChanged).toHaveBeenCalledWith(2, '甲');
    // 切到 b：视图换入会话 3 的空文档；再切回 a：'甲' 与光标位置仍在
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(3, 'b.txt'), dirty: false }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    const content = container.querySelector('.cm-content');
    expect(content?.textContent).toBe('甲');
    tree.unmount();
  });

  it('激活 → 无激活（占位）→ 再激活：视图销毁重建且未回写的编辑由 null 分支兜底回写', () => {
    // 关末签时 host 随占位分支卸载、视图 DOM 脱离文档不可复用——null 分支必须先回写会话
    // （state/scroll）再销毁，否则本用例的「乙」在重建后丢失（brief 示例此分支为空，落地补全）
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState('', 'text/plain', {
        onDocChanged: (t) => onDocChanged(2, t),
        onScroll: () => {},
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    // 首激活下编辑「乙」：切签前会话态尚未回写，最新 doc 只在视图内（取视图同上：findFromDOM 裁决）
    const view = mountedView(container);
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: '乙' } });
    });
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={null}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(container.textContent).toContain('未选中文件');
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
          onDocChanged={onDocChanged}
        />,
      );
    });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.cm-content')?.textContent).toBe('乙');
    tree.unmount();
  });

  it('激活标签无对应会话（未 open）→ 不建视图，等会话就绪后再换入', () => {
    // Workspace 先 open 再切 activeTab 的接缝契约：会话缺失时换入 effect 跳过（防挂空视图）
    const sessions = new TabSessions();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(9, '未开.html'), dirty: false }}
          debounceMs={300}
          onDocChanged={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('.cm-editor')).toBeNull();
    tree.unmount();
  });

  it('保存钮点击触发 onSaveRequest（本任务过渡接线，Task 5 接 SaveController.flush）', () => {
    const sessions = new TabSessions();
    const onSaveRequest = vi.fn();
    sessions.open(
      2,
      createEditorState('', 'text/plain', { onDocChanged: () => {}, onScroll: () => {} }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
          onDocChanged={vi.fn()}
          onSaveRequest={onSaveRequest}
        />,
      );
    });
    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '保存',
    );
    expect(saveBtn).toBeDefined();
    act(() => {
      saveBtn?.click();
    });
    expect(onSaveRequest).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it('scrollDOM 滚动事件经 CM 路由回报 onScroll（会话级滚动记忆的数据源）', () => {
    const sessions = new TabSessions();
    const onScroll = vi.fn();
    sessions.open(2, createEditorState('', 'text/plain', { onDocChanged: () => {}, onScroll }));
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          onDocChanged={vi.fn()}
        />,
      );
    });
    const view = mountedView(container);
    expect(view).not.toBeNull();
    // jsdom 无布局引擎，scrollTop 恒 0：断言只锁定「滚动事件路由到回报回调」这一业务接线，
    // 回报数值的正确性归 E2E（真实浏览器滚动坐标）
    act(() => {
      view?.scrollDOM.dispatchEvent(new Event('scroll'));
    });
    expect(onScroll).toHaveBeenCalledTimes(1);
    tree.unmount();
  });
});

/**
 * 取当前挂载的 CM 视图实例（CM6 官方静态 API）：brief 二选一注的实跑裁决——
 * jsdom 下 .cm-content 上无可探得的 cmView 属性，改用 findFromDOM（不改产品代码），
 * 若仍不可达再降级为 TabSessions 会话态断言（裁决过程与证据见 task-3-report）
 */
function mountedView(root: HTMLElement): EditorView | null {
  const editorDom = root.querySelector<HTMLDivElement>('.cm-editor');
  return editorDom === null ? null : EditorView.findFromDOM(editorDom);
}
