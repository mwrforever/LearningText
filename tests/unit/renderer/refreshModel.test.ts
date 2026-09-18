// rev 状态机（spec §4.2 防撕裂）：广播记录最新、重载锁定、load 完成落后追平
import { describe, expect, it } from 'vitest';
import {
  initialRevState,
  onBroadcast,
  onLoadDone,
  onReloadStart,
} from '../../../src/renderer/src/features/preview/refreshModel';

describe('preview rev 模型', () => {
  it('乱序/重复广播取最大值单调（latest 不回退）', () => {
    let s = onBroadcast(initialRevState, 5);
    s = onBroadcast(s, 3); // 迟到旧广播
    s = onBroadcast(s, 5); // 重复
    expect(s.latest).toBe(5);
  });

  it('重载锁定 loaded=latest；load 完成落后→catchUp 并推进 loaded', () => {
    let s = onBroadcast(initialRevState, 7);
    s = onReloadStart(s);
    expect(s.loaded).toBe(7);
    const done = onLoadDone(s);
    expect(done.catchUp).toBe(false);
    s = onBroadcast(s, 9); // 加载中途又来写
    const behind = onLoadDone(s);
    expect(behind.catchUp).toBe(true);
    expect(behind.state.loaded).toBe(9);
    expect(onLoadDone(behind.state).catchUp).toBe(false); // 追平后不再刷
  });
});
