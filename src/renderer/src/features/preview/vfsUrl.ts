// vfs URL 构造单一来源（spec §3.1）：virtual_path 自带前导 '/'，与协议解析（vfsParse）同形态
export function vfsUrl(virtualPath: string): string {
  return 'vfs://' + virtualPath;
}
