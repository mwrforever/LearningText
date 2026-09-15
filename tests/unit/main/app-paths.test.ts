// app:// 路径解析纯函数测试：路径穿越防护是 B.5-2 安全基线的落地断言
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppPath } from '../../../src/main/protocol/appPaths';

const distRoot = mkdtempSync(path.join(tmpdir(), 'app-dist-'));
mkdirSync(path.join(distRoot, 'assets'), { recursive: true });
writeFileSync(path.join(distRoot, 'index.html'), '<html></html>');
writeFileSync(path.join(distRoot, 'assets', 'a.js'), 'console.log(1)');

describe('app:// 虚拟路径解析', () => {
  it('根路径映射到 index.html，Content-Type 为 text/html', () => {
    const r = resolveAppPath('/', distRoot);
    expect(r?.abs).toBe(path.join(distRoot, 'index.html'));
    expect(r?.contentType).toBe('text/html; charset=utf-8');
  });

  it('子目录资源按相对路径解析', () => {
    const r = resolveAppPath('/assets/a.js', distRoot);
    expect(r?.abs).toBe(path.join(distRoot, 'assets', 'a.js'));
    expect(r?.contentType).toBe('text/javascript; charset=utf-8');
  });

  it('路径穿越（..）返回 null 拒绝', () => {
    expect(resolveAppPath('/../secret.txt', distRoot)).toBeNull();
  });

  it('不存在的文件返回 null（协议层转 404）', () => {
    expect(resolveAppPath('/nope.html', distRoot)).toBeNull();
  });
});
