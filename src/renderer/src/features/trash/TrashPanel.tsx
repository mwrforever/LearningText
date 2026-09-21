/**
 * 回收站面板（M5 批次②）：树栏 trash 态视图——条目列表（名称/原路径/删除时间）、本地关键词
 * 过滤（trashModel.filterTrashed）、还原 / 彻底删除 / 清空三类操作，危险分级确认（D4）：
 * 还原无确认（可逆，失败仅 toast）；彻底删除 window.confirm 二次确认；清空强确认文案
 * 「将彻底删除 N 个节点，不可恢复」。数据自持：挂载即 listTrashed 首拉，
 * restored/purged/trashed 广播驱动重拉（广播时机由主进程保证在事务提交后，宪法 B.3-4），
 * 订阅随 trash 态进出成对挂卸。列表为语义化 ul/li + aria（设计系统文档 §7.2 无 table
 * 组件的列表形态；样式用标准类串模板字面量，不消费 cn()——D28 体积红线裁决）。
 */
import { useEffect, useState } from 'react';
import { E_VFS_NOT_FOUND } from '../../../../shared/errors';
import type { TrashedNodeMeta } from '../../../../shared/vfs-contract';
import { showToast } from '../ui/Toast';
import { filterTrashed } from './trashModel';

/** 工具钮标准类串（设计系统文档 §7.2 唯一规范形态，模板字面量拼接、禁体外发挥） */
const TOOL_BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40';

/**
 * 破坏性工具钮类串（清空专用，独立整串避免模板字面量拼接下 text-* 双类级联歧义）：
 * 不可逆批量操作的色彩分级（蓝图 §2.3 回收站「清空」destructive 色语义）；
 * 悬停面文字对比度已自证（设计系统文档 §3.1 #18/#19：destructive/accent = 5.25/5.29），
 * 禁用态经 opacity-40 降噪；还原/删除为逐条可逆或强确认操作，维持中性 TOOL_BUTTON_CLASS
 */
const DESTRUCTIVE_BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-destructive transition-colors duration-100 hover:bg-accent hover:text-destructive disabled:pointer-events-none disabled:opacity-40';

export function TrashPanel(): React.JSX.Element {
  const [items, setItems] = useState<readonly TrashedNodeMeta[]>([]);
  const [keyword, setKeyword] = useState('');

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

  /** 单条彻底删除（不可逆）：先 window.confirm 二次确认，取消不发起 purgeNode */
  function onPurge(item: TrashedNodeMeta): void {
    if (!window.confirm(`彻底删除「${item.meta.name}」？不可恢复`)) return;
    void window.api.purgeNode({ nodeId: item.meta.id }).then((result) => {
      if (!result.ok) showToast(`删除失败：${result.error.message}`);
    });
  }

  /**
   * 清空（批量不可逆）：强确认文案含条目数（D4 逐字）；确认后逐项 purge。
   * E_VFS_NOT_FOUND 静默容忍：purge 以子树为单位级联移除后代，列表为逐行谓词的平铺——
   * 祖先先行删除时其后代条目已随之消失，对已消失条目报错反成噪音
   */
  function onEmpty(): void {
    if (!window.confirm(`将彻底删除 ${items.length} 个节点，不可恢复`)) return;
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
        <button
          type="button"
          aria-label="清空回收站"
          disabled={items.length === 0}
          className={DESTRUCTIVE_BUTTON_CLASS}
          onClick={onEmpty}
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
                    className={TOOL_BUTTON_CLASS}
                    onClick={() => onRestore(item.meta.id)}
                  >
                    还原
                  </button>
                  <button
                    type="button"
                    aria-label={`彻底删除 ${item.meta.name}`}
                    className={TOOL_BUTTON_CLASS}
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
    </section>
  );
}
