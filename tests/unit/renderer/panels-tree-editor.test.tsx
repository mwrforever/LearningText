// @vitest-environment jsdom
// TreePanel 冒烟（宪法 A.6-2）：渲染结构、回调触发。EditorPanel 冒烟自 M4 Task 3 起移步
// tests/unit/renderer/editor-panel.test.tsx（CodeMirror 内核换芯后 props 面演进为会话式，
// 原 textarea 去抖时序用例随 M3 形态整体移除，去抖时序职责归 Task 5 saveController 单测）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { TreePanel } from '../../../src/renderer/src/features/tree/TreePanel';
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
