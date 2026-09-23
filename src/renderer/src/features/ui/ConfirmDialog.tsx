/**
 * 应用内确认弹窗（M8 用户实测反馈批次）：统一「破坏性 / 带参操作先确认」的浮层形态，
 * 取代原 4 处原生 `window.confirm`（彻底删除、清空回收站、大文件打开、未保存退出）——
 * 原生框是 OS 皮肤，与应用设计语言脱节（M5 打磨对照表 #13 挂账项，用户实测反馈
 * 「弹窗需要优化样式设计」）。
 *
 * 形态与既有浮层（导入确认 / 数据迁移 / 重命名）逐项同源，零新视觉语言：
 * —— AlertDialog 原语承载焦点陷阱、Esc/遮罩关闭语义与 `role="alertdialog"`（radix 内建）；
 * —— 设计系统标尺：内边距 p-4、标题 text-base（display 档）、操作钮 h-8 text-xs（浮层档）、
 *    出入场 duration-240（§6.1 浮层档位）；
 * —— 破坏性操作走破坏色分级（与工具钮构成色彩分级族，依据见 features/ui/classStrings.ts）；
 *    非破坏性（大文件打开）走主色，语义分级不混用；
 * —— 取消项由 radix AlertDialog 默认聚焦（破坏性操作的安全默认：回车不会误触不可逆动作）。
 *
 * 锚点契约：`lt-confirm` 类与 aria-label「确认操作」「取消操作」为 E2E/组件测试专用锚，
 * 改文案须同步测试；描述文案逐字沿用原 window.confirm 文案（语义锚零漂移）。
 */
import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog';

export interface ConfirmDialogProps {
  /** 浮层标题（短句，如「彻底删除」「退出应用」） */
  readonly title: string;
  /** 说明文案（沿用原 window.confirm 文案，含操作对象与后果） */
  readonly description: string;
  /** 确认钮文案（动词，如「彻底删除」「退出」） */
  readonly confirmLabel: string;
  /** 破坏性操作（不可逆）：确认钮走破坏色；非破坏性走主色 */
  readonly destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/** 浮层操作钮类串（h-8 浮层档，与导入确认/数据迁移弹层同档；破坏色与主色按 destructive 分派） */
const ACTION_BASE = 'h-8 text-xs';
const ACTION_DESTRUCTIVE = 'bg-destructive text-white hover:bg-destructive/90';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  // 确认已按标记：radix 在 Action 点击后同样会触发 onOpenChange(false)（关闭面），
  // 无标记时会把「确认」二次上报为「取消」——消费者多为 Promise 兑现器或不可逆动作入口，
  // 双报会污染语义（兑现器虽已判空自保，但语义仍须在此收口）
  const confirmedRef = useRef(false);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        // 关闭面（Esc / 遮罩 / 取消钮）统一收口为取消：取消不得触发任何写侧动作
        if (!open && !confirmedRef.current) onCancel();
      }}
    >
      <AlertDialogContent className="lt-confirm p-4 duration-240">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel aria-label="取消操作" className={ACTION_BASE}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            aria-label="确认操作"
            className={`${ACTION_BASE}${destructive ? ` ${ACTION_DESTRUCTIVE}` : ''}`}
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
