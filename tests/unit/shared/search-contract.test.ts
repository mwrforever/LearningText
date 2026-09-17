// 搜索契约 schema 的合法/非法边界（A.7-5：schema 即字段级规格）
import { describe, expect, it } from 'vitest';
import {
  SearchFiltersSchema,
  SearchQueryRequestSchema,
  SearchQueryResponseSchema,
} from '../../../src/shared/search-contract';

describe('搜索契约 schema', () => {
  it('request 接受最小载荷与超限 limit（截断语义，200 恰好上界）并拒绝负 offset/多余字段', () => {
    expect(SearchQueryRequestSchema.safeParse({ keyword: '指数' }).success).toBe(true);
    expect(SearchQueryRequestSchema.safeParse({}).success).toBe(false);
    // spec §5 截断语义：limit>200 不在 schema 拒绝，由服务层截断为 200
    expect(SearchQueryRequestSchema.safeParse({ keyword: 'a', limit: 201 }).success).toBe(true);
    expect(SearchQueryRequestSchema.safeParse({ keyword: 'a', limit: 200 }).success).toBe(true);
    expect(SearchQueryRequestSchema.safeParse({ keyword: 'a', offset: -1 }).success).toBe(false);
    expect(SearchQueryRequestSchema.safeParse({ keyword: 'a', extra: 1 }).success).toBe(false);
  });

  it('filters：空 nodeTypes 与未知类型拒绝；underPath 非空', () => {
    expect(SearchFiltersSchema.safeParse({ nodeTypes: ['file'] }).success).toBe(true);
    expect(SearchFiltersSchema.safeParse({ nodeTypes: [] }).success).toBe(false);
    expect(SearchFiltersSchema.safeParse({ nodeTypes: ['png'] }).success).toBe(false);
    expect(SearchFiltersSchema.safeParse({ underPath: '' }).success).toBe(false);
  });

  it('response 校验嵌套片段与可空字段（score/bodySnippet 显式可空）', () => {
    const hit = {
      node: {
        id: 2,
        parentId: 1,
        nodeType: 'file',
        name: 'a.html',
        virtualPath: '/a.html',
        mimeType: 'text/html',
        size: 3,
        createdAt: '2026-09-17T10:00:00.000+08:00',
        updatedAt: '2026-09-17T10:00:00.000+08:00',
      },
      matchIn: 'both',
      score: -1.5,
      nameSnippet: { text: 'a.html', ranges: [{ start: 0, end: 1 }] },
      bodySnippet: { text: 'ctx指数ctx', ranges: [{ start: 3, end: 5 }] },
    };
    expect(
      SearchQueryResponseSchema.safeParse({ hits: [hit], total: 1, truncated: false }).success,
    ).toBe(true);
    expect(
      SearchQueryResponseSchema.safeParse({
        hits: [{ ...hit, score: null, bodySnippet: null }],
        total: 0,
        truncated: false,
      }).success,
    ).toBe(true);
    expect(
      SearchQueryResponseSchema.safeParse({
        hits: [{ ...hit, score: undefined }],
        total: 0,
        truncated: false,
      }).success,
    ).toBe(false);
  });
});
