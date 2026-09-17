// 契约 schema 的合法/非法边界（A.7-5：schema 即字段级规格）
import { describe, expect, it } from 'vitest';
import {
  CreateNodeRequestSchema,
  ListChildrenRequestSchema,
  NodeMetaSchema,
  ResolvePathRequestSchema,
} from '../../../src/shared/vfs-contract';

describe('VFS 契约 schema', () => {
  it('listChildren 接受 parentId 或 virtualPath 二选一', () => {
    expect(ListChildrenRequestSchema.safeParse({ parentId: 1 }).success).toBe(true);
    expect(ListChildrenRequestSchema.safeParse({ virtualPath: '/笔记' }).success).toBe(true);
    expect(ListChildrenRequestSchema.safeParse({}).success).toBe(false);
  });

  it('listChildren 双字段并存或缺一字段一律拒绝（strictObject 互斥，M2 spec §3.3）', () => {
    expect(ListChildrenRequestSchema.safeParse({ parentId: 1 }).success).toBe(true);
    expect(ListChildrenRequestSchema.safeParse({ virtualPath: '/a' }).success).toBe(true);
    expect(ListChildrenRequestSchema.safeParse({ parentId: 1, virtualPath: '/a' }).success).toBe(
      false,
    );
    expect(ListChildrenRequestSchema.safeParse({}).success).toBe(false);
    // strict：多余字段同样拒绝（M1 union 默认 strip 形态的收口）
    expect(ListChildrenRequestSchema.safeParse({ parentId: 1, extra: 2 }).success).toBe(false);
  });

  it('createNode 的 content 仅接受 Uint8Array', () => {
    const payload = { parentId: 1, name: 'a.html', nodeType: 'file' };
    expect(CreateNodeRequestSchema.safeParse(payload).success).toBe(true);
    expect(
      CreateNodeRequestSchema.safeParse({ ...payload, content: new Uint8Array([1]) }).success,
    ).toBe(true);
    expect(CreateNodeRequestSchema.safeParse({ ...payload, content: 'x' }).success).toBe(false);
    expect(
      CreateNodeRequestSchema.safeParse({
        ...payload,
        nodeType: 'dir',
        content: new Uint8Array([1]),
      }).success,
    ).toBe(true); // schema 层不约束组合语义，由服务层校验
  });

  it('resolvePath 拒绝空路径', () => {
    expect(ResolvePathRequestSchema.safeParse({ virtualPath: '' }).success).toBe(false);
  });

  it('NodeMetaSchema 校验元数据形态', () => {
    const meta = {
      id: 2,
      parentId: 1,
      nodeType: 'file',
      name: 'a.html',
      virtualPath: '/a.html',
      mimeType: 'text/html',
      size: 3,
      createdAt: '2026-09-16T10:00:00.000+08:00',
      updatedAt: '2026-09-16T10:00:00.000+08:00',
    };
    expect(NodeMetaSchema.safeParse(meta).success).toBe(true);
    expect(NodeMetaSchema.safeParse({ ...meta, nodeType: 'link' }).success).toBe(false);
  });
});
