// @vitest-environment jsdom
// Tree/Editor 冒烟（宪法 A.6-2）：渲染结构、回调触发、去抖时序（fake timers）、订阅 cleanup 无此项（本任务不订阅）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { TreePanel } from '../../../src/renderer/src/features/tree/TreePanel';
import { EditorPanel } from '../../../src/renderer/src/features/editor/EditorPanel';
import { makeTreeRoot, withChildren } from '../../../src/renderer/src/features/tree/treeModel';

function meta(id: number, name: string, type: 'dir' | 'file' = 'file'): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: type,
    name,
    virtualPath: `/${name}`,
    // 契约适配：目录 mimeType 为 null（vfs-contract NodeMeta 注释），文件给 text/html
    mimeType: type === 'dir' ? null : 'text/html',
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TreePanel', () => {
  it('渲染展开节点名、file 点选触发 onSelect、工具栏新建走选中父', () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [makeTreeRoot(meta(2, 'a.html'))]),
    ];
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          onToggle={vi.fn()}
          onSelect={onSelect}
          onCreate={onCreate}
          onTrash={vi.fn()}
        />,
      );
    });
    const buttons = Array.from(container.querySelectorAll('button'));
    const fileBtn = buttons.find((b) => b.textContent === 'a.html');
    expect(fileBtn).toBeDefined();
    act(() => {
      fileBtn?.click();
    });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    const newBtn = buttons.find((b) => b.textContent === '新建文件');
    act(() => {
      newBtn?.click();
    });
    expect(onCreate).toHaveBeenCalledWith(1, 'file'); // 根（dir）展开即当前父上下文——未选中 dir 时按根
  });
});

describe('EditorPanel', () => {
  it('切换节点 readFile→textarea 值；输入去抖 writeFile 于 debounceMs 后一次', async () => {
    vi.useFakeTimers();
    const content = new Uint8Array(Buffer.from('<p>初</p>', 'utf8'));
    const readFile = vi.fn(() =>
      Promise.resolve({ ok: true, value: { content, meta: meta(2, 'a.html') } }),
    );
    const writeFile = vi.fn(() => Promise.resolve({ ok: true, value: meta(2, 'a.html') }));
    vi.stubGlobal('window', { ...globalThis.window, api: { readFile, writeFile } });
    const tree = createRoot(container);
    act(() => {
      tree.render(<EditorPanel node={meta(2, 'a.html')} debounceMs={200} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('<p>初</p>');
    typeSetter(area, '<p>改</p>');
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(writeFile).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 2 }));
    tree.unmount();
  });
});

/** textarea 受控输入驱动（React 19 + jsdom：原型 setter 绕过受控锁 + input 事件冒泡） */
function typeSetter(area: HTMLTextAreaElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(area, next);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
