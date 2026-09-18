// vfs URL 构造单一来源（spec §3.1：src 形态与协议解析同源，路径自带前导 '/'）
import { describe, expect, it } from 'vitest';
import { vfsUrl } from '../../../src/renderer/src/features/preview/vfsUrl';

describe('vfsUrl', () => {
  it('虚拟路径直接拼接 scheme 与空 host（standard scheme 规范形态）', () => {
    expect(vfsUrl('/笔记/web/index.html')).toBe('vfs:///笔记/web/index.html');
  });
});
