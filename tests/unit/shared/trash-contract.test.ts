// 回收站契约 schema 的合法/非法边界（A.7-5：schema 即字段级规格）。
// 契约实体落 vfs-contract.ts（trash 属 VFS 软删除域：通道名 vfs:list-trashed、trash 请求与
// 广播事件均已在 vfs-contract，单一来源就近不另立文件——裁决理由见 task-4-report），
// 本文件按 brief 规划以回收站域为名组织其契约用例。
import { describe, expect, it } from 'vitest';
import { TrashedNodeMetaSchema } from '../../../src/shared/vfs-contract';

describe('TrashedNodeMeta 契约 schema', () => {
  // 合法 NodeMeta 底样（形态与 vfs-contract.test.ts NodeMetaSchema 用例同源）
  const meta = {
    id: 5,
    parentId: 1,
    nodeType: 'file',
    name: 'a.html',
    virtualPath: '/a.html',
    mimeType: 'text/html',
    size: 3,
    createdAt: '2026-09-16T10:00:00.000+08:00',
    updatedAt: '2026-09-16T10:00:00.000+08:00',
  };

  it('合法条目（meta 满足 NodeMeta + deletedAt 字符串）通过校验', () => {
    const parsed = TrashedNodeMetaSchema.safeParse({
      meta,
      deletedAt: '2026-09-21T09:30:00.000+08:00',
    });
    expect(parsed.success).toBe(true);
  });

  it('meta 不满足 NodeMetaSchema → 拒绝（nodeType 越界）', () => {
    const parsed = TrashedNodeMetaSchema.safeParse({
      meta: { ...meta, nodeType: 'link' },
      deletedAt: '2026-09-21T09:30:00.000+08:00',
    });
    expect(parsed.success).toBe(false);
  });

  it('deletedAt 缺失或非字符串 → 拒绝', () => {
    expect(TrashedNodeMetaSchema.safeParse({ meta }).success).toBe(false);
    expect(TrashedNodeMetaSchema.safeParse({ meta, deletedAt: 123 }).success).toBe(false);
  });
});
