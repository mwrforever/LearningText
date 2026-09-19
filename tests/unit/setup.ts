/**
 * 单元测试全局 setup（unit 项目 node + jsdom 双环境共用，接线见 vitest.config.ts）。
 * jsdom 量测 API stub（CI Windows 修复 round 3 失败 2）：jsdom 无布局引擎，其 Range 只
 * 实现 DOM Standard 子集、缺 CSSOM View 的 getClientRects / getBoundingClientRect——
 * CM6 drawSelection 的量测路径（coordsAtPos → textRange(...).getClientRects）时序偶发
 * 命中即抛 TypeError。此处补最小实现：空量测使选中 markers 为空、绘制步骤跳过（无行为
 * 影响）；条件式赋值——若未来 jsdom 实现同名 API 则不遮蔽真实现。
 */
if (typeof Range !== 'undefined') {
  // 守卫 node 环境：Range 是浏览器 API，同 project 的 node 环境用例不加载本 stub；
  // DOMRectList 带 indexed 签名、字面量不可直接满足，测试桩场景下经 unknown 收窄（带理由的
  // 受控断言，非 IPC/外部输入边界）
  const emptyRectList = { length: 0, item: () => null } as unknown as DOMRectList;
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function (): DOMRectList {
      return emptyRectList;
    };
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function (): DOMRect {
      return new DOMRect(0, 0, 0, 0);
    };
  }
}
