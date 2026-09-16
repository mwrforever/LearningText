// 扩展名 → MIME 映射（spec §7.2）：VFS 元数据与 M3 vfs:// 协议共用此表保证一致
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
};

/** 按文件名最后一段扩展名取 MIME；未识别回退 octet-stream */
export function lookupMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_BY_EXT[fileName.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/** FTS body 提取判定（spec §7.7）：仅文本类 MIME 入全文索引，二进制 body 为空串 */
export function isTextualMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/xml'
  );
}
