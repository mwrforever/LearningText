// vfs URL 构造单一来源（spec §3.1）：virtual_path 自带前导 '/'，与协议解析（vfsParse）同形态
// host 用 shared 约定常量：Task 8 探针实证 Blink 对空 host 路径式做「首段提为 host」规范化，
// 导航链路不可达，故钉死固定 host（三端共享单一来源，与主进程解析侧同锚）
import { VFS_URL_HOST } from '../../../../shared/vfs-contract';

export function vfsUrl(virtualPath: string): string {
  return 'vfs://' + VFS_URL_HOST + virtualPath;
}
