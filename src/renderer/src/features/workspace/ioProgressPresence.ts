/**
 * io 进度面板退场存在性 hook（M5 批次⑥ 缺陷修复配套）：导入/导出进度面板收口（载荷置
 * null）后不能瞬时卸载——需保留最后载荷播一段滑出过渡再离开。本 hook 只承接「退场播放」
 * 的呈现层语义：进度收口写 null 仍由各 invoke 续体负责（confirmImport / confirmImportHtml /
 * beginExport），进度实时值仍由调用方原始 state 持有（cancelRunningImport 等读实时值的
 * 既有语义不变）。
 */
import { useEffect, useState } from 'react';

/**
 * 进度面板退场播放时长（毫秒）：与 Workspace 退场动效 duration-240 工具类同源——
 * Tailwind JIT 需字面类名，调整时长必须两处（本常量与类串）同步修改；240ms 与入场
 * 对称，播完才卸载。
 */
export const PROGRESS_EXIT_MS = 240;

/** 退场存在性呈现态：调用方按「非 null 才渲染」消费 */
export interface ProgressPresence<T> {
  /** 最后一次进度载荷快照：退场播放期间面板继续展示该快照，不闪空内容 */
  readonly value: T;
  /** 是否处于退场播放期：true 时调用方挂退场动效类并以 pointer-events-none 禁误点 */
  readonly leaving: boolean;
}

/**
 * 退场存在性：把「载荷 null = 立即卸载」翻译为「保留最后快照播 exitMs 退场再卸载」。
 *
 * 执行流程（全部经 effect 驱动，渲染期零副作用）：
 * —— payload 非 null（含重复广播）：快照最新载荷、复位 leaving=false。这是快速连开
 *    竞态的防护点——退场播放期间新进度广播到达时，本分支重置为入场呈现，同时上一次
 *    退场计时器被 effect cleanup 清除，杜绝「旧退场计时器误卸载新进度」。
 * —— payload 变 null：保留最后快照、leaving=true，exitMs 后整体置 null（调用方卸载）。
 * —— 此前从未呈现（快照本为 null）时置 null 为同值更新，React bailout，无额外渲染。
 *
 * @param payload 调用方进度实时态（null=已收口/无进度；必须来自 state，禁止每渲染新建
 *   非空对象——否则载荷身份变化会触发无谓复位）
 * @param exitMs 退场播放时长（毫秒），与退场动效工具类的 duration 保持一致
 * @returns null=不渲染；非 null=按 value 快照渲染、leaving 决定挂入场或退场动效类
 */
export function useExitPresence<T>(payload: T | null, exitMs: number): ProgressPresence<T> | null {
  const [presence, setPresence] = useState<ProgressPresence<T> | null>(
    payload === null ? null : { value: payload, leaving: false },
  );

  useEffect(() => {
    if (payload !== null) {
      // 竞态防护点：新进度到达（含退场播放期间）——cleanup 先清退场计时器，再快照新
      // 载荷复位为入场呈现（重复广播到达同样复位，面板不闪断）
      setPresence({ value: payload, leaving: false });
      return undefined;
    }
    // 载荷收口为 null：保留最后快照进入退场播放，exitMs 播完整体置 null 卸载
    setPresence((prev) => (prev === null ? prev : { ...prev, leaving: true }));
    const timer = setTimeout(() => {
      setPresence(null);
    }, exitMs);
    return () => {
      clearTimeout(timer);
    };
  }, [payload, exitMs]);

  return presence;
}
