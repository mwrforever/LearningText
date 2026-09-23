/**
 * 回收站面板（M5 批次②）：树栏 trash 态视图——条目列表（名称/原路径/删除时间）、本地关键词
 * 过滤（trashModel.filterTrashed）、还原 / 彻底删除 / 清空三类操作，危险分级确认（D4）：
 * 还原无确认（可逆，失败仅 toast）；彻底删除与清空走**应用内确认弹窗**（ConfirmDialog，
 * M8 反馈批次取代原生 window.confirm——原生框样式与应用脱节，用户实测反馈）；
 * 数据自持：挂载即 listTrashed 首拉，
 * restored/purged/trashed 广播驱动重拉（广播时机由主进程保证在事务提交后，宪法 B.3-4），
 * 订阅随 trash 态进出成对挂卸。列表为语义化 ul/li + aria（设计系统文档 §7.2 无 table
 * 组件的列表形态；样式用标准类串模板字面量，不消费 cn()——D28 体积红线裁决）。
 */
import { useEffect, useState } from 'react';
import { E_VFS_NOT_FOUND } from '../../../../shared/errors';
import type { TrashedNodeMeta } from '../../../../shared/vfs-contract';
import { DESTRUCTIVE_BUTTON, TOOL_BUTTON } from '../ui/classStrings';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/Toast';
import { filterTrashed } from './trashModel';

/** 待确认的不可逆操作（确认弹窗开合的唯一状态源；确认后即刻清空，取消不留痕） */
type PendingTrashAction =
  | { readonly kind: 'purge'; readonly item: TrashedNodeMeta }
  | { readonly kind: 'empty'; readonly count: number };

