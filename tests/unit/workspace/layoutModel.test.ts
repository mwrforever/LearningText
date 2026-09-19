// 布局纯函数（M4 spec §5.1）：比例钳制 0.15–0.6、指针坐标→比例
import { describe, expect, it } from 'vitest';
import {
  clampRatio,
  ratioFromPointer,
} from '../../../src/renderer/src/features/workspace/layoutModel';

describe('layoutModel', () => {
  it('clampRatio：0.15/0.6 收，越界双向钳制', () => {
    expect(clampRatio(0.25)).toBe(0.25);
    expect(clampRatio(0.1)).toBe(0.15);
    expect(clampRatio(0.9)).toBe(0.6);
  });

  it('ratioFromPointer：偏移/容器宽即比例并钳制；零宽容器返下界（防除零）', () => {
    expect(ratioFromPointer(1000, 250)).toBe(0.25);
    expect(ratioFromPointer(1000, 50)).toBe(0.15);
    expect(ratioFromPointer(0, 100)).toBe(0.15);
  });
});
