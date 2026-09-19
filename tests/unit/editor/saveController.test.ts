// SaveController（M4 spec §2）：纯状态机 + 真计时器句柄的接线层——fake timers 全链路：
// 尾沿写、挂起强制写、在途串行、失败重试、flush、dispose 清理（成对释放断言）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveController } from '../../../src/renderer/src/features/editor/saveController';

function makeDeps() {
  return {
    debounceMs: () => 300,
    autoSaveMs: () => 3000,
    // 返回类型含 null（会话竞态缺失分支），供各用例按需替换 getDoc 替身
    getDoc: vi.fn((nodeId: number): string | null => `doc-${String(nodeId)}`),
    write: vi.fn(() => Promise.resolve(true)),
    onDirtyChange: vi.fn(),
  };
}

let controller: SaveController;
let deps: ReturnType<typeof makeDeps>;
beforeEach(() => {
  vi.useFakeTimers();
  deps = makeDeps();
  controller = new SaveController(deps);
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe('SaveController', () => {
  it('尾沿去抖：edit 后 299ms 不写、300ms 写一次（快照=getDoc 当时值）', () => {
    controller.edit(2, '甲');
    expect(deps.onDirtyChange).toHaveBeenCalledWith(2, true);
    vi.advanceTimersByTime(299);
    expect(deps.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith(2, 'doc-2');
  });

  it('最长挂起：连续 edit（间隔 < 去抖）超 autoSaveMs 强制落库一次', () => {
    // 尾沿每 250ms 被连续输入后移（< 去抖 300），挂起上限自首个脏变更起固定在 3000——
    // 到期强制写一次；写内容 = getDoc 当时快照（doc-2）
    for (let t = 0; t <= 2800; t += 250) {
      controller.edit(2, '连续输入');
      vi.advanceTimersByTime(250);
    }
    vi.advanceTimersByTime(200);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith(2, 'doc-2');
  });

  it('写在途时新输入不并发：writeDone 后按新窗口补写', async () => {
    let resolveWrite: (v: boolean) => void = () => {};
    deps.write = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    // getDoc 模拟 TabSessions 语义：写时刻快照 = 当时最新全文
    let latestDoc = '甲';
    deps.getDoc = vi.fn(() => latestDoc);
    controller.edit(2, '甲');
    vi.advanceTimersByTime(300); // 触发首写（在途）
    expect(deps.write).toHaveBeenCalledTimes(1);
    controller.edit(2, '甲乙'); // 在途输入 → pending
    latestDoc = '甲乙'; // 会话 doc 已随输入更新
    vi.advanceTimersByTime(5000); // 期间不再发起第二写（串行）
    expect(deps.write).toHaveBeenCalledTimes(1);
    resolveWrite(true); // 在途完成
    await vi.advanceTimersByTimeAsync(0); // 微任务冲刷 → 重调度
    vi.advanceTimersByTime(300);
    expect(deps.write).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenLastCalledWith(2, '甲乙');
  });

  it('写失败按 autoSaveMs 重试；成功后 dirty 归零回调', async () => {
    deps.write = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    controller.edit(2, '甲');
    await vi.advanceTimersByTimeAsync(300);
    expect(deps.onDirtyChange).toHaveBeenLastCalledWith(2, true);
    await vi.advanceTimersByTimeAsync(3000); // 重试
    expect(deps.write).toHaveBeenCalledTimes(2);
    expect(deps.onDirtyChange).toHaveBeenLastCalledWith(2, false);
  });

  it('flush 立即写；tabClosed/dispose 清计时器不再写', () => {
    controller.edit(2, '甲');
    controller.flush(2);
    expect(deps.write).toHaveBeenCalledTimes(1);
    controller.edit(3, '乙');
    controller.tabClosed(3);
    vi.advanceTimersByTime(60000);
    expect(deps.write).toHaveBeenCalledTimes(1); // 3 号已清
    controller.edit(4, '丙');
    controller.dispose();
    vi.advanceTimersByTime(60000);
    expect(deps.write).toHaveBeenCalledTimes(1); // 全部清空
    controller.edit(5, '丁'); // 卸载后输入：dispatch 直接忽略（disposed 守卫）
    vi.advanceTimersByTime(60000);
    expect(deps.write).toHaveBeenCalledTimes(1); // disposed 后不再写
  });

  it('flushActive 仅作用于激活节点；无激活时 no-op', () => {
    controller.setActiveNode(2);
    controller.edit(2, '甲');
    controller.flushActive();
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith(2, 'doc-2');
    controller.setActiveNode(null);
    controller.edit(3, '乙');
    controller.flushActive();
    expect(deps.write).toHaveBeenCalledTimes(1); // 无激活不写
  });

  it('写时刻会话已关闭（getDoc 为 null）：不发起写、按完成清态不再重试', () => {
    deps.getDoc = vi.fn(() => null);
    controller.edit(2, '甲');
    vi.advanceTimersByTime(300);
    expect(deps.write).not.toHaveBeenCalled();
    // 快照缺失按落库完成处理：dirty 归零回调，且不武装重试计时器
    expect(deps.onDirtyChange).toHaveBeenLastCalledWith(2, false);
    vi.advanceTimersByTime(60000);
    expect(deps.write).not.toHaveBeenCalled();
  });
});
