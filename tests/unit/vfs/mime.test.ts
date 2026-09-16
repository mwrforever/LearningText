// MIME 映射与 FTS 文本判定（spec §7.2/§7.7）
import { describe, expect, it } from 'vitest';
import { isTextualMime, lookupMimeType } from '../../../src/main/vfs/mime';

describe('lookupMimeType', () => {
  it('常见扩展名映射', () => {
    expect(lookupMimeType('index.html')).toBe('text/html');
    expect(lookupMimeType('page.htm')).toBe('text/html');
    expect(lookupMimeType('style.css')).toBe('text/css');
    expect(lookupMimeType('app.js')).toBe('text/javascript');
    expect(lookupMimeType('data.json')).toBe('application/json');
    expect(lookupMimeType('pic.PNG')).toBe('image/png');
    expect(lookupMimeType('a.tar.gz')).toBe('application/gzip'); // 取最后扩展名
  });

  it('无扩展名与未识别类型回退 octet-stream', () => {
    expect(lookupMimeType('README')).toBe('application/octet-stream');
    expect(lookupMimeType('x.unknown')).toBe('application/octet-stream');
  });
});

describe('isTextualMime', () => {
  it('text/* 与 json/javascript 为文本，二进制为否', () => {
    expect(isTextualMime('text/html')).toBe(true);
    expect(isTextualMime('text/css')).toBe(true);
    expect(isTextualMime('application/json')).toBe(true);
    expect(isTextualMime('application/javascript')).toBe(true);
    expect(isTextualMime('image/png')).toBe(false);
    expect(isTextualMime('application/octet-stream')).toBe(false);
    expect(isTextualMime('application/pdf')).toBe(false);
  });
});
