/**
 * 活动栏（M6 spec §2.3，FR-SHELL-01 修订版）：VS Code 式图标竖条——资源树/搜索/回收站
 * 三视图互斥切换 + 底部设置入口（设置 = 打开编辑区设置标签页，非视图切换）。
 * 选中态 = 左侧 2px 指示条 + 前景正色；图标钮一律 aria-label + title tooltip（可访问性红线）。
 */
import { Files, Search, Settings, Trash2 } from 'lucide-react';
import type { TreePaneView } from '../tree/TreePanel';
import { ACTIVITY_BUTTON } from '../ui/classStrings';

export interface ActivityBarProps {
  /** 当前活动视图（Workspace 持久化态 activityView 回灌） */
  readonly view: TreePaneView;
  /** 设置标签页是否处于激活态（底部齿轮高亮判定） */
  readonly settingsActive: boolean;
  /** 视图切换入口（持久化归 Workspace） */
  onViewChange(view: TreePaneView): void;
  /** 打开设置标签页 */
  onOpenSettings(): void;
}

export function ActivityBar({
  view,
  settingsActive,
  onViewChange,
  onOpenSettings,
}: ActivityBarProps): React.JSX.Element {
  return (
    <nav
      aria-label="活动栏"
      className="lt-activity-bar flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted py-2"
    >
      <button
        type="button"
        aria-label="资源树"
        title="资源树"
        aria-current={view === 'tree' ? 'true' : undefined}
        className={ACTIVITY_BUTTON}
        onClick={() => onViewChange('tree')}
      >
        {view === 'tree' ? (
          // 指示条 100ms fade-in（opacity 单属性，reduced-motion 全局降级覆盖）：
          // 视图切换指示条瞬现缺乏状态反馈，与蓝图「面板切换 fade 100ms」同族微动效
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground duration-100 animate-in fade-in ease-out"
          />
        ) : null}
        <Files className="size-5" />
      </button>
      <button
        type="button"
        aria-label="全局搜索"
        title="全局搜索"
        aria-current={view === 'search' ? 'true' : undefined}
        className={ACTIVITY_BUTTON}
        onClick={() => onViewChange('search')}
      >
        {view === 'search' ? (
          // 指示条 100ms fade-in（同资源树钮：状态反馈微动效）
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground duration-100 animate-in fade-in ease-out"
          />
        ) : null}
        <Search className="size-5" />
      </button>
      <button
        type="button"
        aria-label="回收站"
        title="回收站"
        aria-current={view === 'trash' ? 'true' : undefined}
        className={ACTIVITY_BUTTON}
        onClick={() => onViewChange('trash')}
      >
        {view === 'trash' ? (
          // 指示条 100ms fade-in（同资源树钮：状态反馈微动效）
          <span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground duration-100 animate-in fade-in ease-out"
          />
        ) : null}
        <Trash2 className="size-5" />
      </button>
      {/* 底部设置入口：与视图切换不同语义（打开编辑区设置标签页），aria-pressed 表达激活 */}
      <button
        type="button"
        aria-label="设置"
        title="设置"
        aria-pressed={settingsActive}
        className={`${ACTIVITY_BUTTON} mt-auto aria-pressed:text-foreground`}
        onClick={onOpenSettings}
      >
        <Settings className="size-5" />
      </button>
    </nav>
  );
}
