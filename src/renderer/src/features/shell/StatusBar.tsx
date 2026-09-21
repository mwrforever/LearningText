/**
 * 状态栏（M6 spec §2.6，FR-SHELL-01 修订版）：左＝保存态（脏点文案）+ 文档总数；右＝
 * 主题三态循环切换钮 + 设置入口。纯呈现，全部数据经 props 注入；图标钮一律
 * aria-label + title tooltip（可访问性红线）。
 */
import { Monitor, Moon, Settings, Sun } from 'lucide-react';
import type { ThemeIntent } from '../settings/themeResolver';

export interface StatusBarProps {
  /** 是否存在未保存更改（任一 doc 标签 dirty） */
  readonly dirty: boolean;
  /** 文档总数（vfs:count 汇总；null = 尚未装载，不渲染计数段） */
  readonly docCount: number | null;
  /** 主题意图（持久化显示值） */
  readonly theme: ThemeIntent;
  /** 主题三态循环切换回调（light → dark → system → light，顺序归 Workspace） */
  onCycleTheme(): void;
  /** 打开设置标签页 */
  onOpenSettings(): void;
}

/** 主题意图 → 图标与中文名（tooltip 文案） */
function themeMeta(intent: ThemeIntent): { icon: typeof Sun; label: string } {
  if (intent === 'light') return { icon: Sun, label: '亮色' };
  if (intent === 'dark') return { icon: Moon, label: '暗色' };
  return { icon: Monitor, label: '跟随系统' };
}

export function StatusBar({
  dirty,
  docCount,
  theme,
  onCycleTheme,
  onOpenSettings,
}: StatusBarProps): React.JSX.Element {
  const meta = themeMeta(theme);
  const ThemeIcon = meta.icon;
  return (
    <footer className="lt-statusbar flex h-6 shrink-0 items-center gap-2 border-t border-border bg-muted px-3 text-xs text-muted-foreground">
      {dirty ? (
        <span className="flex items-center gap-1.5" role="status">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
          有未保存更改
        </span>
      ) : (
        <span>已保存</span>
      )}
      {docCount !== null ? <span className="tabular-nums">· {docCount} 个文档</span> : null}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label={`切换主题（当前：${meta.label}）`}
          title={`主题：${meta.label}（点击切换）`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={onCycleTheme}
        >
          <ThemeIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="打开设置"
          title="设置"
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </footer>
  );
}
