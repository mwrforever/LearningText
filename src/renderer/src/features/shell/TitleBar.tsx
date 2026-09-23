/**
 * 自绘标题栏（M6 spec §2.2，FR-SHELL-01/02 修订版）：整条为窗口拖拽区（lt-drag），
 * 承载应用标识与应用内菜单（菜单树与 main/menu.ts 命令一一对应——同经 shell:command
 * 语义分发，渲染层直接调 Workspace 的命令处理器；加速器由保留的 application menu 承载，
 * 菜单内快捷键仅为视觉提示）。mac 平台不渲染应用内菜单（系统菜单栏承载，spec 裁决），
 * 窗口控制钮由 titleBarOverlay（win/linux）/系统红绿灯（mac）原生提供，本组件不绘制。
 * 「退出」不走 forceClose（会绕过脏关窗 guard）——经 window.close() 触发原生 close 事件
 * 走既有 confirm-close 确认链。
 * 更新标签（M9 批次 FR-UPDATE-01，蓝图 §五.2）：只在 available/downloading/downloaded
 * 三态存在（实心主色=有待办动作、中性=进行中）；静默检查在拿到新版本前零存在感。
 */
import { BookOpenText, Download, RefreshCw } from 'lucide-react';
import type { ShellCommand } from '../../../../shared/shell-contract';
import type { UpdateState } from '../../../../shared/update-contract';
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
  /** 更新状态（null = 尚未装载）：仅 available/downloading/downloaded 渲染标签 */
  readonly update: UpdateState | null;
  /** 命令分发出口（Workspace 命令处理器：与原生菜单/快捷键同一收口） */
  onCommand(command: ShellCommand): void;
  /** 下载已发现的新版本（available 态标签点击；进度经 update:state 广播驱动本标签） */
  onUpdateDownload(): void;
  /** 重启并安装已下载的新版本（downloaded 态标签点击；冲刷/确认链归 Workspace） */
  onUpdateInstall(): void;
}

export function TitleBar({
  platform,
  update,
  onCommand,
  onUpdateDownload,
  onUpdateInstall,
}: TitleBarProps): React.JSX.Element {
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
                <MenubarItem onClick={() => onCommand({ type: 'import-html' })}>
                  导入 HTML 文件…
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
                {/* 粘贴导入（M9）：Ctrl/Cmd+V 由 Workspace 在资源树视图内作用域监听（不在此
                    展示快捷键提示——键位非全局生效，展示会误导） */}
                <MenubarItem onClick={() => onCommand({ type: 'paste-import' })}>
                  粘贴导入
                </MenubarItem>
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
                <MenubarItem onClick={() => onCommand({ type: 'paste-import' })}>
                  粘贴导入
                </MenubarItem>
                <MenubarItem onClick={() => onCommand({ type: 'export' })}>导出…</MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </nav>
      ) : null}
      {/* 右侧组（M9 更新标签落位，蓝图 §五.2）：ml-auto 上移到组，无标签时几何与现状
          逐像素等价；留白占位承载窗口控制钮区（win/linux w-36=144px ≥ 系统三钮实测宽度，
          防标签右端压进最小化钮命中区；darwin 红绿灯由系统布局让位，保持 w-24）。
          标签容器单独一帧挂载（trio 三态间切换不重挂，入场 animate-in 只播一次） */}
      <div className="lt-no-drag ml-auto flex items-center gap-2 self-stretch">
        {update !== null &&
        (update.kind === 'available' ||
          update.kind === 'downloading' ||
          update.kind === 'downloaded') ? (
          <div className="flex items-center duration-240 ease-out animate-in fade-in">
            {update.kind === 'downloading' ? (
              // 下载中：中性 chip + role=progressbar（只给百分比文本，tabular-nums 不抖动；
              // 不做 aria-live——每 1% 播报是噪音，蓝图 §五.5）
              <span
                role="progressbar"
                aria-valuenow={update.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="lt-update-chip inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border px-2 text-xs text-foreground tabular-nums"
              >
                下载中 {update.percent}%
              </span>
            ) : (
              // 可用/待重启：实心主色（有待办动作），点击即对应动作（可访问名=可见文案）
              <button
                type="button"
                className="lt-update-chip inline-flex h-6 shrink-0 items-center gap-1 rounded-sm bg-primary px-2 text-xs text-primary-foreground transition-colors duration-100 hover:bg-primary/90 active:duration-0 active:bg-primary/80"
                title={
                  update.kind === 'available'
                    ? `下载新版本 v${update.version}`
                    : '重启应用以完成更新'
                }
                onClick={update.kind === 'available' ? onUpdateDownload : onUpdateInstall}
              >
                {update.kind === 'available' ? (
                  <Download aria-hidden="true" className="size-3.5" />
                ) : (
                  <RefreshCw aria-hidden="true" className="size-3.5" />
                )}
                {update.kind === 'available' ? `更新到 v${update.version}` : '重启以完成更新'}
              </button>
            )}
          </div>
        ) : null}
        <div
          className={`self-stretch ${platform !== 'darwin' ? 'w-36' : 'w-24'}`}
          aria-hidden="true"
        />
      </div>
    </header>
  );
}
