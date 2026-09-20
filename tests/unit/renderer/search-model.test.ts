// sliceWithHighlights 片段高亮切片纯函数单测（M5 批次① Task 7）：
// 裁窗/平移/多区间并集/越界钳制/空态/NFC 归一/全窗常量——区间均为 UTF-16 码元语义（M2 契约）
import { describe, expect, it } from 'vitest';
import {
  FULL_TEXT_WINDOW,
  SNIPPET_WINDOW,
  sliceWithHighlights,
} from '../../../src/renderer/src/features/search/searchModel';

describe('sliceWithHighlights 片段高亮切片', () => {
  it('无区间返回全文且零 spans（名称短片段不裁窗的基准形态）', () => {
    expect(sliceWithHighlights('hello 世界', [])).toEqual({ text: 'hello 世界', spans: [] });
  });

  it('空文本返回空串零 spans；带区间亦然（区间被钳制丢弃，不产畸形 mark）', () => {
    expect(sliceWithHighlights('', [])).toEqual({ text: '', spans: [] });
    expect(sliceWithHighlights('', [{ start: 0, end: 5 }])).toEqual({ text: '', spans: [] });
  });

  it('单区间裁窗平移：长文本按首命中 ±36 码元取窗，区间按窗左沿平移', () => {
    const text = 'x'.repeat(40) + '命中' + 'y'.repeat(40);
    // 「命中」占 2 码元：区间 [40, 42)；默认窗 [40-36, 42+36] = [4, 78]
    const sliced = sliceWithHighlights(text, [{ start: 40, end: 42 }]);
    expect(sliced.text).toBe(text.slice(4, 78));
    expect(sliced.spans).toEqual([{ start: 36, end: 38 }]);
  });

  it('多区间跨窗并集：与窗相交的后继区间把窗右沿扩至其终点，窗外区间弃置', () => {
    const text = 'a'.repeat(200);
    const sliced = sliceWithHighlights(text, [
      { start: 20, end: 22 },
      { start: 50, end: 90 }, // 起点落在默认窗右沿（22+36=58）之内 → 并集扩至 90
      { start: 120, end: 130 }, // 与并集窗 [0, 90] 不相交 → 弃置不展开窗
    ]);
    expect(sliced.text).toBe(text.slice(0, 90));
    expect(sliced.spans).toEqual([
      { start: 20, end: 22 },
      { start: 50, end: 90 },
    ]);
  });

  it('区间越界钳制：超长终点取文本长、完全越界区间丢弃', () => {
    const sliced = sliceWithHighlights('abc', [
      { start: 0, end: 100 },
      { start: 50, end: 60 },
    ]);
    expect(sliced.text).toBe('abc');
    expect(sliced.spans).toEqual([{ start: 0, end: 3 }]);
  });

  it('自定义窗口：before/after 覆盖默认 ±36（正文片段外的定制窗口场景）', () => {
    const text = 'x'.repeat(10) + '命中词' + 'y'.repeat(10);
    const sliced = sliceWithHighlights(text, [{ start: 10, end: 13 }], { before: 2, after: 2 });
    expect(sliced.text).toBe(text.slice(8, 15));
    expect(sliced.spans).toEqual([{ start: 2, end: 5 }]);
  });

  it('FULL_TEXT_WINDOW 不裁窗：名称片段全文本 + 区间原样（服务端 ≤255 码点已全量提供）', () => {
    const text = 'n'.repeat(300) + '命中'; // 长度 302 码元，命中区间 [300, 302)
    const sliced = sliceWithHighlights(text, [{ start: 300, end: 302 }], FULL_TEXT_WINDOW);
    expect(sliced.text).toBe(text);
    expect(sliced.spans).toEqual([{ start: 300, end: 302 }]);
  });

  it('SNIPPET_WINDOW 默认窗为 ±36 码元（brief 定值，与 LIKE 通道上下文窗口同量级）', () => {
    expect(SNIPPET_WINDOW).toEqual({ before: 36, after: 36 });
  });

  it('NFC 归一：切片基于合成后文本；区间以 UTF-16 码元语义直用（İ 类展开定档展示级降级）', () => {
    // 'I' + U+0307 组合上点（2 码元）NFC 合成为 U+0130 'İ'（1 码元），切片按合成文本计
    const sliced = sliceWithHighlights('I\u0307ab', [{ start: 0, end: 1 }]);
    expect(sliced.text).toBe('\u0130ab');
    expect(sliced.spans).toEqual([{ start: 0, end: 1 }]);
  });
});
