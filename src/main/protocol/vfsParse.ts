/**
 * vfs:// 请求解析纯函数（M3 spec §2.2/§2.3、§3.2）：URL 身份→虚拟路径、Range/ETag
 * 语义判定、预览 CSP 常量。零依赖不触库，HTTP 响应组装归 vfsProtocol。
 */
import { VFS_URL_HOST } from '../../shared/vfs-contract';

export type VfsPathResult =
  { readonly kind: 'file'; readonly virtualPath: string } | { readonly kind: 'invalid' };

/**
 * 解析 vfs:// URL 为虚拟路径（spec §2.2-3 单机制收口版；身份为固定 host 约定形态 `vfs://local/…`）：
 * - 身份只认约定 host `local`（shared VFS_URL_HOST，大小写不敏感归一）：Task 8 E2E 探针
 *   实证 Blink（GURL）对 standard scheme 的空 authority 形态做「首段提为 host」规范化
 *   （`vfs:///probe.html` → `vfs://probe.html/`），与 Node WHATWG URL 不同构，空 host
 *   路径式在导航链路不可达——故渲染层产出侧与本解析侧统一钉死固定 host，其余一切 host
 *   （空 host 形态、`vfs://evil/…` 等伪造 host）一律 invalid（拒绝语义保留）；
 * - 字面点段与规范编码点段由 WHATWG URL 解析器（Node 24 与 Chromium 同构）在
 *   path state 以**同一机制**先行归一且**不越根**——逃逸面在解析期闭合；
 * - 穷举证明：解码为 '.'/'..' 的原始段必属解析器识别的点段规范形态组合
 *   （'.'/%2e 与 '../.%2e'/'%2e.'/'%2e%2e'，ASCII 大小写不敏感），**点段不可达处理器**，
 *   故循环内不设点段检查；多点混合形态（如 `.%2e.`）解码为 `...` 非点段，按普通段名
 *   放行，查库不中即 404（探针实证见 task-3-report §七）；
 * - 残防线仅剩可达分支，一律 invalid、**不做 clamp、越界归一后查库不中即 404**：
 *   空段（连续斜杠/尾斜杠）、根请求（vfs://local/，目录形态）、非法百分号编码（URIError）、
 *   host 非约定值（见首条）；
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
  // 身份门：host 必须等于约定值，其余（空 host、伪造 host）全拒；GURL 对 standard
  // scheme 的 host 本就规范化为小写，toLowerCase 为跨端防御性归一（见函数 doc 首条）
  if (url.hostname.toLowerCase() !== VFS_URL_HOST) return { kind: 'invalid' };
  const parts = url.pathname.split('/');
  // 约定 host 在场时 pathname 恒为空串（裸 host 形态 vfs://local）或以 '/' 开头
  // （WHATWG path-or-authority state 保证），split 后首段恒为根标记空串——直接弹出；
  // 旧「首段非根标记 → invalid」分支因 host 身份门收口后不可达，按无死分支纪律不设 else
  parts.shift();
  // for...of 迭代元素类型恒为 string，免除下标收窄 ?? '' 的不可覆盖死侧；解码结果
  // 累积到新数组而非写回 parts（行为与原逐段写回完全一致）
  const decoded: string[] = [];
  try {
    for (const raw of parts) {
      const seg = decodeURIComponent(raw);
      // 点段已穷举证明不可达（见函数 doc），残防线只留空段拒绝（404 目录形态）
      if (seg === '') return { kind: 'invalid' };
      decoded.push(seg);
    }
  } catch {
    return { kind: 'invalid' }; // 截断编码序列（URIError）
  }
  if (decoded.length === 0) return { kind: 'invalid' }; // 空 pathname（裸 host 形态 vfs://local）无任何段；根请求 vfs://local/ 已被上方空段检查拦截；裸 scheme（vfs://）与空 host 形态已被 host 身份门拦截，均到不了这里
  return { kind: 'file', virtualPath: '/' + decoded.join('/') };
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
  // 手工解析（前缀 startsWith → 连字符 indexOf → 两段 slice）替代正则捕获组提取：
  // 捕获组下标在 noUncheckedIndexedAccess 下的收窄（?? ''）产生不可覆盖死侧，
  // 违反无死分支纪律；判定语义与原 `/^bytes=(\d*)-(\d*)$/` 整串匹配逐项等价
  if (!header.startsWith('bytes=')) return { kind: 'full' }; // 非 bytes 单位
  const spec = header.slice('bytes='.length);
  const hyphen = spec.indexOf('-');
  if (hyphen === -1) return { kind: 'full' }; // 无连字符，区间语法残缺
  const rawStart = spec.slice(0, hyphen);
  const rawEnd = spec.slice(hyphen + 1);
  // 两端须为纯数字（允许空串）：含非数字（多区间逗号形态、多连字符等残缺形态）→ full
  if (!/^\d*$/.test(rawStart) || !/^\d*$/.test(rawEnd)) return { kind: 'full' };
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
