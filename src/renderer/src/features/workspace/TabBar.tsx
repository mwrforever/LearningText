/**
 * 标签条（M4 spec §3 → M6 spec §2.4 图标化重制）：文件类型图标 + 名称 + 脏态圆点 +
 * 关闭钮（hover 显形）；设置伪标签（settingsOpen 时恒在标签条末位，Settings 图标）。
 * 激活态 aria-current → 底色回正文面（页签融底语义）。key 用稳定业务 id（宪法 A.7-6）；
 * 关闭钮与激活钮为兄弟节点（互不嵌套），点击互不影响。图标钮一律 aria-label（可访问性红线）。
 */
import { FileCode, FileText, Settings, X } from 'lucide-react';
import type { ActiveTabId, TabState } from './tabModel';

export interface TabBarProps {
  readonly tabs: readonly TabState[];
  readonly activeId: ActiveTabId;
  /** 设置伪标签是否存在于标签条 */
  readonly settingsOpen: boolean;
  onActivate(id: number): void;
  onClose(id: number): void;
  onActivateSettings(): void;
  onCloseSettings(): void;
}

/** doc 标签类型图标（M6 spec §2.4 映射；媒体标签随批次②接入，此处仅文本两态） */
function tabIconFor(mimeType: string | null): typeof FileText {
  if (mimeType === 'text/html') return FileText;
  return FileCode;
}

/** doc 标签激活钮标准类串（aria-current 驱动激活态）：仅上圆角（rounded-t-sm）——激活签
 * bg-background 与画布同面融合（VS Code 页签语义），下缘直角与画布边界无缝，四角圆
 * 会在签底与画布交界处留出微缺口 */
const TAB_TRIGGER_CLASS =
  'flex items-center gap-1.5 whitespace-nowrap rounded-t-sm px-2 py-1 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground aria-current:bg-background aria-current:font-medium aria-current:text-foreground';

/** 标签关闭钮标准类串：命中面 ::after 外扩 4px（M5 打磨既有口径），hover 显形 */
const TAB_CLOSE_CLASS =
  "relative inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition duration-100 after:absolute after:-inset-1 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100 aria-current:opacity-100";

export function TabBar({
  tabs,
  activeId,
  settingsOpen,
  onActivate,
  onClose,
  onActivateSettings,
  onCloseSettings,
}: TabBarProps): React.JSX.Element {
  return (
    <div
      className="lt-tabbar flex items-end gap-1 overflow-x-auto border-b border-border bg-muted/50 px-1 pt-1"
      role="tablist"
      aria-label="打开的文件"
    >
      {tabs.map((tab) => {
        const Icon = tabIconFor(tab.meta.mimeType);
        return (
          <div
            key={tab.meta.id}
            className="lt-tab group/tab flex items-center gap-1"
            role="presentation"
          >
            <button
              type="button"
              role="tab"
              aria-current={tab.meta.id === activeId ? 'true' : undefined}
              className={TAB_TRIGGER_CLASS}
              onClick={() => onActivate(tab.meta.id)}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{tab.meta.name}</span>
              {/* 脏态小圆点（VS Code 语义，替代「未保存」文字；aria-label 保留可访问名） */}
              {tab.dirty ? (
                <span
                  aria-label="未保存"
                  title="未保存"
                  className="size-1.5 shrink-0 rounded-full bg-destructive"
                />
              ) : null}
            </button>
            <button
              type="button"
              aria-label={`关闭标签 ${tab.meta.name}`}
              title={`关闭 ${tab.meta.name}`}
              className={TAB_CLOSE_CLASS}
              onClick={() => onClose(tab.meta.id)}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </div>
        );
      })}
      {/* 设置伪标签（spec §2.4）：恒驻标签条末位，不占 MAX_TABS */}
      {settingsOpen ? (
        <div
          className="lt-tab lt-tab-settings group/tab flex items-center gap-1"
          role="presentation"
        >
          <button
            type="button"
            role="tab"
            aria-current={activeId === 'settings' ? 'true' : undefined}
            className={TAB_TRIGGER_CLASS}
            onClick={onActivateSettings}
          >
            <Settings aria-hidden="true" className="size-3.5 shrink-0" />
            设置
          </button>
          <button
            type="button"
            aria-label="关闭设置"
            title="关闭设置"
            className={TAB_CLOSE_CLASS}
            onClick={onCloseSettings}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
