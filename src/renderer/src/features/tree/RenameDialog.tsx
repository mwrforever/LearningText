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
    <div className="lt-rename" role="dialog" aria-label="重命名">
      <input
        aria-label="新名称"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        autoFocus
      />
      <button
        type="button"
        aria-label="确认重命名"
        disabled={inFlight || trimmed.length === 0}
        onClick={() => {
          onConfirm(trimmed);
        }}
      >
        确定
      </button>
      <button type="button" aria-label="取消重命名" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}
