/**
 * 保存管线控制器（M4 spec §2）：saveModel 纯状态机 + 真计时器句柄 + 注入式写的接线层。
 * per-tab 一份状态（同标签写串行由 inflight 态保证）；计时器到期取「先到者」——两个绝对
 * 时刻都武装 setTimeout，先触发者先 reduce（后到者由 writeStart 清空，天然幂等）。
 * dispose/tabClosed 成对释放（宪法资源纪律）。
 */
import { initialSaveState, reduceSave, type SaveEvent, type SaveState } from './saveModel';

/**
 * 注入依赖：SaveController 的全部副作用出口（设置读取 / doc 快照 / 写桥 / 脏态回调），
 * 便于 fake timers 单测全链路替身；Workspace 装配时以真实桥实现注入。
 */
export interface SaveControllerDeps {
  /** 尾沿去抖间隔（ms）：调用时刻运行时读取（Workspace 持 settings 态） */
  readonly debounceMs: () => number;
  /** 最长挂起间隔（ms）：同上运行时读取 */
  readonly autoSaveMs: () => number;
  /**
   * 发起写时刻的 doc 快照来源（TabSessions 会话）：返回 null 表示会话已不存在
   * （竞态关闭），按落库完成清态处理、不再重试
   */
  readonly getDoc: (nodeId: number) => string | null;
  /** 落库写（vfs:write 桥封装）：resolve false = 写失败，按 autoSaveMs 周期重试 */
  readonly write: (nodeId: number, text: string) => Promise<boolean>;
  /** 脏态变更回调（驱动标签 dirty 圆点）：仅在 dirty 翻转时触发 */
  readonly onDirtyChange: (nodeId: number, dirty: boolean) => void;
}

/** per-tab 计时器句柄对：尾沿去抖与最长挂起各一枚（绝对时刻差值武装） */
interface TabTimers {
  trailing?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
}

export class SaveController {
  private states = new Map<number, SaveState>();
  private timers = new Map<number, TabTimers>();
  private activeNodeId: number | null = null;
  private disposed = false;

  constructor(private readonly deps: SaveControllerDeps) {}

  /** 激活节点告知（flushActive 语义基准；Workspace 在 activeTab 变化时同步） */
  setActiveNode(nodeId: number | null): void {
    this.activeNodeId = nodeId;
  }

  /** 输入入口：编辑回路直连（Workspace 装配的 createEditorState onDocChanged 闭包回调） */
  edit(
    nodeId: number,
    // 位置语义参数：编辑内容以 getDoc 快照为唯一事实源（避免双源），实现刻意不消费
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _text: string,
  ): void {
    this.dispatch(nodeId, {
      type: 'edit',
      at: Date.now(),
      debounceMs: this.deps.debounceMs(),
      autoSaveMs: this.deps.autoSaveMs(),
    });
  }

  /** 立即写（Ctrl+S / 关标签前置）：快照取 getDoc 当时值 */
  flush(nodeId: number): void {
    this.dispatch(nodeId, {
      type: 'flush',
      at: Date.now(),
      debounceMs: this.deps.debounceMs(),
      autoSaveMs: this.deps.autoSaveMs(),
    });
  }

  /** 菜单「保存」兼容入口：仅对当前激活标签生效（无激活 no-op） */
  flushActive(): void {
    if (this.activeNodeId !== null) this.flush(this.activeNodeId);
  }

  /** 关标签后清理：计时器与状态一并移除（调用方保证 flush 已先行） */
  tabClosed(nodeId: number): void {
    this.clearTimers(nodeId);
    this.states.delete(nodeId);
  }

  /** 卸载清全部计时器（成对释放）：之后一切事件经 disposed 守卫直接忽略 */
  dispose(): void {
    this.disposed = true;
    for (const nodeId of [...this.states.keys()]) this.clearTimers(nodeId);
    this.states.clear();
  }

  private clearTimers(nodeId: number): void {
    const timers = this.timers.get(nodeId);
    if (timers?.trailing !== undefined) clearTimeout(timers.trailing);
    if (timers?.deadline !== undefined) clearTimeout(timers.deadline);
    this.timers.delete(nodeId);
  }

  private dispatch(nodeId: number, event: SaveEvent): void {
    if (this.disposed) return;
    const current = this.states.get(nodeId) ?? initialSaveState;
    const outcome = reduceSave(current, event);
    this.states.set(nodeId, outcome.state);
    if (outcome.state.dirty !== current.dirty) {
      this.deps.onDirtyChange(nodeId, outcome.state.dirty);
    }
    this.syncTimers(nodeId, outcome.state);
    if (outcome.write) this.startWrite(nodeId);
  }

  /**
   * 按双时点重武装计时器（remaining 差值）：trailingAt/deadlineAt 均非空即武装，无「空时刻」
   * 分支；已到期时刻（remaining ≤ 0）经 Math.max 兜底为 0ms——定时器立即触发、到期事件在
   * 下一宏任务兑现，属合法形态而非跳过。唯一调用方 dispatch 已挡 disposed
   */
  private syncTimers(nodeId: number, state: SaveState): void {
    this.clearTimers(nodeId);
    const timers: TabTimers = {};
    const now = Date.now();
    if (state.trailingAt !== null) {
      timers.trailing = setTimeout(
        () => this.dispatch(nodeId, { type: 'timerFired', at: Date.now() }),
        Math.max(0, state.trailingAt - now),
      );
    }
    if (state.deadlineAt !== null) {
      timers.deadline = setTimeout(
        () => this.dispatch(nodeId, { type: 'timerFired', at: Date.now() }),
        Math.max(0, state.deadlineAt - now),
      );
    }
    this.timers.set(nodeId, timers);
  }

  private startWrite(nodeId: number): void {
    this.dispatch(nodeId, { type: 'writeStart' });
    const text = this.deps.getDoc(nodeId);
    if (text === null) {
      // 会话已不存在（竞态关闭）：落写失败重试语义会无谓重试——按完成清态处理
      this.dispatch(nodeId, {
        type: 'writeDone',
        at: Date.now(),
        debounceMs: this.deps.debounceMs(),
        autoSaveMs: this.deps.autoSaveMs(),
      });
      return;
    }
    void this.deps.write(nodeId, text).then((ok) => {
      if (ok) {
        this.dispatch(nodeId, {
          type: 'writeDone',
          at: Date.now(),
          debounceMs: this.deps.debounceMs(),
          autoSaveMs: this.deps.autoSaveMs(),
        });
      } else {
        this.dispatch(nodeId, {
          type: 'writeFail',
          at: Date.now(),
          autoSaveMs: this.deps.autoSaveMs(),
        });
      }
    });
  }
}
