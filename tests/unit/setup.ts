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
  // jsdom 无 ResizeObserver（cssom-view 未实现）：cmdk（快速打开浮层，M5 Task 6）挂载即
  // 观测容器尺寸，缺失直接 ReferenceError。补空实现：观测为 no-op（jsdom 无布局，本无
  // 尺寸变化可报），不影响命令列表渲染与键盘语义；条件式赋值同上，不遮蔽真实现。
  if (typeof ResizeObserver === 'undefined') {
    const stub = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    window.ResizeObserver = stub as unknown as typeof ResizeObserver;
  }
  // jsdom 无 scrollIntoView（元素滚动未实现）：cmdk 方向键导航后把选中项滚入可视区，
  // 缺失在 keydown 处理中抛 TypeError。补 no-op（jsdom 无布局，滚动本无可视区语义）；
  // 条件式赋值同上。
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function (): void {};
  }
  // jsdom 无 matchMedia（cssom-view 未实现媒体查询）：Workspace 主题装配（M5 Task 8）挂载即
  // 查询 prefers-color-scheme，缺失直接 TypeError。补最小实现：matches 恒 false（system 解析
  // 为 light）、监听记账 no-op——不派发 change。需要翻转 matches 断言 system 态的用例在各自
  // 文件以可编程桩 defineProperty 替换（条件式赋值同上，不遮蔽真实现）。
  if (typeof window.matchMedia !== 'function') {
    const stubMql = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      addListener: (): void => {},
      removeListener: (): void => {},
      onchange: null,
      dispatchEvent: (): boolean => false,
    };
    window.matchMedia = (): MediaQueryList => stubMql as unknown as MediaQueryList;
  }
}
