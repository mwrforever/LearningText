// @vitest-environment jsdom
// CodeMirror 内核冒烟（宪法 A.6-2）：view 生命周期成对、输入回报 doc、会话切换保 doc/undo/光标、
// 二进制/空态占位。CM6 在 jsdom 无布局引擎：断言只碰 state/doc 层，不碰坐标类 API。
import { act } from 'react';
import { isolateHistory, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorState } from '../../../src/renderer/src/features/editor/codemirror';
import type { EditorAppearance } from '../../../src/renderer/src/features/editor/codemirror';
import { EditorPanel } from '../../../src/renderer/src/features/editor/EditorPanel';
import { TabSessions } from '../../../src/renderer/src/features/editor/tabSessions';
import type { NodeMeta } from '../../../src/shared/vfs-contract';

/** 出厂默认外观（M5 Task 8 createEditorState 契约：appearance 显式必填） */
const APPEARANCE: EditorAppearance = { theme: 'light', fontSize: 14 };

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
    sessions.open(
      2,
      createEditorState({
        doc: '<p>一</p>',
        mimeType: 'text/html',
        handlers: { onDocChanged: () => {}, onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.html'), dirty: false }}
          debounceMs={300}
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
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: (t) => onDocChanged(2, t), onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    sessions.open(
      3,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: (t) => onDocChanged(3, t), onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
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
        />,
      );
    });
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
        />,
      );
    });
    const content = container.querySelector('.cm-content');
    expect(content?.textContent).toBe('甲');
    // 光标随会话态保留：切回后 selection 恢复到 dispatch 时的 cursor(1)（评审 Minor-1）
    const viewBack = mountedView(container);
    expect(viewBack?.state.doc.toString()).toBe('甲');
    expect(viewBack?.state.selection.main.head).toBe(1);
    tree.unmount();
  });

  it('同 id 重渲染（dirty 翻转换新对象）不回灌陈旧会话态：未回写输入保留且不重复回报', () => {
    // setTabDirty/updateTabMeta 均以新对象替换同 id TabState——此时视图本就持有最新权威态，
    // 若无条件 setState 会以切签时陈旧态覆盖输入，并经 updateListener 以旧文本再触发回报
    // （评审 Important-1 回归：Task 5 SaveController.edit 将收到回退文本）
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: (t) => onDocChanged(t), onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
        />,
      );
    });
    const view = mountedView(container);
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: '甲' } });
    });
    expect(onDocChanged).toHaveBeenCalledTimes(1);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
        />,
      );
    });
    expect(container.querySelector('.cm-content')?.textContent).toBe('甲');
    expect(onDocChanged).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it('激活 → 无激活（占位）→ 再激活：视图销毁重建且未回写的编辑由 null 分支兜底回写', () => {
    // 关末签时 host 随占位分支卸载、视图 DOM 脱离文档不可复用——null 分支必须先回写会话
    // （state/scroll）再销毁，否则本用例的「乙」在重建后丢失（brief 示例此分支为空，落地补全）
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: (t) => onDocChanged(t), onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
        />,
      );
    });
    // 首激活下编辑「乙」：切签前会话态尚未回写，最新 doc 只在视图内（取视图同上：findFromDOM 裁决）
    const view = mountedView(container);
    act(() => {
      view?.dispatch({ changes: { from: 0, insert: '乙' } });
    });
    act(() => {
      tree.render(<EditorPanel sessions={sessions} activeTab={null} debounceMs={300} />);
    });
    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(container.textContent).toContain('未选中文件');
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
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
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: () => {}, onScroll: () => {} },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: true }}
          debounceMs={300}
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
    sessions.open(
      2,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: () => {}, onScroll },
        appearance: APPEARANCE,
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
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
  it('字号/主题 props 变化 → 外观 compartment 同 state 重配：doc/光标实例保留、不误报变更', () => {
    // M5 Task 8（评审 Important fix round 1）：外观变更经 compartment reconfigure 在既有
    // state 内重配——doc Text 实例同一（非 EditorState 重建）、光标保留、不触发 docChanged
    //（不误入保存管线）；重配事务产生新 state 实例（A.1-9 transaction 语义）
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    sessions.open(
      2,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: (t) => onDocChanged(t), onScroll: () => {} },
        appearance: { theme: 'light', fontSize: 14 },
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          theme="light"
          editorFontSize={14}
        />,
      );
    });
    const view = mountedView(container);
    if (!view) throw new Error('视图未挂载');
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '丙' }, selection: EditorSelection.cursor(1) });
    });
    const before = view.state;
    const beforeDoc = view.state.doc;
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          theme="dark"
          editorFontSize={20}
        />,
      );
    });
    const after = mountedView(container);
    expect(after).not.toBeNull();
    expect(after?.state.doc).toBe(beforeDoc); // doc 实例同一——同 state 重配，非重建
    expect(after?.state.doc.toString()).toBe('丙'); // 内容保留
    expect(after?.state.selection.main.head).toBe(1); // 光标保留
    expect(after?.state).not.toBe(before); // 重配经 transaction 产生新 state 实例（A.1-9）
    expect(onDocChanged).toHaveBeenCalledTimes(1); // 重配不重复回报（不误触发保存管线）
    tree.unmount();
  });

  it('恢复式打开：空态期外观变更已记账、会话持陈旧外观构造时，建视图分支仍对齐外观（终审回归）', () => {
    // M5 终审 Important：Workspace 恢复链以 mount 闭包的旧外观构造会话 state，且空态期
    // （activeTab=null）的外观 props 变化只记账不重配——首签创建视图走「无需对齐」分支，
    // 整会话停留陈旧外观。修复后创建分支无条件派发 reconfigure（等值时为 no-op 幂等）。
    // 断言口径：oneDark 携 {dark:true} 主题 → EditorView.darkTheme facet 反映 compartment
    // 实际生效的主题；陈旧会话（light）+ 当前 props（dark）→ 挂载后 facet 必须翻转。
    const sessions = new TabSessions();
    const onDocChanged = vi.fn();
    // 会话 state 按陈旧外观（light/14）构造——模拟恢复链 mount 闭包的旧值
    sessions.open(
      5,
      createEditorState({
        doc: '<p>恢复</p>',
        mimeType: 'text/html',
        handlers: { onDocChanged: (t) => onDocChanged(t), onScroll: () => {} },
        appearance: { theme: 'light', fontSize: 14 },
      }),
    );
    const tree = createRoot(container);
    // 空态挂载：当前外观 props 已是 dark/20（记账进 lastAppearanceRef，无视图可重配）
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={null}
          debounceMs={300}
          theme="dark"
          editorFontSize={20}
        />,
      );
    });
    // 恢复的单标签激活：会话先前以 light/14 构造，appearanceChanged 恒 false
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(5, 'restored.html'), dirty: false }}
          debounceMs={300}
          theme="dark"
          editorFontSize={20}
        />,
      );
    });
    const view = mountedView(container);
    expect(view).not.toBeNull();
    // 外观对齐：compartment 实际生效主题为 dark（陈旧 light 被创建分支重配覆盖）
    expect(view?.state.facet(EditorView.darkTheme)).toBe(true);
    // 对齐不触碰文档：内容保留、不误报变更（不误触发保存管线）
    expect(view?.state.doc.toString()).toBe('<p>恢复</p>');
    expect(onDocChanged).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('外观变更后撤销栈保留：可 undo 回变更前文档（history 面断言，评审 Important 配套背书）', () => {
    // spec §4.3 D10「保 doc/undo」两半的历史面验证：主题+字号双变更（compartment 重配）
    // 之后，撤销深度无损——变更后新输入仍可一路 undo 越过外观变更点回到变更前文档
    const sessions = new TabSessions();
    sessions.open(
      2,
      createEditorState({
        doc: '',
        mimeType: 'text/plain',
        handlers: { onDocChanged: () => {}, onScroll: () => {} },
        appearance: { theme: 'light', fontSize: 14 },
      }),
    );
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          theme="light"
          editorFontSize={14}
        />,
      );
    });
    const view = mountedView(container);
    if (!view) throw new Error('视图未挂载');
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '甲' } }); // 变更前进撤销栈
    });
    act(() => {
      tree.render(
        <EditorPanel
          sessions={sessions}
          activeTab={{ meta: meta(2, 'a.txt'), dirty: false }}
          debounceMs={300}
          theme="dark"
          editorFontSize={20}
        />,
      );
    });
    act(() => {
      view.dispatch({
        changes: { from: 1, insert: '乙' }, // 外观变更后继续输入（尾插，doc=甲乙）
        annotations: isolateHistory.of('full'), // 独立撤销组：与变更前输入不合并，断言粒度锁定
      });
    });
    expect(view.state.doc.toString()).toBe('甲乙');
    act(() => {
      // CM6 命令习语：undo({ state, dispatch })——撤销栈未被外观变更清空
      expect(undo({ state: view.state, dispatch: view.dispatch })).toBe(true);
    });
    expect(view.state.doc.toString()).toBe('甲'); // 越过外观变更点回到变更前文档
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
