/**
 * 标签条（M4 spec §3）：纯呈现——文件名 + dirty 状态文本 + 关闭钮；激活态 aria-current；
 * key 用稳定业务 id（宪法 A.7-6）。关闭钮与激活钮为兄弟节点（互不嵌套），点击互不影响，
 * 不存在冒泡误触发激活的通路
 */
import type { TabState } from './tabModel';

export interface TabBarProps {
  readonly tabs: readonly TabState[];
  readonly activeId: number | null;
  onActivate(id: number): void;
  onClose(id: number): void;
}

export function TabBar({ tabs, activeId, onActivate, onClose }: TabBarProps): React.JSX.Element {
  return (
    // 标签条（chrome 档 12px）：激活态 aria-current → 底色回正文面（页签融底语义），文字转正色
    <div
      className="lt-tabbar flex items-end gap-1 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
      role="tablist"
      aria-label="打开的文件"
    >
      {tabs.map((tab) => (
        <div key={tab.meta.id} className="lt-tab flex items-center gap-1" role="presentation">
          <button
            type="button"
            role="tab"
            aria-current={tab.meta.id === activeId ? 'true' : undefined}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground aria-current:bg-background aria-current:font-medium aria-current:text-foreground"
            onClick={() => onActivate(tab.meta.id)}
          >
            {tab.meta.name}
            {tab.dirty ? (
              <span className="text-[10px] text-destructive" aria-label="未保存">
                未保存
              </span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={`关闭标签 ${tab.meta.name}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
            onClick={() => onClose(tab.meta.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
