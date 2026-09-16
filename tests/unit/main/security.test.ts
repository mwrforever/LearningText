// origin 白名单判断必须用 URL 解析器比较（宪法 B.5-4：禁字符串前缀判断）
import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../../../src/main/security';

const allowed = ['app://bundle', 'http://localhost:5173'];

describe('isOriginAllowed', () => {
  it('白名单 origin 放行', () => {
    expect(isOriginAllowed('app://bundle/index.html', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173/foo?x=1', allowed)).toBe(true);
  });

  it('同源不同路径或大小写 host 不构成绕过，仍按 origin 精确匹配', () => {
    expect(isOriginAllowed('http://LOCALHOST:5173/', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173.evil.com/', allowed)).toBe(false);
    expect(isOriginAllowed('https://localhost:5173/', allowed)).toBe(false);
  });

  it('非白名单 origin 与不可解析 URL 一律拒绝', () => {
    expect(isOriginAllowed('file:///etc/passwd', allowed)).toBe(false);
    expect(isOriginAllowed('javascript:alert(1)', allowed)).toBe(false);
    expect(isOriginAllowed('not a url', allowed)).toBe(false);
  });
});
