// app:// 协议处理器测试：资源命中走 net.fetch、缺失/路径穿越转 404（B.5-2 只读资源出口）。
// appProtocol.ts 在模块加载时经 app.getAppPath() 计算产物根目录，故先建 fixture 再动态导入。
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  // 应用根目录在 appProtocol 模块加载时求值（产物根 = <appRoot>/dist/renderer），先占位、beforeAll 填入
  appRoot: '',
  netFetch: vi.fn<(url: string, init?: { headers: Record<string, string> }) => Promise<Response>>(),
}));

vi.mock('electron', () => ({
  app: { getAppPath: () => fixture.appRoot },
  net: { fetch: fixture.netFetch },
}));

describe('app:// 协议处理器 handleAppResource', () => {
  let handleAppResource: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    fixture.appRoot = mkdtempSync(path.join(tmpdir(), 'app-dist-'));
    const distRoot = path.join(fixture.appRoot, 'dist', 'renderer');
    mkdirSync(path.join(distRoot, 'assets'), { recursive: true });
    writeFileSync(path.join(distRoot, 'index.html'), '<html></html>');
    writeFileSync(path.join(distRoot, 'assets', 'a.js'), 'console.log(1)');
    ({ handleAppResource } = await import('../../../src/main/protocol/appProtocol.ts'));
  });

  it('存在的资源以 file:// + Content-Type 交由 net.fetch 取回', async () => {
    const stub = new Response('stub-body');
    fixture.netFetch.mockResolvedValue(stub);

    const response = await handleAppResource(new Request('app://bundle/assets/a.js'));

    // 响应必须原样透传 net.fetch 的结果，不得二次加工
    expect(response).toBe(stub);
    expect(fixture.netFetch).toHaveBeenCalledWith(
      'file://' + path.join(fixture.appRoot, 'dist', 'renderer', 'assets', 'a.js'),
      { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } },
    );
  });

  it('不存在的资源返回 404 且不触发文件系统读取', async () => {
    const response = await handleAppResource(new Request('app://bundle/missing.js'));

    expect(response.status).toBe(404);
    expect(fixture.netFetch).not.toHaveBeenCalled();
  });

  it('百分号编码的路径穿越（%2e%2e）解码后拒绝并返回 404', async () => {
    const response = await handleAppResource(new Request('app://bundle/%2e%2e/secret.txt'));

    expect(response.status).toBe(404);
    expect(fixture.netFetch).not.toHaveBeenCalled();
  });
});
