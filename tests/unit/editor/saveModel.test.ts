// 保存管线状态机（M4 spec §2.1/2.2）：尾沿去抖 + 最长挂起双计时器、写串行、失败重试、
// flush 语义——纯决策无副作用，计时器句柄归 SaveController
import { describe, expect, it } from 'vitest';
import { initialSaveState, reduceSave } from '../../../src/renderer/src/features/editor/saveModel';

const D = { debounceMs: 300, autoSaveMs: 3000 };

describe('保存状态机 reduceSave', () => {
  it('首个 edit 武装双计时器（尾沿 +300、挂起 +3000）；后续 edit 只推尾沿', () => {
    let o = reduceSave(initialSaveState, { type: 'edit', at: 1000, ...D });
    expect(o.state.dirty).toBe(true);
    expect(o.state.trailingAt).toBe(1300);
    expect(o.state.deadlineAt).toBe(4000);
    o = reduceSave(o.state, { type: 'edit', at: 2000, ...D });
    expect(o.state.trailingAt).toBe(2300); // 尾沿后移
    expect(o.state.deadlineAt).toBe(4000); // 挂起自首个脏变更起算不后移
    expect(o.write).toBe(false);
  });

  it('计时器到期 → write=true 且清计时器；writeStart 置在途', () => {
    const armed = reduceSave(initialSaveState, { type: 'edit', at: 0, ...D }).state;
    const fired = reduceSave(armed, { type: 'timerFired', at: 300 });
    expect(fired.write).toBe(true);
    expect(fired.state.trailingAt).toBeNull();
    const started = reduceSave(fired.state, { type: 'writeStart' });
    expect(started.state.inflight).toBe(true);
  });

  it('在途期间输入记 pending 不武装计时器；writeDone 后以新窗口重调度', () => {
    let s = reduceSave(initialSaveState, { type: 'edit', at: 0, ...D }).state;
    s = reduceSave(s, { type: 'timerFired', at: 300 }).state;
    s = reduceSave(s, { type: 'writeStart' }).state;
    const during = reduceSave(s, { type: 'edit', at: 500, ...D });
    expect(during.state.pendingAfterInflight).toBe(true);
    expect(during.state.trailingAt).toBeNull(); // 在途不武装（写完成后统一重调度）
    const done = reduceSave(during.state, { type: 'writeDone', at: 800, ...D });
    expect(done.write).toBe(false);
    expect(done.state.dirty).toBe(true);
    expect(done.state.trailingAt).toBe(1100);
    expect(done.state.deadlineAt).toBe(3800);
  });

  it('无 pending 的 writeDone 全清（dirty 归零）；writeFail 按 autoSaveMs 重试不自旋', () => {
    let s = reduceSave(initialSaveState, { type: 'edit', at: 0, ...D }).state;
    s = reduceSave(s, { type: 'timerFired', at: 300 }).state;
    s = reduceSave(s, { type: 'writeStart' }).state;
    const done = reduceSave(s, { type: 'writeDone', at: 400, ...D });
    expect(done.state).toEqual(initialSaveState);
    const fail = reduceSave(done.state, { type: 'edit', at: 500, ...D }).state;
    const failed = reduceSave(fail, { type: 'timerFired', at: 800 }).state;
    const retrying = reduceSave(
      { ...failed, inflight: true },
      { type: 'writeFail', at: 900, autoSaveMs: 3000 },
    );
    expect(retrying.state.dirty).toBe(true);
    expect(retrying.state.trailingAt).toBe(3900); // +autoSaveMs 重试
    expect(retrying.write).toBe(false);
  });

  it('flush：有脏立即 write 并清计时器；在途转 pending；无脏 no-op', () => {
    const armed = reduceSave(initialSaveState, { type: 'edit', at: 0, ...D }).state;
    const flushed = reduceSave(armed, { type: 'flush', at: 100, ...D });
    expect(flushed.write).toBe(true);
    expect(flushed.state.trailingAt).toBeNull();
    const inFlight = reduceSave(flushed.state, { type: 'writeStart' }).state;
    const flushDuring = reduceSave(inFlight, { type: 'flush', at: 150, ...D });
    expect(flushDuring.write).toBe(false);
    expect(flushDuring.state.pendingAfterInflight).toBe(true);
    const clean = reduceSave(initialSaveState, { type: 'flush', at: 0, ...D });
    expect(clean.write).toBe(false);
  });

  // 分支覆盖补充：在途期间计时器仍可能到点（写慢于去抖窗口），必须转挂起而非二次写
  it('在途期间计时器到期：转挂起标记并清双计时器，不发起第二次写', () => {
    let s = reduceSave(initialSaveState, { type: 'edit', at: 0, ...D }).state;
    s = reduceSave(s, { type: 'timerFired', at: 300 }).state;
    s = reduceSave(s, { type: 'writeStart' }).state;
    const fired = reduceSave(s, { type: 'timerFired', at: 900 });
    expect(fired.write).toBe(false); // 写串行：在途不发起第二次写
    expect(fired.state.pendingAfterInflight).toBe(true);
    expect(fired.state.trailingAt).toBeNull();
    expect(fired.state.deadlineAt).toBeNull();
  });
});
