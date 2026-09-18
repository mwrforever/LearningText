/**
 * vfs:// 请求解析纯函数（M3 spec §2.2/§2.3、§3.2）：URL 身份→虚拟路径、Range/ETag
 * 语义判定、预览 CSP 常量。零依赖不触库，HTTP 响应组装归 vfsProtocol。
 */

export type VfsPathResult =
  { readonly kind: 'file'; readonly virtualPath: string } | { readonly kind: 'invalid' };

/**
 * 解析 vfs:// URL 为虚拟路径（spec §2.2-3 单机制收口版）：
 * - 字面点段与规范编码点段由 WHATWG URL 解析器（Node 24 与 Chromium 同构）在
 *   path state 以**同一机制**先行归一且**不越根**——逃逸面在解析期闭合；
 * - 穷举证明：解码为 '.'/'..' 的原始段必属解析器识别的点段规范形态组合
 *   （'.'/%2e 与 '../.%2e'/'%2e.'/'%2e%2e'，ASCII 大小写不敏感），**点段不可达处理器**，
 *   故循环内不设点段检查；多点混合形态（如 `.%2e.`）解码为 `...` 非点段，按普通段名
 *   放行，查库不中即 404（探针实证见 task-3-report §七）；
 * - 残防线仅剩可达分支，一律 invalid、**不做 clamp、越界归一后查库不中即 404**：
 *   空段（连续斜杠/尾斜杠）、根请求（vfs:///，目录形态）、非法百分号编码（URIError）、
 *   host 非空（身份只认路径，standard scheme 空 host 形态）；
 * - 先按原始 '/' 分段再逐段 decode——%2F 不得充当路径分隔符；
 *   query/fragment 由 URL 解析天然剥离。
 * 段内 decode 出 '/'（%2F 场景）不在此拒绝——查库不中即 404，库路径无裸 %2F 形态。
 */
export function parseVfsUrl(rawUrl: string): VfsPathResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.hostname !== '') return { kind: 'invalid' };
  const parts = url.pathname.split('/');
  // standard scheme 的绝对路径首段恒空串（根标记），非段内容——弹出后逐段校验
  if (parts[0] === '') parts.shift();
  else return { kind: 'invalid' };
  try {
    for (let i = 0; i < parts.length; i += 1) {
      const seg = decodeURIComponent(parts[i] ?? '');
      // 点段已穷举证明不可达（见函数 doc），残防线只留空段拒绝（404 目录形态）
      if (seg === '') return { kind: 'invalid' };
      parts[i] = seg;
    }
  } catch {
    return { kind: 'invalid' }; // 截断编码序列（URIError）
  }
  if (parts.length === 0) return { kind: 'invalid' }; // 根请求 vfs:/// 属目录形态，404
  return { kind: 'file', virtualPath: '/' + parts.join('/') };
}

export type RangeResult =
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

/**
 * 单区间 Range 解析（spec §2.3 D7）：仅支持 `bytes=a-b`/`a-`/`-n` 三形态；
 * 多区间、非 bytes、语法残缺 → full（忽略 Range 按 200，RFC 7233 允许的降级）；
 * 语法合法但不可满足（start≥size / start>end / 后缀 0）→ unsatisfiable（416）。
 * @param header 原始 Range 头值（无头传 null）
 * @param size 目标资源总字节数
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: 'full' };
  const single = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (single === null) return { kind: 'full' };
  const rawStart = single[1] ?? '';
  const rawEnd = single[2] ?? '';
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (rawStart === '') {
    // 后缀区间：末 N 字节（N 超过 size 钳到全文；0 不可满足）
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: 'unsatisfiable' };
    const length = Math.min(suffix, size);
    if (length === 0) return { kind: 'unsatisfiable' }; // 空文档
    return { kind: 'partial', start: size - length, end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'partial', start, end };
}

/** 弱校验器（spec §2.3 D6）：content_hash 由 createNode/writeFile 写路径算好入库，响应只读拼接 */
export function etagOf(contentHash: string): string {
  return `W/"${contentHash}"`;
}

/** If-None-Match 弱比较（RFC 7232 §2.3.2：忽略 W/ 强弱标签差异，支持逗号列表与 *） */
export function ifNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === '*') return true;
  const want = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((item) => item.trim().replace(/^W\//, ''))
    .includes(want);
}

/**
 * 预览文档 CSP（spec §3.2 D2/D8，评审钉死；仅 text/html 响应注入）：
 * 资源仅 vfs: + 断外链（防外泄主力）；inline script/style 保留（海量 demo 常态，
 * 真实防线是 opaque origin + connect-src vfs: + 断外链）。
 */
export const VFS_HTML_CSP = [
  "default-src 'none'",
  "script-src vfs: 'unsafe-inline'",
  "style-src vfs: 'unsafe-inline'",
  'img-src vfs: data: blob:',
  'font-src vfs: data:',
  'media-src vfs: data: blob:',
  'connect-src vfs:',
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  'base-uri vfs:',
].join('; ');
