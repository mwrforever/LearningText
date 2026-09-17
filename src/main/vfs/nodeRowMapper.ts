// 节点行 → NodeMeta 映射的单一实现，vfs/search 共用（自 vfsService 原样迁出，DRY 收口）；
// 读模型 ≠ 存储行 ≠ 请求 DTO，各自建模（宪法 A.7-4）
import type { NodeMeta } from '../../shared/vfs-contract';

/** node 表读取行形态：snake_case 列名与存储行一致，各查询按需附加额外列后结构类型兼容 */
export interface NodeRow {
  id: number;
  parent_id: number | null;
  node_type: string;
  name: string;
  virtual_path: string;
  mime_type: string | null;
  size: number;
  created_at: string;
  updated_at: string;
}

/** 存储行 → 读模型：字段改名 + node_type 字面量收窄，多余列（如 content/deleted_at）不参与映射 */
export function toNodeMeta(row: NodeRow): NodeMeta {
  return {
    id: row.id,
    parentId: row.parent_id,
    nodeType: row.node_type === 'dir' ? 'dir' : 'file',
    name: row.name,
    virtualPath: row.virtual_path,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
