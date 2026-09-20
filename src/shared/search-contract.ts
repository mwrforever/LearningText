/**
 * 搜索域 IPC 契约（宪法 A.7-5 单一来源）：请求/响应 DTO + zod schema（spec §6）。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD，schema 不做逐字段消息定制。
 */
import { z } from 'zod';
import { NodeMetaSchema, type NodeMeta } from './vfs-contract';

/** 每页命中数默认（spec §5） */
export const SEARCH_LIMIT_DEFAULT = 50;
/** 每页命中数硬上限（spec §5） */
export const SEARCH_LIMIT_MAX = 200;
/** 查询词项数上限（超限整条拒绝，spec §4） */
export const MAX_SEARCH_TERMS = 8;
/** 单词项码点长度上限（与名称长度上限量级一致） */
export const MAX_SEARCH_TERM_CODEPOINTS = 255;

/** 命中区间：text 内 JS UTF-16 码元偏移，[start, end) 半开（spec §6） */
export const SearchHitRangeSchema = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});
export interface SearchHitRange {
  readonly start: number;
  readonly end: number;
}

/** 命中片段：纯文本 + 命中区间，零 HTML（渲染器 M4 按区间套样式） */
export const SnippetSchema = z.strictObject({
  text: z.string(),
  ranges: z.array(SearchHitRangeSchema),
});
export interface Snippet {
  readonly text: string;
  readonly ranges: readonly SearchHitRange[];
}

/** 命中列归属 schema（单一来源）：仅文件名 / 仅正文 / 两列皆有（M2 双源收口——值域唯一声明点） */
export const MatchInSchema = z.enum(['name', 'body', 'both']);
/** 命中列归属：由 MatchInSchema 派生（z.infer），手写联合已收口，两处漂移不再可能 */
export type MatchIn = z.infer<typeof MatchInSchema>;

export const SearchFiltersSchema = z.strictObject({
  /** 类型白名单（FR-SEARCH-03）；空数组语义非法（min(1)） */
  nodeTypes: z
    .array(z.enum(['dir', 'file']))
    .min(1)
    .optional(),
  /** 子树限定：虚拟路径（解析失败 E_VFS_NOT_FOUND，复用既有码，spec §6） */
  underPath: z.string().min(1).optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const SearchQueryRequestSchema = z.strictObject({
  /** 原始查询串：分词/规范化在服务层（spec §4） */
  keyword: z.string(),
  filters: SearchFiltersSchema.optional(),
  /** 省略取默认 50；超限由服务层截断为 200（spec §5 截断语义），SEARCH_LIMIT_MAX 供服务层钳制 */
  limit: z.number().int().min(1).optional(),
  offset: z.number().int().min(0).optional(),
});
export type SearchQueryRequest = z.infer<typeof SearchQueryRequestSchema>;

export const SearchHitSchema = z.strictObject({
  node: NodeMetaSchema,
  matchIn: MatchInSchema,
  /** 相关性分数（bm25 越小越优）；LIKE 回退通道无分数 → null（spec §5） */
  score: z.number().nullable(),
  /** 名称片段：全文本 + 命中区间（≤255 码点无需窗口化，spec §6） */
  nameSnippet: SnippetSchema,
  /** 正文片段：索引通道 snippet / 回退通道窗口截取；仅名称命中或目录为 null */
  bodySnippet: SnippetSchema.nullable(),
});
export interface SearchHit {
  readonly node: NodeMeta;
  readonly matchIn: MatchIn;
  readonly score: number | null;
  readonly nameSnippet: Snippet;
  readonly bodySnippet: Snippet | null;
}

export const SearchQueryResponseSchema = z.strictObject({
  hits: z.array(SearchHitSchema),
  /** 命中总数（精确 COUNT，含未翻页部分，spec §5） */
  total: z.number().int().min(0),
  /** 还有未返回的命中（offset + hits.length < total） */
  truncated: z.boolean(),
});
export interface SearchQueryResponse {
  readonly hits: readonly SearchHit[];
  readonly total: number;
  readonly truncated: boolean;
}
