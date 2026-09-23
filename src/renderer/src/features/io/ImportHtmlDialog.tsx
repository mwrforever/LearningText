/**
 * HTML 文件导入确认浮层（M7，FR-IO-01 文件形态）：非模态视口居中卡片（RenameDialog
 * 同形态语言，无遮罩——浮层打开期间用户可直接点选树中目录更改导入位置，目录点选语义
 * 由 Workspace 经 dirPickMode 下发 TreePanel）。名称预填磁盘文件名（保留扩展名，可改
 * =「导入即重命名」）；重名冲突固定 rename 策略（递增 `name (2).ext`）——单文件场景
 * 用户已有显式命名入口，策略三选是批量目录导入的诉求，不放（简单优先）。
 * 锚点契约：lt-import-html / aria-label「导入 HTML 文件」「导入文件名」「确认导入文件」
 * 「取消导入文件」为 E2E/组件测试专用锚，改文案须同步测试。
 */
import { useState } from 'react';

export interface ImportHtmlDialogProps {
  /** 源文件绝对路径（io:pick-file 产出，登记簿校验事实来源；仅展示） */
  readonly sourcePath: string;
  /** 目标父目录展示名（根为「根」；树中点选更改目标后由 Workspace 重渲染） */
  readonly targetName: string;
  /** 提交在途（确认钮防重复提交；在途不响应取消键外的关闭面） */
  readonly inFlight: boolean;
  onConfirm(name: string): void;
  onCancel(): void;
}

export function ImportHtmlDialog({
  sourcePath,
  targetName,
  inFlight,
  onConfirm,
  onCancel,
}: ImportHtmlDialogProps): React.JSX.Element {
  // 名称草稿预填磁盘 basename（win32 反斜杠与 posix 斜杠均按路径段切分取末段）
  const [draft, setDraft] = useState(sourcePath.split(/[\\/]/).pop() ?? sourcePath);
  const trimmed = draft.trim();
  return (
    <div
      className="lt-import-html fixed left-1/2 top-1/2 z-50 flex w-80 -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-lg border border-border bg-popover p-4 shadow-md duration-240 ease-out animate-in fade-in zoom-in-95"
      role="dialog"
      aria-label="导入 HTML 文件"
    >
      <p className="text-sm font-medium text-foreground">导入 HTML 文件</p>
      <p
        className="lt-import-html-source truncate text-xs text-muted-foreground"
        title={sourcePath}
      >
        {sourcePath}
      </p>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        文件名
        <input
          aria-label="导入文件名"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="h-7 rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          autoFocus
        />
      </label>
      <p className="text-xs text-muted-foreground">
        导入到「{targetName}」，点击树中目录可更改位置
      </p>
      {/* 操作钮 h-7 为浮层密度档（与面板工具钮 h-6 分档），故不复用共享常量，仅按压纪律对齐
          （按下即时、释放平滑；中性钮走 --accent-active 表面、主钮走 primary-80，依据见
          features/ui/classStrings.ts 按压纪律） */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          aria-label="取消导入文件"
          className="inline-flex h-7 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:bg-accent-active disabled:pointer-events-none disabled:opacity-40"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          aria-label="确认导入文件"
          disabled={inFlight || trimmed.length === 0}
          className="inline-flex h-7 items-center justify-center rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 active:duration-0 active:bg-primary/80 disabled:pointer-events-none disabled:opacity-40"
          onClick={() => {
            onConfirm(trimmed);
          }}
        >
          导入
        </button>
      </div>
    </div>
  );
}
