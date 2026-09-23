// @vitest-environment jsdom
// TreePanel 冒烟（宪法 A.6-2）：渲染结构、回调触发。M7 树体验批次：工具栏「新建文件」
// 升级为「导入 HTML 文件」，目录新建改行内命名（CreateDirRow），chevron/FolderOpen 展开
// 指示落地。树交互修复批次（②④⑤）：合成根行隐藏（根子级顶层直出 + 根层命名行回归顶层
// + nav data-ready 装配信号锚 + rootPath 路径小字位）、目录点选=选中+展开切换、折叠真正
// 收起子级（expanded 集驱动）。EditorPanel 冒烟自 M4 Task 3 起移步
// tests/unit/renderer/editor-panel.test.tsx。
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
  it('渲染展开节点名、file 点选触发 onSelect、工具栏导入钮触发 onImportHtml（M7 锚点）', () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [makeTreeRoot(meta(2, 'a.html'))]),
    ];
    const onSelect = vi.fn();
    const onImportHtml = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={new Set()}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={null}
          rootPath={null}

          onToggle={vi.fn()}
          onSelect={onSelect}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={vi.fn()}
          onCancelCreateDir={vi.fn()}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={onImportHtml}
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
    // 工具栏 M7 起为「导入 HTML 文件」图标钮（原「新建文件」语义升级），aria-label 锚点寻址
    const importBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="导入 HTML 文件"]',
    );
    expect(importBtn).not.toBeNull();
    act(() => {
      importBtn?.click();
    });
    expect(onImportHtml).toHaveBeenCalledTimes(1);
  });

  it('目录行点选触发 onToggle；chevron 展开态旋转类（rotate-90）随展开集切换（M7 折叠可见化）', () => {
    // 笔记须 loaded（chevron 旋转/FolderOpen 判定 = expanded 命中且子级已装载，懒加载语义）
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [
        withChildren(makeTreeRoot(meta(2, '笔记', 'dir')), [makeTreeRoot(meta(5, 'b.html'))]),
      ]),
    ];
    const onToggle = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={new Set()}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={null}
          rootPath={null}

          onToggle={onToggle}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={vi.fn()}
          onCancelCreateDir={vi.fn()}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    const dirBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '笔记',
    );
    expect(dirBtn).toBeDefined();
    // 折叠态：chevron 无旋转类；点选目录行走 onToggle（非 pick 模式）
    const chevron = dirBtn?.querySelector('svg');
    expect(chevron?.classList.contains('rotate-90')).toBe(false);
    act(() => {
      dirBtn?.click();
    });
    expect(onToggle).toHaveBeenCalledWith(2);
    // 展开态重渲染：chevron 带 rotate-90 旋转类（transform 过渡动画的类锚点）
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={new Set([2])}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={null}
          rootPath={null}

          onToggle={onToggle}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={vi.fn()}
          onCancelCreateDir={vi.fn()}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    expect(dirBtn?.querySelector('svg')?.classList.contains('rotate-90')).toBe(true);
  });

  it('行内新建目录：creatingDirParentId 命中即渲染命名行，Enter 上抛确认、Esc 上抛取消（M7）', () => {
    // 命名行渲染于目标父已装载的子级首位（Workspace 进入时保证父 loaded）
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [
        withChildren(makeTreeRoot(meta(2, '笔记', 'dir')), [makeTreeRoot(meta(5, 'b.html'))]),
      ]),
    ];
    const onConfirmCreateDir = vi.fn();
    const onCancelCreateDir = vi.fn();
    const tree = createRoot(container);
    // ⑤语义：命名行渲染于目标父子级首位需父在展开集（⑤折叠藏子级落地后，loaded 不再恒
    // 可见）——expanded 含目标父 id=2（Workspace startCreateDir 进入时保证）
    const expanded = new Set([2]);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={expanded}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={2}
          rootPath={null}

          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={onConfirmCreateDir}
          onCancelCreateDir={onCancelCreateDir}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    // 命名行渲染于目标父（笔记）子级首位，预填默认名
    const row = container.querySelector<HTMLElement>('li.lt-create-row');
    expect(row).not.toBeNull();
    const input = row?.querySelector<HTMLInputElement>('input[aria-label="新目录名称"]');
    expect(input?.value).toBe('新建目录');
    // Enter：非空名上抛确认（目标父 id + 输入名）；空名 Enter 视同取消
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onConfirmCreateDir).toHaveBeenCalledWith(2, '新建目录');
    expect(onCancelCreateDir).not.toHaveBeenCalled();
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onCancelCreateDir).toHaveBeenCalledTimes(1);
    // 未命中父不渲染命名行（展开目标父下无 creating 目标时不出现第二行）
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={expanded}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={null}
          rootPath={null}

          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={onConfirmCreateDir}
          onCancelCreateDir={onCancelCreateDir}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('li.lt-create-row')).toBeNull();
  });

  it('行内命名收口（用户实测反馈）：失焦提交非空草稿、空草稿失焦取消，行内不自留编辑态', async () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [
        withChildren(makeTreeRoot(meta(2, '笔记', 'dir')), [makeTreeRoot(meta(5, 'b.html'))]),
      ]),
    ];
    const onConfirmCreateDir = vi.fn();
    const onCancelCreateDir = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={new Set([2])}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={2}
          rootPath={null}
          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={onConfirmCreateDir}
          onCancelCreateDir={onCancelCreateDir}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    const input = (): HTMLInputElement | null =>
      container.querySelector<HTMLInputElement>('input[aria-label="新目录名称"]');
    /** 以原型 setter 注入草稿（React 受控输入的唯一可靠 jsdom 写入路径，同 search-panel 用例） */
    const typeName = (text: string): void => {
      act(() => {
        const el = input();
        if (el === null) throw new Error('无命名输入框');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    /** 失焦（jsdom 对未聚焦元素 blur() 为空操作，故先聚焦再失焦——真实点击外部的等价事件序） */
    const blurRow = async (): Promise<void> => {
      await act(async () => {
        input()?.focus();
        input()?.blur();
      });
    };

    // ①失焦即提交：草稿未改动（默认名）同样以该名建目录——Windows 资源管理器同语义
    await blurRow();
    expect(onConfirmCreateDir).toHaveBeenCalledWith(2, '新建目录');
    expect(onCancelCreateDir).not.toHaveBeenCalled();

    // ②空草稿失焦 = 取消（不留无名目录），不上抛提交
    onConfirmCreateDir.mockClear();
    typeName('   ');
    await blurRow();
    expect(onConfirmCreateDir).not.toHaveBeenCalled();
    expect(onCancelCreateDir).toHaveBeenCalledTimes(1);

    // ③提交后草稿再变更（用户改名重试路径）：非空草稿照旧上抛，行内不自作收口——
    //   行内态的收口（成功/失败均关闭）归 Workspace，组件只负责解析草稿语义
    typeName('重名目录');
    await blurRow();
    expect(onConfirmCreateDir).toHaveBeenCalledWith(2, '重名目录');
  });

  // —— 树交互修复批次（②④⑤）——

  it('②隐藏合成根行：根子级顶层直出、无「根」行；nav data-ready 随 roots 空/非空切换（装配信号锚）', () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [makeTreeRoot(meta(2, 'a.html'))]),
    ];
    const tree = createRoot(container);
    const renderPanel = (panelRoots: readonly TreeNode[]): void => {
      act(() => {
        tree.render(
          <TreePanel
            roots={panelRoots}
            selectedId={null}
            expanded={new Set()}
            dirPickMode={false}
            pickTargetId={null}
            creatingDirParentId={null}
            rootPath={null}
            onToggle={vi.fn()}
            onSelect={vi.fn()}
            onStartCreateDir={vi.fn()}
            onConfirmCreateDir={vi.fn()}
            onCancelCreateDir={vi.fn()}
            onTrash={vi.fn()}
            onRename={vi.fn()}
            onStartMove={vi.fn()}
            onImportHtml={vi.fn()}
          />,
        );
      });
    };
    // 首拉前空树：data-ready 缺省（装配未完成）
    renderPanel([]);
    expect(container.querySelector('nav')?.getAttribute('data-ready')).toBeNull();
    // 首拉应用（空库也有合成根）：data-ready="true" = Workspace mount 首拉已完成（E2E 等待锚）
    renderPanel(roots);
    expect(container.querySelector('nav')?.getAttribute('data-ready')).toBe('true');
    // 合成根行不再渲染，根子级直接顶层呈现（用户数据目录即默认根）
    const rowNames = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(rowNames).not.toContain('根');
    expect(rowNames).toContain('a.html');
  });

  it('②根层命名行回归顶层：creatingDirParentId=根 id 时顶层首位渲染命名行，确认回传根目标', () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [makeTreeRoot(meta(2, 'a.html'))]),
    ];
    const onConfirmCreateDir = vi.fn();
    const tree = createRoot(container);
    act(() => {
      tree.render(
        <TreePanel
          roots={roots}
          selectedId={null}
          expanded={new Set()}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={1}
          rootPath={null}
          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={onConfirmCreateDir}
          onCancelCreateDir={vi.fn()}
          onTrash={vi.fn()}
          onRename={vi.fn()}
          onStartMove={vi.fn()}
          onImportHtml={vi.fn()}
        />,
      );
    });
    // 根行已隐藏，命名行渲染于顶层列表首位（Enter 确认目标父=根 id）
    const row = container.querySelector<HTMLElement>('li.lt-create-row');
    expect(row).not.toBeNull();
    const input = row?.querySelector<HTMLInputElement>('input[aria-label="新目录名称"]');
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onConfirmCreateDir).toHaveBeenCalledWith(1, '新建目录');
  });

  it('②rootPath 非空渲染 lt-tree-root-path 路径小字，null 不渲染', () => {
    const roots = [withChildren(makeTreeRoot(meta(1, '根', 'dir')), [])];
    const tree = createRoot(container);
    const renderPanel = (rootPath: string | null): void => {
      act(() => {
        tree.render(
          <TreePanel
            roots={roots}
            selectedId={null}
            expanded={new Set()}
            dirPickMode={false}
            pickTargetId={null}
            creatingDirParentId={null}
            rootPath={rootPath}
            onToggle={vi.fn()}
            onSelect={vi.fn()}
            onStartCreateDir={vi.fn()}
            onConfirmCreateDir={vi.fn()}
            onCancelCreateDir={vi.fn()}
            onTrash={vi.fn()}
            onRename={vi.fn()}
            onStartMove={vi.fn()}
            onImportHtml={vi.fn()}
          />,
        );
      });
    };
    renderPanel('D:/lt-user-data/LearningText');
    expect(container.querySelector('.lt-tree-root-path')?.textContent).toBe(
      'D:/lt-user-data/LearningText',
    );
    renderPanel(null);
    expect(container.querySelector('.lt-tree-root-path')).toBeNull();
  });

  it('⑤折叠目录隐藏子级、再展开恢复（expanded 集驱动；折叠仅藏渲染，数据保留）', () => {
    // 根子级「笔记」已装载（含 b.html）：顶层经②直出，b.html 可见性由展开集驱动
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [
        withChildren(makeTreeRoot(meta(2, '笔记', 'dir')), [makeTreeRoot(meta(5, 'b.html'))]),
      ]),
    ];
    const tree = createRoot(container);
    const renderPanel = (panelExpanded: ReadonlySet<number>): void => {
      act(() => {
        tree.render(
          <TreePanel
            roots={roots}
            selectedId={null}
            expanded={panelExpanded}
            dirPickMode={false}
            pickTargetId={null}
            creatingDirParentId={null}
            rootPath={null}
            onToggle={vi.fn()}
            onSelect={vi.fn()}
            onStartCreateDir={vi.fn()}
            onConfirmCreateDir={vi.fn()}
            onCancelCreateDir={vi.fn()}
            onTrash={vi.fn()}
            onRename={vi.fn()}
            onStartMove={vi.fn()}
            onImportHtml={vi.fn()}
          />,
        );
      });
    };
    const rowNames = (): string[] =>
      Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    // 折叠态：目录行可见、子级隐藏（修复「装载即恒可见」存量缺陷）
    renderPanel(new Set());
    expect(rowNames()).toContain('笔记');
    expect(rowNames()).not.toContain('b.html');
    // 展开态：子级恢复可见
    renderPanel(new Set([2]));
    expect(rowNames()).toContain('b.html');
    // 再折叠：子级再次隐藏（loaded 保持，仅渲染隐藏）
    renderPanel(new Set());
    expect(rowNames()).not.toContain('b.html');
  });

  it('④常规模式目录点选=选中+展开切换（同时上抛 onSelect 与 onToggle）；dirPickMode 下仍仅 onSelect（目标记账回归锁定）', () => {
    const roots = [
      withChildren(makeTreeRoot(meta(1, '根', 'dir')), [makeTreeRoot(meta(2, '笔记', 'dir'))]),
    ];
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const tree = createRoot(container);
    const renderPanel = (pickMode: boolean): void => {
      act(() => {
        tree.render(
          <TreePanel
            roots={roots}
            selectedId={null}
            expanded={new Set()}
            dirPickMode={pickMode}
            pickTargetId={null}
            creatingDirParentId={null}
            rootPath={null}
            onToggle={onToggle}
            onSelect={onSelect}
            onStartCreateDir={vi.fn()}
            onConfirmCreateDir={vi.fn()}
            onCancelCreateDir={vi.fn()}
            onTrash={vi.fn()}
            onRename={vi.fn()}
            onStartMove={vi.fn()}
            onImportHtml={vi.fn()}
          />,
        );
      });
    };
    // 常规模式：dir 点选同时上抛两回调（VS Code 点选=选中+展开/折叠）
    renderPanel(false);
    const dirBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '笔记',
    );
    expect(dirBtn).toBeDefined();
    act(() => {
      dirBtn?.click();
    });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(onToggle).toHaveBeenCalledWith(2);
    // dirPickMode（move/导入共用）：dir 点选仍仅记账目标，不触发展开切换（回归锁定）
    onSelect.mockClear();
    onToggle.mockClear();
    renderPanel(true);
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent === '笔记')
        ?.click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
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
          expanded={new Set()}
          dirPickMode={false}
          pickTargetId={null}
          creatingDirParentId={null}
          rootPath={null}

          onToggle={vi.fn()}
          onSelect={vi.fn()}
          onStartCreateDir={vi.fn()}
          onConfirmCreateDir={vi.fn()}
          onCancelCreateDir={vi.fn()}
          onTrash={onTrash}
          onRename={onRename}
          onStartMove={onStartMove}
          onImportHtml={vi.fn()}
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
