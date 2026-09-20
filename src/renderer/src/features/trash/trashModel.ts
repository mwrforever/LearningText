/**
 * 回收站本地过滤纯函数（M5 批次②）：关键词对「名称 / 原路径」做 NFC 规范化 + 小写化后的
 * 包含匹配。两侧同规则归一的原因：文件名入库前已 NFC（NodeMeta 契约），而关键词来自渲染端
 * 输入法/剪贴板，可能是 NFD 分解形——不归一会在 macOS 等分解形态来源下漏配；小写化使
 * 大小写仅作呈现差异不作匹配差异。纯函数无副作用，Workspace/TrashPanel 均可复用。
 */
import type { TrashedNodeMeta } from '../../../../shared/vfs-contract';

/**
 * 按关键词过滤回收站条目。
 * @param list 回收站全量条目（只读，不过滤时原引用直返，不做复制）
 * @param keyword 用户输入的过滤词；空串（NFC 归一后）视为不过滤
 * @returns 命中「名称或原路径包含关键词」的条目；无命中返回空数组
 */
export function filterTrashed(
  list: readonly TrashedNodeMeta[],
  keyword: string,
): readonly TrashedNodeMeta[] {
  const needle = keyword.normalize('NFC').toLowerCase();
  // 空关键词短路：语义即全量，避免逐条做无谓的归一与包含匹配
  if (needle === '') return list;
  return list.filter(
    (item) =>
      item.meta.name.normalize('NFC').toLowerCase().includes(needle) ||
      item.meta.virtualPath.normalize('NFC').toLowerCase().includes(needle),
  );
}
