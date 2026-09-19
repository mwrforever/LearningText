/**
 * 标签条（M4 spec §3）：纯呈现——文件名 + dirty 状态文本 + 关闭钮；激活态 aria-current；
 * key 用稳定业务 id（宪法 A.7-6）。关闭钮点击需 stopPropagation 防冒泡触发激活。
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
    <div className="lt-tabbar" role="tablist" aria-label="打开的文件">
      {tabs.map((tab) => (
        <div key={tab.meta.id} className="lt-tab" role="presentation">
          <button
            type="button"
            role="tab"
            aria-current={tab.meta.id === activeId ? 'true' : undefined}
            onClick={() => onActivate(tab.meta.id)}
          >
            {tab.meta.name}
            {tab.dirty ? <span aria-label="未保存">未保存</span> : null}
          </button>
          <button
            type="button"
            aria-label={`关闭标签 ${tab.meta.name}`}
            onClick={() => onClose(tab.meta.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
