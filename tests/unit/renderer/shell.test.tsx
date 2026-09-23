// @vitest-environment jsdom
// M6 壳层新组件冒烟（宪法 A.6-2）：StatusBar（保存态两态文案/文档计数/主题循环/设置入口）、
// ActivityBar（三视图 aria-current 互斥/设置入口）、TitleBar（h1 应用标识 + 应用内菜单命令
// 分发 + mac 不渲染菜单）、WelcomePage（主操作回调/最近打开回调/空态）。
// 断言以 role/aria 语义为主；radix menubar 沿 dropdown-menu 键盘驱动先例（触发器 Enter 开启
// → 菜单项 Enter 激活），菜单 portal 内容查询走 document。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeIntent } from '../../../src/renderer/src/features/settings/themeResolver';
import { ActivityBar } from '../../../src/renderer/src/features/shell/ActivityBar';
import { StatusBar } from '../../../src/renderer/src/features/shell/StatusBar';
import { TitleBar } from '../../../src/renderer/src/features/shell/TitleBar';
import { WelcomePage } from '../../../src/renderer/src/features/shell/WelcomePage';
import type { UpdateState } from '../../../src/shared/update-contract';
import type { ShellCommand } from '../../../src/shared/shell-contract';

let container: HTMLElement;
let tree: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  tree = createRoot(container);
});

