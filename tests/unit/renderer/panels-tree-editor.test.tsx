// @vitest-environment jsdom
// TreePanel 冒烟（宪法 A.6-2）：渲染结构、回调触发。EditorPanel 冒烟自 M4 Task 3 起移步
// tests/unit/renderer/editor-panel.test.tsx（CodeMirror 内核换芯后 props 面演进为会话式，
// 原 textarea 去抖时序用例随 M3 形态整体移除，去抖时序职责归 Task 5 saveController 单测）
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { TreePanel } from '../../../src/renderer/src/features/tree/TreePanel';
import {
  makeTreeRoot,
  withChildren,
  type TreeNode,
} from '../../../src/renderer/src/features/tree/treeModel';

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
  it('渲染展开节点名、file 点选触发 onSelect、工具栏新建走选中父（M6 图标钮锚点）', () => {
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
          moveMode={false}
          moveTargetId={null}
          onToggle={vi.fn()}
          onSelect={onSelect}
          onCreate={onCreate}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
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
    // 工具栏 M6 起为图标钮（无文本），统一以 aria-label 锚点寻址
    const newBtn = container.querySelector<HTMLButtonElement>('button[aria-label="新建文件"]');
    expect(newBtn).not.toBeNull();
    act(() => {
      newBtn?.click();
    });
    expect(onCreate).toHaveBeenCalledWith(1, 'file'); // 根（dir）展开即当前父上下文——未选中 dir 时按根
  });
});

// 行内「⋯」菜单（M5 批次④ Task 10）：dir/file 均有，重命名/移动/删除以节点 id 直传
// （脱离 selectedId 选中锚——目录不开标签也应可操作）。radix DropdownMenu 沿 search-panel
// 键盘驱动先例：触发器 Enter 开启 → 菜单项 Enter 激活；portal 内容查询走 document（容器外）
describe('TreePanel 行内「⋯」菜单（M5 批次④）', () => {
  /** 树装配：根(1) 展开含目录(2)与文件(3)——目录即被测的「不开标签节点」 */
  function menuRoots(): readonly TreeNode[] {
    return [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [
        makeTreeRoot(meta(2, '笔记', 'dir')),
        makeTreeRoot(meta(3, 'a.html')),
      ]),
    ];
  }

  /** 渲染树并返回三操作 spy（selectedId=null 刻意不带选中锚，证明操作不依赖它） */
  function renderTree(): {
    onRename: ReturnType<typeof vi.fn>;
    onStartMove: ReturnType<typeof vi.fn>;
    onTrash: ReturnType<typeof vi.fn>;
  } {
    const onRename = vi.fn();
    const onStartMove = vi.fn();
    const onTrash = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={menuRoots()}
          selectedId={null}
          moveMode={false}
          moveTargetId={null}
          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onCreate={vi.fn()}
          onTrash={onTrash}
          onRename={onRename}
          onStartMove={onStartMove}
        />,
      );
    });
    return { onRename, onStartMove, onTrash };
  }

  /**
   * 键盘驱动打开行内菜单（radix 键盘先例：触发器 keydown Enter 开启，jsdom 无 pointer 语义）。
   * 触发器可访问名恒为「更多操作」（不含节点名——既有 E2E getByRole name 子串匹配锚点防
   * 串扰），行级定位走 data-node-id
   */
  function openRowMenu(nodeId: number): void {
    const trigger = container.querySelector<HTMLElement>(`button[data-node-id="${nodeId}"]`);
    if (!trigger) throw new Error(`无行内菜单触发器：data-node-id=${nodeId}`);
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  /** portal 菜单内容项集合（触发器在容器、菜单在 document——作用域分离防与工具栏同名误中） */
  function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  }

  /** 按文本激活菜单项（目标项自身 keydown Enter 承载，radix 语义不依赖焦点） */
  function pickMenuItem(label: string): void {
    const item = menuItems().find((el) => el.textContent === label);
    if (!item) {
      throw new Error(
        `菜单无项「${label}」（实际：${menuItems()
          .map((el) => el.textContent ?? '')
          .join('/')}）`,
      );
    }
    act(() => {
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  it('dir 行内菜单三操作可见，重命名/移动以 dir id 直传（无选中锚亦可操作）', () => {
    const { onRename, onStartMove } = renderTree();
    // 可访问名独占性（E2E 红线）：「更多操作」不含任何节点名，不与既有行钮 name 锚串扰
    expect(container.querySelector('button[data-node-id="2"]')?.getAttribute('aria-label')).toBe(
      '更多操作',
    );
    openRowMenu(2);
    expect(menuItems().map((el) => el.textContent)).toEqual(['重命名', '移动到…', '删除']);
    pickMenuItem('重命名');
    expect(onRename).toHaveBeenCalledWith(2);
    // 选择模式钮：菜单随上一项激活已关闭，重新开启后驱动
    openRowMenu(2);
    pickMenuItem('移动到…');
    expect(onStartMove).toHaveBeenCalledWith(2);
  });

  it('file 行内删除直传节点 id；根节点不渲染行内菜单（根不可 rename/move/trash）', () => {
    const { onTrash } = renderTree();
    expect(container.querySelector('button[data-node-id="1"]')).toBeNull();
    openRowMenu(3);
    pickMenuItem('删除');
    expect(onTrash).toHaveBeenCalledWith(3);
  });
});
