/**
 * 设置页（M5 批次③ Task 8，spec §4.2 D9）：全屏覆盖视图（fixed inset-0，z-40 低于 toast/
 * 浮层卡片的 z-50——保存失败 toast 保持可见），非模态非路由——由 Workspace 以 settingsOpen
 * 挂载/卸载，工作台状态原样保持。左侧分组导航（外观/编辑器启用，备份/维护占位 disabled 归
 * Task 9 填充）+ 右侧表单区；表单即改即存：控件受控于 Workspace 提升的设置态，变更经钳制
 * 纯函数后上抛回调（写链 get→merge→set 与失败 toast 回滚由 Workspace 收口，本组件零持久化
 * 副作用）。顶部「← 返回」为唯一关闭通道（D9：Esc 不关闭，防误触）。
 */
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { clampAutoSave, clampDebounce, clampFontSize } from './settingsFormModel';
import type { ThemeIntent } from './themeResolver';

export interface SettingsPageProps {
  /** 主题意图显示值（Workspace 持久化态回灌；保存失败回滚后随 props 还原） */
  readonly theme: ThemeIntent;
  /** 编辑器字号显示值（12–24 整数，px） */
  readonly editorFontSize: number;
  /** 预览去抖显示值（100–2000 ms 整数） */
  readonly debounceMs: number;
  /** 自动保存间隔显示值（1000–60000 ms 整数） */
  readonly autoSaveMs: number;
  /** 主题意图变更回调（合法枚举值；持久化与失败回滚归 Workspace） */
  readonly onThemeChange: (theme: ThemeIntent) => void;
  /** 字号变更回调（入参已经 clampFontSize 钳制到 12–24 整数） */
  readonly onFontSizeChange: (fontSize: number) => void;
  /** 去抖变更回调（入参已经 clampDebounce 钳制到 100–2000 整数） */
  readonly onDebounceChange: (debounceMs: number) => void;
  /** 自动保存变更回调（入参已经 clampAutoSave 钳制到 1000–60000 整数） */
  readonly onAutoSaveChange: (autoSaveMs: number) => void;
  /** 返回工作台（覆盖层唯一关闭通道） */
  readonly onBack: () => void;
}

/** 表单分区：本任务实装外观/编辑器两区；备份/维护归 Task 9，导航占位 disabled */
type SettingsSection = 'appearance' | 'editor';

/** 导航项标准类串（树节点行同款形态：整行可点 + aria-current 高亮，设计系统文档 §7.2） */
const NAV_ITEM_CLASS =
  'block w-full truncate rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground';

/** 滑块行标准类串：原生 range（jsdom/真实浏览器同语义）+ 值回显，accent 走语义主色 */
const RANGE_CLASS = 'h-1 w-48 accent-primary';

export function SettingsPage({
  theme,
  editorFontSize,
  debounceMs,
  autoSaveMs,
  onThemeChange,
  onFontSizeChange,
  onDebounceChange,
  onAutoSaveChange,
  onBack,
}: SettingsPageProps): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('appearance');
  return (
    // 全屏覆盖层（spec §4.2 D9）：z-40 低于 toast/浮层的 z-50；lt-* 保留为测试锚点
    <section
      aria-label="设置"
      className="lt-settings fixed inset-0 z-40 flex flex-col bg-background"
    >
      {/* 顶栏：显式返回（D9 裁决 Esc 不关闭）+ 面标题 */}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          aria-label="返回工作台"
          className="inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
          onClick={onBack}
        >
          ← 返回
        </button>
        <span className="text-xs font-medium text-muted-foreground">设置</span>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* 左侧分组导航：备份/维护占位 disabled（Task 9 填充后启用） */}
        <nav aria-label="设置导航" className="w-28 shrink-0 border-r border-border p-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <li>
              <button
                type="button"
                className={NAV_ITEM_CLASS}
                aria-current={section === 'appearance'}
                onClick={() => setSection('appearance')}
              >
                外观
              </button>
            </li>
            <li>
              <button
                type="button"
                className={NAV_ITEM_CLASS}
                aria-current={section === 'editor'}
                onClick={() => setSection('editor')}
              >
                编辑器
              </button>
            </li>
            <li>
              {/* 备份/维护归 Task 9（spec §4.2）：本任务仅占位，禁点击防空表单 */}
              <button type="button" className={NAV_ITEM_CLASS} disabled>
                备份
              </button>
            </li>
            <li>
              <button type="button" className={NAV_ITEM_CLASS} disabled>
                维护
              </button>
            </li>
          </ul>
        </nav>
        {/* 右侧表单区：即改即存（受控值 + 钳制后回调上抛） */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {section === 'appearance' ? (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">主题</p>
                <Select
                  value={theme}
                  onValueChange={(value) => {
                    // 运行时收窄替代 as 断言（A.1-5）：SelectItem 值域即 ThemeIntent 全集
                    if (value === 'light' || value === 'dark' || value === 'system') {
                      onThemeChange(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="主题" className="w-32 rounded-sm text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="light" className="text-xs">
                      亮色
                    </SelectItem>
                    <SelectItem value="dark" className="text-xs">
                      暗色
                    </SelectItem>
                    <SelectItem value="system" className="text-xs">
                      跟随系统
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="m-0 mb-1 text-sm font-medium">编辑器字号</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={12}
                    max={24}
                    step={1}
                    value={editorFontSize}
                    aria-label="编辑器字号"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      // 越界原始值经钳制纯函数收口后再上抛（写入值恒过契约 schema）
                      onFontSizeChange(clampFontSize(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{editorFontSize}px</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">预览去抖</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={100}
                    value={debounceMs}
                    aria-label="预览去抖"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      onDebounceChange(clampDebounce(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{debounceMs}ms</span>
                </div>
              </div>
              <div>
                <p className="m-0 mb-1 text-sm font-medium">自动保存间隔</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1000}
                    max={60000}
                    step={1000}
                    value={autoSaveMs}
                    aria-label="自动保存间隔"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      onAutoSaveChange(clampAutoSave(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{autoSaveMs}ms</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
