/**
 * 行内重命名模态（M4 spec §6.2 D8）：受控 input 预填当前名；trim 后空名确认不回传；
 * inFlight 期间确认钮禁用（防重复提交）。关闭仅经「取消」钮回传 onCancel（无 Esc /
 * 遮罩点击监听——M4 起即如此，关闭语义由 Workspace 持 renameTarget 态收口）。
 */
import { useState } from 'react';
import { PRIMARY_BUTTON, TOOL_BUTTON } from '../ui/classStrings';

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
      className="lt-rename fixed left-1/2 top-1/2 z-50 flex w-80 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border border-border bg-popover p-4 shadow-md duration-240 ease-out animate-in fade-in zoom-in-95"
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
      {/* 确认/取消钮复用共享类串（按压与禁用纪律单一来源，见 features/ui/classStrings.ts）；
          shrink-0 为该浮层专属布局约束（横向 flex 行内钮不得被输入框挤压缩小），
          共享串不含此约束，故经模板串追加于共享串之后 */}
      <button
        type="button"
        aria-label="确认重命名"
        disabled={inFlight || trimmed.length === 0}
        className={`${PRIMARY_BUTTON} shrink-0`}
        onClick={() => {
          onConfirm(trimmed);
        }}
      >
        确定
      </button>
      <button
        type="button"
        aria-label="取消重命名"
        className={`${TOOL_BUTTON} shrink-0`}
        onClick={onCancel}
      >
        取消
      </button>
    </div>
  );
}
