/**
 * 欢迎页（M6 spec §2.5，FR-SHELL-01 修订版「首页」重构）：无激活标签时编辑画布区的
 * 空态呈现——产品定位一句话 + 主操作三钮 + 最近打开列表 + 快捷键提示。纯呈现组件，
 * 数据经 props 注入（最近打开取 settings.recent 前 10 条，Workspace 装配）。
 */
import { FileUp, FolderOpen, Search } from 'lucide-react';

/** 最近打开条目（欢迎页展示所需最小字段，由 Workspace 从 settings.recent 裁剪注入） */
export interface WelcomeRecentItem {
  readonly nodeId: number;
  readonly name: string;
  readonly virtualPath: string;
}

export interface WelcomePageProps {
  /** 最近打开条目（新→旧，≤10 条） */
  readonly recent: readonly WelcomeRecentItem[];
  onOpenRecent(nodeId: number): void;
  /** 导入 HTML 文件（M7，原「新建文件」语义升级；与菜单命令同链路） */
  onImportHtml(): void;
  /** 打开导入链路（目录选择 → 策略确认） */
  onImport(): void;
  /** 打开快速打开浮层 */
  onQuickOpen(): void;
}

/** 主操作钮标准类串：图标 + 文字的次级大钮（欢迎页专用，44px 级热区） */
const ACTION_BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

export function WelcomePage({
  recent,
  onOpenRecent,
  onImportHtml,
  onImport,
  onQuickOpen,
}: WelcomePageProps): React.JSX.Element {
  return (
    <section
      aria-label="欢迎"
      className="lt-welcome flex min-h-0 flex-1 items-center justify-center overflow-auto"
    >
      {/* 内容列 100ms fade 入场（蓝图动效基线「面板切换 fade 100ms」）：无标签空态的
          出现属状态切换反馈，opacity 单属性合成器路径，reduced-motion 全局降级覆盖 */}
      <div className="flex w-full max-w-md flex-col gap-6 px-6 py-10 duration-100 animate-in fade-in">
        <div>
          <h2 className="m-0 text-2xl font-semibold text-foreground">LearningText</h2>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            HTML 文档管理与实时预览 · 所见即所得
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ACTION_BUTTON_CLASS} onClick={onImportHtml}>
            <FileUp aria-hidden="true" className="size-4" />
            导入 HTML
          </button>
          <button type="button" className={ACTION_BUTTON_CLASS} onClick={onImport}>
            <FolderOpen aria-hidden="true" className="size-4" />
            导入…
          </button>
          <button type="button" className={ACTION_BUTTON_CLASS} onClick={onQuickOpen}>
            <Search aria-hidden="true" className="size-4" />
            快速打开
            <span className="ml-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums">
              Ctrl+P
            </span>
          </button>
        </div>
        <div>
          <p className="m-0 mb-1 text-sm font-medium text-foreground">最近打开</p>
          {recent.length === 0 ? (
            <p className="lt-welcome-empty m-0 text-xs text-muted-foreground">暂无最近打开的文档</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {recent.map((item) => (
                <li key={item.nodeId}>
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-100 hover:bg-accent"
                    onClick={() => onOpenRecent(item.nodeId)}
                  >
                    <span className="shrink-0 text-sm text-foreground">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.virtualPath}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          快捷键：<kbd className="font-sans">Ctrl+S</kbd> 保存 ·{' '}
          <kbd className="font-sans">Ctrl+P</kbd> 快速打开 ·{' '}
          <kbd className="font-sans">Ctrl+Shift+F</kbd> 全局搜索
        </p>
      </div>
    </section>
  );
}