export function TrashPanel(): React.JSX.Element {
  const [items, setItems] = useState<readonly TrashedNodeMeta[]>([]);
  const [keyword, setKeyword] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingTrashAction | null>(null);

  // 首拉 + trash 域广播重拉：restored/purged/trashed 任一到达都重取全量（回收站无分页、
  // 量级可控走 .all 等价的有限列表）；alive 标记防卸载后续体 setState，退订成对（资源纪律）
  useEffect(() => {
    let alive = true;
    const reload = (): void => {
      void window.api.listTrashed().then((result) => {
        if (alive && result.ok) setItems(result.value);
      });
    };
    reload();
    const unsubscribe = window.api.onVfsChanged((broadcast) => {
      const type = broadcast.event.type;
      // 仅 trash 域事件驱动重拉：created/written/renamed/moved 不改变回收站内容集
      if (type === 'restored' || type === 'purged' || type === 'trashed') reload();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  /**
   * 还原（可逆操作，无确认）：失败 toast 保留条目可重试——还原撞名
   * E_VFS_DUPLICATE_NAME 即经此呈现；成功后列表刷新归 restored 广播重拉链
   */
  function onRestore(nodeId: number): void {
    void window.api.restoreNode({ nodeId }).then((result) => {
      if (!result.ok) showToast(`还原失败：${result.error.message}`);
    });
  }

  /** 单条彻底删除（不可逆）：先经应用内确认弹窗二次确认，取消不发起 purgeNode */
  function onPurge(item: TrashedNodeMeta): void {
    setPendingAction({ kind: 'purge', item });
  }

  /** 确认弹窗落定：确认即执行对应不可逆动作（取消路径不经过此函数） */
  function confirmPending(): void {
    const action = pendingAction;
    setPendingAction(null);
    if (action === null) return;
    if (action.kind === 'purge') {
      void window.api.purgeNode({ nodeId: action.item.meta.id }).then((result) => {
        if (!result.ok) showToast(`删除失败：${result.error.message}`);
      });
      return;
    }
    emptyTrash(action.count);
  }

  /**
   * 清空（批量不可逆）：确认弹窗文案含条目数（D4 逐字）；确认后逐项 purge。
   * E_VFS_NOT_FOUND 静默容忍：purge 以子树为单位级联移除后代，列表为逐行谓词的平铺——
   * 祖先先行删除时其后代条目已随之消失，对已消失条目报错反成噪音
   */
  function emptyTrash(count: number): void {
    if (count === 0) return;
    void Promise.all(
      items.map((item) =>
        window.api.purgeNode({ nodeId: item.meta.id }).then((result) => {
          if (!result.ok && result.error.code !== E_VFS_NOT_FOUND) {
            showToast(`删除失败：${result.error.message}`);
          }
        }),
      ),
    );
  }

  const filtered = filterTrashed(items, keyword);
  // 回收站全量条目 id 集：后代行判定基准（必须取未过滤全量——祖先行被关键词滤掉时
  // 后代行的「随上级还原」事实不变，若取过滤集会误判）
  const trashedIds = new Set(items.map((item) => item.meta.id));
  return (
    <section aria-label="回收站" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 过滤 + 清空操作条：清空仅在有条目时可用（空态删除 0 个节点无意义） */}
      <div className="lt-trash-toolbar flex items-center gap-2 border-b border-border px-2 py-1">
        <input
          aria-label="过滤回收站"
          placeholder="按名称或路径过滤"
          className="min-w-0 flex-1 rounded-sm border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => setKeyword(e.target.value)}
        />
        {/* 清空（不可逆批量操作）走破坏色分级，与中性工具钮构成色彩分级族
            （色彩依据与对比度自证见 features/ui/classStrings.ts DESTRUCTIVE_BUTTON）；
            还原/删除为逐条可逆或强确认操作，维持中性 TOOL_BUTTON */}
        <button
          type="button"
          aria-label="清空回收站"
          disabled={items.length === 0}
          className={DESTRUCTIVE_BUTTON}
          onClick={() => {
            setPendingAction({ kind: 'empty', count: items.length });
          }}
        >
          清空
        </button>
      </div>
      {filtered.length === 0 ? (
        // 空态与无匹配分文案：前者是回收站事实、后者是过滤结果，混用会误导用户
        <p className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          {items.length === 0 ? '回收站为空' : '无匹配条目'}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-auto p-2 text-sm">
          {filtered.map((item) => (
            <li key={item.meta.id} className="mb-1 rounded-sm border border-border px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-foreground">{item.meta.name}</span>
                {/* 后代行「随上级还原」标注（M5 Task 15 打磨，TASK.md 登记项的纯呈现处置）：
                    平铺列表中最近父 id 命中另一回收站条目即后代行——其还原会被父链校验拒，
                    父级还原时整树出列；仅加指向性标注，还原钮可点性不变（行为零变更） */}
                {item.meta.parentId !== null && trashedIds.has(item.meta.parentId) ? (
                  <span className="shrink-0 text-xs text-muted-foreground">随上级还原</span>
                ) : null}
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`还原 ${item.meta.name}`}
                    className={TOOL_BUTTON}
                    onClick={() => onRestore(item.meta.id)}
                  >
                    还原
                  </button>
                  <button
                    type="button"
                    aria-label={`彻底删除 ${item.meta.name}`}
                    className={TOOL_BUTTON}
                    onClick={() => onPurge(item)}
                  >
                    删除
                  </button>
                </span>
              </div>
              {/* 原路径与删除时间：次级信息按 12px 档弱化（设计系统文档 §四 字体阶梯）；
                  时间数字 tabular-nums（M5 打磨：列表纵向排布时数字列宽稳定） */}
              <p className="m-0 truncate text-xs text-muted-foreground">{item.meta.virtualPath}</p>
              <p className="m-0 text-xs text-muted-foreground tabular-nums">
                删除于 {item.deletedAt}
              </p>
            </li>
          ))}
        </ul>
      )}
      {/* 不可逆操作确认弹窗（M8 反馈批次）：破坏色分级 + 取消项默认聚焦（安全默认）；
          描述文案逐字沿用原 window.confirm 文案（语义锚零漂移） */}
      {pendingAction !== null ? (
        <ConfirmDialog
          title={pendingAction.kind === 'purge' ? '彻底删除' : '清空回收站'}
          description={
            pendingAction.kind === 'purge'
              ? `彻底删除「${pendingAction.item.meta.name}」？不可恢复`
              : `将彻底删除 ${String(pendingAction.count)} 个节点，不可恢复`
          }
          confirmLabel={pendingAction.kind === 'purge' ? '彻底删除' : '清空'}
          destructive
          onConfirm={confirmPending}
          onCancel={() => {
            setPendingAction(null);
          }}
        />
      ) : null}
    </section>
  );
}
