/**
 * 自绘标题栏（M6 spec §2.2，FR-SHELL-01/02 修订版）：整条为窗口拖拽区（lt-drag），
 * 承载应用标识与应用内菜单（菜单树与 main/menu.ts 命令一一对应——同经 shell:command
 * 语义分发，渲染层直接调 Workspace 的命令处理器；加速器由保留的 application menu 承载，
 * 菜单内快捷键仅为视觉提示）。mac 平台不渲染应用内菜单（系统菜单栏承载，spec 裁决），
 * 窗口控制钮由 titleBarOverlay（win/linux）/系统红绿灯（mac）原生提供，本组件不绘制。
 * 「退出」不走 forceClose（会绕过脏关窗 guard）——经 window.close() 触发原生 close 事件
 * 走既有 confirm-close 确认链。
 */
import { BookOpenText } from 'lucide-react';
import type { ShellCommand } from '../../../../shared/shell-contract';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '@components/ui/menubar';

export interface TitleBarProps {
  /** 运行平台（window.api.platform）：'darwin' 不渲染应用内菜单（系统菜单栏承载） */
  readonly platform: string;
  /** 命令分发出口（Workspace 命令处理器：与原生菜单/快捷键同一收口） */
  onCommand(command: ShellCommand): void;
}

export function TitleBar({ platform, onCommand }: TitleBarProps): React.JSX.Element {
  return (
    // 标题栏整条 drag；交互子元素经 lt-no-drag 豁免（menubar 容器与右侧留白区）
    <header className="lt-titlebar lt-drag flex h-10 shrink-0 items-center gap-1 border-b border-border bg-muted pl-3 select-none">
      {/* 应用标识：h1 保留（E2E app.spec 锚点语义不变，视觉收敛为 13px 标题档；
          字重 medium 对齐蓝图 §2.1「13px medium」——标题栏是恒驻 chrome，semibold 过重
          会与菜单标签争层级） */}
      <div className="flex items-center gap-2">
        <BookOpenText aria-hidden="true" className="size-4 text-primary" />
        <h1 className="m-0 text-[13px] leading-none font-medium tracking-wide text-foreground">
          LearningText
        </h1>
      </div>
      {/* 应用内菜单（win/linux）：mac 系统菜单栏承载同名命令，避免双入口 */}
      {platform !== 'darwin' ? (
        <nav aria-label="应用菜单" className="lt-no-drag ml-2">
          <Menubar className="h-8">
            <MenubarMenu>
              {/* 触发钮消费侧覆写：font-normal 卸掉模板 font-medium（12px medium 恒驻
                  chrome 偏重，VS Code 菜单栏同为常规字重）；transition-colors 对齐全站
                  hover/focus 100ms 过渡纪律（模板无过渡，显隐状态瞬跳） */}
              <MenubarTrigger className="text-xs font-normal transition-colors duration-100">
                文件
              </MenubarTrigger>
              {/* 面板动效对齐蓝图基线 100ms（模板默认 150ms；duration-* 经
                  --tw-duration 传入 tw-animate-css，reduced-motion 全局降级覆盖） */}
              <MenubarContent className="duration-100">
                <MenubarItem onClick={() => onCommand({ type: 'new-file' })}>
                  新建文件
                  <MenubarShortcut>Ctrl+N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'new-dir' })}>
                  新建目录
                  <MenubarShortcut>Ctrl+Shift+N</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'save' })}>
                  保存
                  <MenubarShortcut>Ctrl+S</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => onCommand({ type: 'import' })}>导入…</MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'export' })}>导出…</MenubarItem>
                <MenubarSeparator />
                <MenubarItem onClick={() => onCommand({ type: 'open-settings' })}>
                  设置…
                  <MenubarShortcut>Ctrl+,</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
                {/* 退出经 window.close() 走原生 close 拦截链（脏态确认后再真退出） */}
                <MenubarItem onSelect={() => window.close()}>退出</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-normal transition-colors duration-100">
                搜索
              </MenubarTrigger>
              <MenubarContent className="duration-100">
                <MenubarItem onClick={() => onCommand({ type: 'quick-open' })}>
                  快速打开
                  <MenubarShortcut>Ctrl+P</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'global-search' })}>
                  全局搜索
                  <MenubarShortcut>Ctrl+Shift+F</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className="text-xs font-normal transition-colors duration-100">
                导入导出
              </MenubarTrigger>
              <MenubarContent className="duration-100">
                <MenubarItem onClick={() => onCommand({ type: 'import' })}>导入…</MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'export' })}>导出…</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </nav>
      ) : null}
      {/* 右侧留白占满 overlay 控制钮区之外的空间（保持整条可拖拽） */}
      <div className="lt-no-drag ml-auto self-stretch w-24" aria-hidden="true" />
    </header>
  );
}
