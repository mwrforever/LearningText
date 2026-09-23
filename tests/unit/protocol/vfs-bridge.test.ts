// @vitest-environment jsdom
// 注入桥编辑态序列化记账还原（蓝图 §1.4 必修项 + §八 R2 强制自动化覆盖）：
// 在 jsdom 顶层文档真实执行注入体，驱动 lt:edit-enter/exit 与 input 事件，断言
// ltSerialize 输出对「用户文档自带 contenteditable」逐字节保真（原值还原、不误删）、
// 桥自有注入物（data-lt-* / 注入 style / data-lt-injected 脚本）全部剥离、编辑期
// 活文档还原（exit 后 DOM 与进入前一致）。捕获面：parent === window（jsdom 顶层），
// 以 postMessage spy 截获 lt:doc-edit / lt:edit-state 载荷，避免真实消息回流。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectPreviewReceiver } from '../../../src/main/protocol/vfsProtocol';

/** 从注入产物中取出桥脚本体（与集成测试编译守卫同一切片法：开标签「>」后至真实闭合标签前） */
function receiverScript(): string {
  const receiver = injectPreviewReceiver('');
  const closingTag = '</' + 'script>';
  const bodyStart = receiver.indexOf('>') + 1;
  return receiver.slice(bodyStart, receiver.length - closingTag.length);
}

/** 向桥派发父→子消息（桥监听 window message，不校验来源） */
function sendToBridge(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: window }));
}

let outbound: Array<Record<string, unknown>>;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  outbound = [];
  vi.restoreAllMocks();
  // 单会话：桥在每个文件的 jsdom window 上只能装一次（IIFE 监听器不可注销），
  // 各场景以「重置 DOM → 重新进入编辑态」分阶段推进
  vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown) => {
    outbound.push(data as Record<string, unknown>);
  }) as typeof window.postMessage);
  window.eval(receiverScript());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 取最近一次 lt:doc-edit 载荷的 html（无则失败，断言可读性） */
function getLastDocEditHtml(): string {
  const calls = (window.postMessage as ReturnType<typeof vi.spyOn>).mock.calls;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const payload = calls[i]?.[0] as { type?: string; html?: string } | undefined;
    if (payload?.type === 'lt:doc-edit' && typeof payload.html === 'string') return payload.html;
  }
  throw new Error('未捕获任何 lt:doc-edit 上报');
}

describe('注入桥序列化记账还原（M9 蓝图 R2）', () => {
  it('自带 contenteditable 保真 + 多目标切换记账还原 + 注入物剥离 + 退出活 DOM 还原', () => {
    // —— 场景一：用户文档自带 contenteditable 原值保真 ——
    document.head.innerHTML = '<title>桥序列化</title>';
    document.body.innerHTML =
      '<div id="user-edit" contenteditable="true" spellcheck="true"><p>用户可编辑区</p></div>' +
      '<p id="plain">静态正文</p>';
    sendToBridge({ type: 'lt:edit-enter' });
    expect(document.documentElement.getAttribute('data-lt-editing')).toBe('1');
    expect(document.body.getAttribute('contenteditable')).toBe('true');
    expect(document.body.getAttribute('spellcheck')).toBe('false');
    document.body.dispatchEvent(new Event('input'));
    let html = getLastDocEditHtml();
    expect(html).toContain('<div id="user-edit" contenteditable="true" spellcheck="true">');
    expect(html).not.toContain('data-lt-');
    expect(html).not.toContain('data-lt-injected');
    sendToBridge({ type: 'lt:edit-exit' });
    expect(document.body.hasAttribute('contenteditable')).toBe(false);
    expect(document.body.hasAttribute('spellcheck')).toBe(false);
    expect(document.documentElement.hasAttribute('data-lt-editing')).toBe(false);
    expect(document.querySelector('style[data-lt-injected]')).toBeNull();
    expect(document.querySelector('#user-edit')?.getAttribute('contenteditable')).toBe('true');
    expect(document.querySelector('#user-edit')?.getAttribute('spellcheck')).toBe('true');

    // —— 场景二：多目标切换记账还原 + hover 标记不残留 ——
    document.body.innerHTML = '<p id="a">甲段</p><p id="b">乙段</p>';
    sendToBridge({ type: 'lt:edit-enter' });
    document
      .querySelector('#a')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 8, clientY: 8 }));
    expect(document.querySelector('#a')?.hasAttribute('contenteditable')).toBe(true);
    expect(document.body.hasAttribute('contenteditable')).toBe(false);
    document.querySelector('#b')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    document.querySelector('#a')?.dispatchEvent(new Event('input'));
    html = getLastDocEditHtml();
    expect(html).not.toContain('data-lt-hover');
    expect(html).not.toContain('data-lt-active');
    expect(html).not.toContain('data-lt-editing');
    expect(html).not.toContain('<body contenteditable');
    sendToBridge({ type: 'lt:edit-exit' });
    expect(document.querySelector('#a')?.hasAttribute('contenteditable')).toBe(false);
    expect(document.body.hasAttribute('contenteditable')).toBe(false);
    expect(document.querySelectorAll('[data-lt-touched]').length).toBe(0);

    // —— 场景三：无编辑的 enter→input→exit 循环不改文档内容形态 ——
    document.body.innerHTML = '<p id="x">正文</p>';
    sendToBridge({ type: 'lt:edit-enter' });
    document.body.dispatchEvent(new Event('input'));
    html = getLastDocEditHtml();
    expect(html).toContain('<p id="x">正文</p>');
    expect(html).not.toContain('contenteditable="true" contenteditable');
    sendToBridge({ type: 'lt:edit-exit' });
    expect(document.body.innerHTML).toBe('<p id="x">正文</p>');
    expect(document.querySelectorAll('[data-lt-injected]').length).toBe(0);
  });
});
