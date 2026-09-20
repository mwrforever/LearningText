/**
 * 行内重命名模态（M4 spec §6.2 D8）：受控 input 预填当前名；trim 后空名确认不回传；
 * inFlight 期间确认钮禁用（防重复提交）；取消回传 onCancel。Esc 取消（原生 dialog 语义简化为容器层）。
 */
import { useState } from 'react';

export interface RenameDialogProps {
  readonly nodeName: string;
  readonly inFlight: boolean;
  onConfirm(name: string): void;
  onCancel(): void;
}

export function RenameDialog({
  nodeName,
  inFlight,
  onConfirm,
  onCancel,
}: RenameDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState(nodeName);
  const trimmed = draft.trim();
  return (
    // 视口居中浮层卡片形态（设计系统文档 §7.4 裁决：保留容器 Tailwind 化，不迁 shadcn Dialog
    // ——radix 依赖与焦点陷阱行为面均超本批次边界）；role/aria 锚点零变更
    <div
      className="lt-rename fixed left-1/2 top-1/2 z-50 flex w-80 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border border-border bg-popover p-4 shadow-md duration-240 animate-in fade-in zoom-in-95"
      role="dialog"
      aria-label="重命名"
    >
      <input
        aria-label="新名称"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        className="min-w-0 flex-1 rounded-sm border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />
      <button
        type="button"
        aria-label="确认重命名"
        disabled={inFlight || trimmed.length === 0}
        className="inline-flex h-6 shrink-0 items-center justify-center rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        onClick={() => {
          onConfirm(trimmed);
        }}
      >
        确定
      </button>
      <button
        type="button"
        aria-label="取消重命名"
        className="inline-flex h-6 shrink-0 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
        onClick={onCancel}
      >
        取消
      </button>
    </div>
  );
}