afterEach(() => {
  act(() => {
    tree.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
});

describe('StatusBar 状态栏', () => {
  it('脏态呈现「有未保存更改」、净态呈现「已保存」；docCount 未装载时不渲染计数段', () => {
    act(() => {
      tree.render(
        <StatusBar
          dirty
          docCount={null}
          theme="light"
          onCycleTheme={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain('有未保存更改');
    expect(container.textContent).not.toContain('已保存');
    expect(container.textContent).not.toContain('个文档');
    act(() => {
      tree.render(
        <StatusBar
          dirty={false}
          docCount={7}
          theme="light"
          onCycleTheme={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain('已保存');
    expect(container.textContent).toContain('7 个文档');
  });

  it('主题切换钮携带当前意图可访问名并触发 onCycleTheme；齿轮钮触发 onOpenSettings', () => {
    const onCycleTheme = vi.fn();
    const onOpenSettings = vi.fn();
    const themeIntents: ThemeIntent[] = ['light', 'dark', 'system'];
    for (const intent of themeIntents) {
      act(() => {
        tree.render(
          <StatusBar
            dirty={false}
            docCount={null}
            theme={intent}
            onCycleTheme={onCycleTheme}
            onOpenSettings={onOpenSettings}
          />,
        );
      });
      expect(
        container.querySelector<HTMLButtonElement>(
          `button[aria-label="切换主题（当前：${
            intent === 'light' ? '亮色' : intent === 'dark' ? '暗色' : '跟随系统'
          }）"]`,
        ),
      ).not.toBeNull();
    }
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="切换主题"]')?.click();
    });
    expect(onCycleTheme).toHaveBeenCalledTimes(1);
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="打开设置"]')?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ActivityBar 活动栏', () => {
  it('三视图按钮 aria-current 随激活互斥迁移；点击回调 onViewChange 携带目标视图', () => {
    const onViewChange = vi.fn();
    const views = ['tree', 'search', 'trash'] as const;
    for (const active of views) {
      act(() => {
        tree.render(
          <ActivityBar
            view={active}
            settingsActive={false}
            onViewChange={onViewChange}
            onOpenSettings={vi.fn()}
          />,
        );
      });
      for (const view of views) {
        expect(
          container
            .querySelector<HTMLButtonElement>(
              `button[aria-label="${
                view === 'tree' ? '资源树' : view === 'search' ? '全局搜索' : '回收站'
              }"]`,
            )
            ?.getAttribute('aria-current'),
        ).toBe(view === active ? 'true' : null);
      }
    }
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="全局搜索"]')?.click();
    });
    expect(onViewChange).toHaveBeenCalledWith('search');
  });

  it('底部设置钮 aria-pressed 随设置激活态切换并触发 onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    act(() => {
      tree.render(
        <ActivityBar
          view="tree"
          settingsActive={false}
          onViewChange={vi.fn()}
          onOpenSettings={onOpenSettings}
        />,
      );
    });
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="设置"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
    act(() => {
      tree.render(
        <ActivityBar
          view="tree"
          settingsActive
          onViewChange={vi.fn()}
          onOpenSettings={onOpenSettings}
        />,
      );
    });
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="设置"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="设置"]')?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

describe('TitleBar 自绘标题栏', () => {
  it('渲染 h1 应用标识（E2E 锚点）；win/linux 渲染应用内菜单', () => {
    act(() => {
      tree.render(
        <TitleBar
          platform="win32"
          update={null}
          onCommand={vi.fn()}
          onUpdateDownload={vi.fn()}
          onUpdateInstall={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('h1')?.textContent).toBe('LearningText');
    expect(container.querySelector('nav[aria-label="应用菜单"]')).not.toBeNull();
    expect(container.textContent).toContain('文件');
  });

  it('darwin 平台不渲染应用内菜单（系统菜单栏承载），h1 保留', () => {
    act(() => {
      tree.render(
        <TitleBar
          platform="darwin"
          update={null}
          onCommand={vi.fn()}
          onUpdateDownload={vi.fn()}
          onUpdateInstall={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('h1')?.textContent).toBe('LearningText');
    expect(container.querySelector('nav[aria-label="应用菜单"]')).toBeNull();
  });

  it('菜单项命令经 onCommand 分发（radix menubar 键盘驱动：触发器 Enter 开启 → 菜单项 Enter）', () => {
    const onCommand = vi.fn<(command: ShellCommand) => void>();
    act(() => {
      tree.render(
        <TitleBar
          platform="win32"
          update={null}
          onCommand={onCommand}
          onUpdateDownload={vi.fn()}
          onUpdateInstall={vi.fn()}
        />,
      );
    });
    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-slot="menubar-trigger"]'),
    ).find((el) => el.textContent === '文件');
    if (!trigger) throw new Error('无「文件」菜单触发器');
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // 菜单项文本含快捷键提示（如「保存 Ctrl+S」），以 startsWith 匹配业务名
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent?.startsWith('保存'),
    );
    if (!item) throw new Error('菜单无「保存」项');
    act(() => {
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onCommand).toHaveBeenCalledWith({ type: 'save' });
  });
});

describe('WelcomePage 欢迎页', () => {
  it('空态呈现 lt-welcome-empty 占位与主操作三钮；回调按钮各自触发', () => {
    const onImportHtml = vi.fn();
    const onImport = vi.fn();
    const onQuickOpen = vi.fn();
    const onOpenRecent = vi.fn();
    act(() => {
      tree.render(
        <WelcomePage
          recent={[]}
          onOpenRecent={onOpenRecent}
          onImportHtml={onImportHtml}
          onImport={onImport}
          onQuickOpen={onQuickOpen}
        />,
      );
    });
    expect(container.querySelector('.lt-welcome-empty')?.textContent).toContain('暂无最近打开');
    // 「快速打开」钮内嵌快捷键徽标（Ctrl+P），以 startsWith 匹配业务名
    for (const label of ['导入 HTML', '导入…', '快速打开']) {
      expect(
        Array.from(container.querySelectorAll('button')).some((b) =>
          b.textContent?.startsWith(label),
        ),
      ).toBe(true);
    }
    const clickButton = (label: string): void => {
      act(() => {
        Array.from(container.querySelectorAll('button'))
          .find((b) => b.textContent?.startsWith(label))
          ?.click();
      });
    };
    clickButton('导入 HTML');
    clickButton('导入…');
    clickButton('快速打开');
    expect(onImportHtml).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onQuickOpen).toHaveBeenCalledTimes(1);
    expect(onOpenRecent).not.toHaveBeenCalled();
  });

  it('最近打开条目按 nodeId 回调 onOpenRecent', () => {
    const onOpenRecent = vi.fn();
    act(() => {
      tree.render(
        <WelcomePage
          recent={[
            { nodeId: 7, name: 'todo.html', virtualPath: '/笔记/todo.html' },
            { nodeId: 3, name: 'a.html', virtualPath: '/a.html' },
          ]}
          onOpenRecent={onOpenRecent}
          onImportHtml={vi.fn()}
          onImport={vi.fn()}
          onQuickOpen={vi.fn()}
        />,
      );
    });
    expect(container.querySelector('.lt-welcome-empty')).toBeNull();
    expect(container.textContent).toContain('todo.html');
    expect(container.textContent).toContain('/笔记/todo.html');
    const row = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'todo.html/笔记/todo.html',
    );
    if (!row) throw new Error('无最近打开条目按钮');
    act(() => {
      row.click();
    });
    expect(onOpenRecent).toHaveBeenCalledWith(7);
  });
});

describe('TitleBar 更新标签（M9 FR-UPDATE-01，蓝图 §五.2）', () => {
  it('idle/up-to-date/checking/error/unsupported 不渲染标签（静默检查零存在感）；三态才渲染', () => {
    for (const state of [
      { kind: 'idle', currentVersion: '0.1.1' },
      { kind: 'checking', currentVersion: '0.1.1' },
      { kind: 'up-to-date', currentVersion: '0.1.1', checkedAt: '2026-09-24T00:00:00+08:00' },
      { kind: 'error', currentVersion: '0.1.1', message: 'x' },
      { kind: 'unsupported', currentVersion: '0.1.1', reason: 'dev' },
    ]) {
      act(() => {
        tree.render(
          <TitleBar
            platform="win32"
            update={state as UpdateState}
            onCommand={vi.fn()}
            onUpdateDownload={vi.fn()}
            onUpdateInstall={vi.fn()}
          />,
        );
      });
      expect(container.querySelector('.lt-update-chip')).toBeNull();
    }
  });

  it('available：实心主色标签「更新到 v0.2.0」，点击回调 onUpdateDownload', () => {
    const onDownload = vi.fn();
    act(() => {
      tree.render(
        <TitleBar
          platform="win32"
          update={{ kind: 'available', currentVersion: '0.1.1', version: '0.2.0' }}
          onCommand={vi.fn()}
          onUpdateDownload={onDownload}
          onUpdateInstall={vi.fn()}
        />,
      );
    });
    const chip = container.querySelector<HTMLButtonElement>('button.lt-update-chip');
    expect(chip?.textContent).toBe('更新到 v0.2.0');
    act(() => {
      chip?.click();
    });
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('downloading：中性 chip 为 role=progressbar 携 aria-valuenow（只给百分比文本）', () => {
    act(() => {
      tree.render(
        <TitleBar
          platform="win32"
          update={{ kind: 'downloading', currentVersion: '0.1.1', version: '0.2.0', percent: 42 }}
          onCommand={vi.fn()}
          onUpdateDownload={vi.fn()}
          onUpdateInstall={vi.fn()}
        />,
      );
    });
    const bar = container.querySelector<HTMLElement>('.lt-update-chip[role="progressbar"]');
    expect(bar?.textContent).toBe('下载中 42%');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
  });

  it('downloaded：标签换「重启以完成更新」，点击回调 onUpdateInstall', () => {
    const onInstall = vi.fn();
    act(() => {
      tree.render(
        <TitleBar
          platform="win32"
          update={{ kind: 'downloaded', currentVersion: '0.1.1', version: '0.2.0' }}
          onCommand={vi.fn()}
          onUpdateDownload={vi.fn()}
          onUpdateInstall={onInstall}
        />,
      );
    });
    const chip = container.querySelector<HTMLButtonElement>('button.lt-update-chip');
    expect(chip?.textContent).toBe('重启以完成更新');
    act(() => {
      chip?.click();
    });
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});
