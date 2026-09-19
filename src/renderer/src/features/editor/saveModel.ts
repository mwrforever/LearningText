/**
 * 保存管线纯状态机（M4 spec §2.1/2.2 裁决 D2）：双计时器时点（尾沿去抖 + 最长挂起）
 * 记于状态、写串行（同标签同时最多一个在途）、失败按 autoSaveMs 重试——决策与副作用
 * 分离：计时器句柄/写调用归 SaveController，本模块可 100% 单测。
 */
export interface SaveState {
  readonly dirty: boolean; // 存在未落库变更
  readonly inflight: boolean; // 写在途
  readonly pendingAfterInflight: boolean; // 在途期间的后续输入
  readonly trailingAt: number | null; // 尾沿到期绝对时刻（ms）
  readonly deadlineAt: number | null; // 挂起上限到期绝对时刻（自首个脏变更起算，不后移）
}

export const initialSaveState: SaveState = {
  dirty: false,
  inflight: false,
  pendingAfterInflight: false,
  trailingAt: null,
  deadlineAt: null,
};

export type SaveEvent =
  | { type: 'edit'; at: number; debounceMs: number; autoSaveMs: number }
  | { type: 'timerFired'; at: number }
  | { type: 'writeStart' }
  | { type: 'writeDone'; at: number; debounceMs: number; autoSaveMs: number }
  | { type: 'writeFail'; at: number; autoSaveMs: number }
  | { type: 'flush'; at: number; debounceMs: number; autoSaveMs: number };

export interface SaveOutcome {
  readonly state: SaveState;
  readonly write: boolean; // 调用方据此以「发起时刻 doc 快照」发起一次 vfs:write
}

export function reduceSave(s: SaveState, e: SaveEvent): SaveOutcome {
  switch (e.type) {
    case 'edit': {
      if (s.inflight) {
        // 写串行：在途期间输入只记 pending，写完成后统一重调度（spec §2.2-1）
        return { state: { ...s, dirty: true, pendingAfterInflight: true }, write: false };
      }
      return {
        state: {
          ...s,
          dirty: true,
          trailingAt: e.at + e.debounceMs,
          deadlineAt: s.deadlineAt ?? e.at + e.autoSaveMs,
        },
        write: false,
      };
    }
    case 'timerFired': {
      if (s.inflight) {
        return {
          state: { ...s, pendingAfterInflight: true, trailingAt: null, deadlineAt: null },
          write: false,
        };
      }
      return { state: { ...s, trailingAt: null, deadlineAt: null }, write: true };
    }
    case 'writeStart':
      return { state: { ...s, inflight: true, trailingAt: null, deadlineAt: null }, write: false };
    case 'writeDone': {
      if (s.pendingAfterInflight) {
        // 后继写以全新窗口调度（spec §2.2-1：在途完成后按剩余脏量重新走双计时器）
        return {
          state: {
            ...s,
            inflight: false,
            pendingAfterInflight: false,
            trailingAt: e.at + e.debounceMs,
            deadlineAt: e.at + e.autoSaveMs,
          },
          write: false,
        };
      }
      return { state: { ...initialSaveState }, write: false }; // 全部落库：脏/在途/计时全清
    }
    case 'writeFail':
      // 写失败保留脏，按自动保存周期重试（不自旋；spec §2.2-3）
      return {
        state: {
          ...s,
          inflight: false,
          pendingAfterInflight: false,
          trailingAt: e.at + e.autoSaveMs,
          deadlineAt: e.at + e.autoSaveMs,
        },
        write: false,
      };
    case 'flush': {
      if (s.inflight) return { state: { ...s, pendingAfterInflight: true }, write: false };
      if (!s.dirty) return { state: s, write: false };
      return { state: { ...s, trailingAt: null, deadlineAt: null }, write: true };
    }
  }
}
