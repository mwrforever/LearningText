// app:// 协议处理器：仅把 dist/renderer 产物以只读方式暴露给渲染层（B.5-2）
import path from 'node:path';
import { app, net } from 'electron';
import { resolveAppPath } from './appPaths';

/** 渲染产物根目录：<安装目录>/dist/renderer */
const distRoot = path.join(app.getAppPath(), 'dist', 'renderer');

/** protocol.handle 处理器：资源缺失或越界一律 404，不泄露文件系统信息 */
export function handleAppResource(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const resource = resolveAppPath(url.pathname, distRoot);
  if (resource === null) {
    return Promise.resolve(new Response('Not Found', { status: 404 }));
  }
  return net.fetch('file://' + resource.abs, {
    headers: { 'Content-Type': resource.contentType },
  });
}
