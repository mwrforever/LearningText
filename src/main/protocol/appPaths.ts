// app:// 静态资源路径解析（纯函数，禁止 import electron，保证可单测）
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 扩展名 → Content-Type 映射；未命中返回 null，由协议层转 404 */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface AppResource {
  /** 文件绝对路径 */
  abs: string;
  /** 响应 Content-Type */
  contentType: string;
}

/**
 * 将 app:// 的 URL pathname 解析为 dist 内的文件路径。
 * 返回 null 表示拒绝（路径穿越 / 不存在），由协议层转 404。
 * @param pathname 如 "/" 或 "/assets/a.js"（已去掉 query/hash）
 * @param distRoot 渲染产物根目录（绝对路径）
 */
export function resolveAppPath(pathname: string, distRoot: string): AppResource | null {
  // URL 解码后校验：防 %2e%2e 形式的穿越
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  const abs = path.resolve(distRoot, relative);
  // 解析结果必须仍落在 distRoot 内（B.5-2：禁逃逸 VFS/产物目录）
  if (abs !== distRoot && !abs.startsWith(distRoot + path.sep)) {
    return null;
  }
  // 文件必须真实存在，不存在返回 null 由协议层转 404
  if (!existsSync(abs)) {
    return null;
  }
  const contentType = CONTENT_TYPES[path.extname(abs).toLowerCase()];
  if (contentType === undefined) {
    return null;
  }
  return { abs, contentType };
}
