// 媒体可预览 MIME 判定（M5 批次⑦ Task 14，FR-EDIT-04 + spec §8/D20）：
// openFile 分流与 PreviewPanel mime 分支共用的唯一判定点（渲染层纯函数，与主进程
// isTextualMime 同为域内判定，B.2 禁跨层 import）。落位 features/preview/ 与 vfsUrl 同域：
// 消费方为 Workspace（分流）与 PreviewPanel（呈现分支），预览域是两者公共祖先。
// 判定取 image/* / audio/* 前缀（spec §8 字面）：主进程 mime 推导表（vfs/mime.ts）落库的
// 图片族（png/jpeg/gif/webp/svg/avif/x-icon）与音频族（mpeg/wav/ogg…）尽收，video/pdf 等
// 其余二进制一律 null 维持拒开 toast。

/** 可预览媒体形态：'image' 走 <img>、'audio' 走 <audio controls>；null=不可预览 */
export type PreviewableKind = 'image' | 'audio';

/**
 * 判定 MIME 是否可只读预览及其呈现形态。
 * @param mimeType 节点 MIME（NodeMeta.mimeType，目录恒为 null 由调用方先行排除）
 * @returns 'image'=图片族（img 呈现）；'audio'=音频族（audio 呈现）；null=不可预览（拒开语义）
 */
export function previewableMime(mimeType: string): PreviewableKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}
