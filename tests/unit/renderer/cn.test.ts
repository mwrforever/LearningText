// cn 合并语义：条件拼接 + tailwind 冲突消解（p3 类工具，全分支）
import { describe, expect, it } from 'vitest';
import { cn } from '../../../src/renderer/src/lib/cn';

describe('cn', () => {
  it('拼接多段与条件假值过滤', () => {
    // 依 brief 逐字保留字面量 `false && 'b'` 固定「条件假值」分支；字面量常量表达式
    // 触发 no-constant-binary-expression，仅对此行豁免（clsx 条件类惯例的真实形态）
    // eslint-disable-next-line no-constant-binary-expression
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
  it('tailwind 冲突类后写胜（p-2 与 p-4 同轴）', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'px-2', 'text-lg')).toBe('px-2 text-lg');
  });
});
