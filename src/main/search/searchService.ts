/**
 * 搜索服务（spec §4–§6）：纯读、无写事务（事务边界唯一归属存储层，B.2-3）；
 * trigram 索引通道（bm25 name10:body1 + 稳定 tie-break）与 LIKE 回退通道（无分数、更新时间序）。
 * 动态形态语句（词数 × 过滤形态）按结构键惰性预编译并缓存——A.4-5 在动态 SQL 下的收口：
 * 每形态仅 prepare 一次并复用，缓存规模上界 8 词 × 3 类型形态 × 2 子树形态；SQL 文本仅拼接
 * 固定片段与 @命名参数占位符，用户数据一律绑定（禁拼原文，A.4-5）。勿删本缓存设计头注。
 */
import { performance } from 'node:perf_hooks';
import type { Statement } from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { E_IPC_BAD_PAYLOAD, E_VFS_NOT_FOUND } from '../../shared/errors';
import { AppError } from '../../shared/result';
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  type SearchFilters,
  type SearchHit,
  type SearchQueryRequest,
  type SearchQueryResponse,
  type Snippet,
} from '../../shared/search-contract';
import { SUBTREE_CTE } from '../vfs/subtreeScope';
import { toNodeMeta, type NodeRow } from '../vfs/nodeRowMapper';
import { buildSearchQuery, type BuiltQuery } from './queryBuilder';
import {
  SNIPPET_WINDOW,
  buildWindowSnippet,
  findTermRanges,
  parseMarkedSnippet,
} from './snippetParser';

/** trigram 通道行：节点元列 + 分数 + 列命中位（列过滤 MATCH 全词口径）+ snippet 标记文本 */
interface TrigramRow extends NodeRow {
  score: number;
  name_hit: number;
  body_hit: number;
  body_marked: string;
}

/** LIKE 通道行：词全命中位 + 正文首词命中窗口（SQL 侧码点窗口，JS 侧算区间） */
interface LikeRow extends NodeRow {
  name_all: number;
  body_all: number;
  win_start: number;
  body_window: string;
  body_len: number;
}

/** 命名绑定包：形态不同键集不同（缺失键=该形态分支不在 SQL 中，多余键被 better-sqlite3 忽略） */
type BindParams = Record<string, string | number>;

/** 预编译语句对：行集与计数语句同形态成对 prepare、成对缓存——单 Map 单判空，
 *  杜绝「行语句已缓存而计数语句未缓存」的不可达分支（Task 6 同类收口先例，29205e3） */
interface StatementPair<Row> {
  readonly rows: Statement<BindParams, Row>;
  readonly count: Statement<BindParams, { c: number }>;
}

/** 过滤形态：类型白名单（排序去重）+ 子树限定标记——SQL 片段与绑定参数的共同来源，
 *  以对象在「缓存键编码」与「绑定」间传递，避免从键字符串回解析引入不可达空值分支 */
interface FilterShape {
  readonly types: readonly string[];
  readonly hasSubtree: boolean;
}

/** 由请求 filters 归一化过滤形态（类型白名单排序去重，保证缓存键与 SQL 形态一一对应） */
function filterShape(filters: SearchFilters | undefined): FilterShape {
  return {
    types: filters?.nodeTypes ? [...new Set(filters.nodeTypes)].sort() : [],
    hasSubtree: filters?.underPath !== undefined,
  };
}

/** 过滤形态 → 缓存结构键（类型已排序去重，键与形态一一对应无碰撞） */
function shapeKey(shape: FilterShape): string {
  return `${shape.types.join(',')}|${shape.hasSubtree ? '1' : '0'}`;
}

/** 命中列归属（spec §6）：两列全词命中 both；单列其位；跨列分散亦 both（行级 AND 已保证每词至少一列） */
function matchInOf(nameAll: boolean, bodyAll: boolean): SearchHit['matchIn'] {
  if (nameAll) return bodyAll ? 'both' : 'name';
  return bodyAll ? 'body' : 'both';
}

function nameSnippet(name: string, terms: readonly string[]): Snippet {
  return { text: name, ranges: findTermRanges(name, terms) };
}

/** LIKE 窗口行 → 片段：省略号规则（窗口起点 >1 前省略；窗口末尾未及正文结尾后省略）；非正文全命中不产片段 */
function windowSnippet(row: LikeRow, terms: readonly string[]): Snippet | null {
  if (row.body_all !== 1) return null;
  const hasPrefix = row.win_start > 1;
  const winChars = [...row.body_window].length;
  const hasSuffix = row.win_start - 1 + winChars < row.body_len;
  return buildWindowSnippet(row.body_window, terms, hasPrefix, hasSuffix);
}

const NODE_COLUMNS = `n.id, n.parent_id, n.node_type, n.name, n.virtual_path, n.mime_type,
        n.size, n.created_at, n.updated_at`;

/** 过滤 WHERE 片段与 CTE 前缀（全部命名参数；无用户数据拼接） */
function filterFragments(shape: FilterShape): { typeFrag: string; subFrag: string; cte: string } {
  const typeFrag =
    shape.types.length === 0
      ? ''
      : shape.types.length === 1
        ? ' AND n.node_type = @t0'
        : ' AND n.node_type IN (@t0, @t1)';
  return {
    typeFrag,
    subFrag: shape.hasSubtree ? ' AND n.id IN (SELECT id FROM subtree)' : '',
    cte: shape.hasSubtree ? `${SUBTREE_CTE}\n    ` : '',
  };
}

/**
 * 创建搜索服务。@param db 主进程存储层单例连接（服务禁自行开连接，M1 spec §2.3）
 * @returns SearchService（query 方法）
 * @throws AppError(E_IPC_BAD_PAYLOAD) 查询构造拒绝（空/超限/引号未闭合）——query() 内抛
 * @throws AppError(E_VFS_NOT_FOUND) underPath 解析不到活节点——query() 内抛
 */
export function createSearchService(db: Database.Database) {
  const stmtPathToId = db.prepare<string, { id: number }>(
    'SELECT id FROM node WHERE virtual_path = ? AND deleted_at IS NULL',
  );
  // 结构键 → 预编译语句对缓存（惰性每形态一次；行/计数成对存取，类型自洽）
  const trigramCache = new Map<string, StatementPair<TrigramRow>>();
  const likeCache = new Map<string, StatementPair<LikeRow>>();

  /**
   * trigram 通道 SQL 对：MATCH @match 行选 + bm25 加权 + snippet 标记 + 稳定排序。
   * 列命中位（全词命中口径，spec §6）经「列过滤 MATCH 物化探针 CTE LEFT JOIN」求得：
   * FTS5 禁止 MATCH 出现在 SELECT 列位（unable to use function MATCH in the requested
   * context），而 snippet 标记语义是「列含任一查询词」，无法表达「列满足整条 AND」；
   * 列过滤串 = name:/body: 前缀 + 复用 @match 短语组（内部引号已由 queryBuilder 按 ""
   * 加倍转义，探针验证列过滤下同一转义规则），无用户数据拼接。探针行集按 rowid 唯一，
   * 无 JOIN 扇出；仅行查询携带（COUNT 不需要命中位）。
   */
  function trigramSqls(shape: FilterShape): { rows: string; count: string } {
    const { typeFrag, subFrag, cte } = filterFragments(shape);
    const where = `WHERE node_fts MATCH @match AND n.deleted_at IS NULL${typeFrag}${subFrag}`;
    // 列命中探针必须显式物化（AS MATERIALIZED）：FTS5 虚表派生表不满足 SQLite 自动物化
    // 条件，普通 FROM 派生表 LEFT JOIN 会被查询计划按外层命中行逐行重扫 MATCH（万级全命中
    // 实测 3s/查询，超 NFR-03 P95 红线 15 倍；红线由 tests/integration/search/perf-baseline.test.ts
    // 锁死），物化后每探针仅执行一次（毫秒级），命中位/分数/片段语义逐字段不变
    const probeCtes = `nm(rowid) AS MATERIALIZED (SELECT rowid FROM node_fts WHERE node_fts MATCH @nameMatch),
       bd(rowid) AS MATERIALIZED (SELECT rowid FROM node_fts WHERE node_fts MATCH @bodyMatch)`;
    return {
      count: `${cte}SELECT COUNT(*) AS c FROM node_fts
     JOIN node n ON n.id = node_fts.rowid
     ${where}`,
      rows: `${shape.hasSubtree ? `${SUBTREE_CTE}, ${probeCtes}` : `WITH ${probeCtes}`}
     SELECT ${NODE_COLUMNS}, bm25(node_fts, 10.0, 1.0) AS score,
       (nm.rowid IS NOT NULL) AS name_hit, (bd.rowid IS NOT NULL) AS body_hit,
       snippet(node_fts, 1, char(2), char(3), '…', 12) AS body_marked
     FROM node_fts
     LEFT JOIN nm ON nm.rowid = node_fts.rowid
     LEFT JOIN bd ON bd.rowid = node_fts.rowid
     JOIN node n ON n.id = node_fts.rowid
     ${where}
     ORDER BY score ASC, n.updated_at DESC, n.id ASC
     LIMIT @limit OFFSET @offset`,
    };
  }

  /** LIKE 通道 SQL 对：每词 (名称∨正文) AND 组合；正文片段取首词命中 ±SNIPPET_WINDOW 码点窗口 */
  function likeSqls(shape: FilterShape, termCount: number): { rows: string; count: string } {
    const { typeFrag, subFrag, cte } = filterFragments(shape);
    const idx = Array.from({ length: termCount }, (_, i) => i);
    const andName = idx.map((i) => `n.name LIKE @k${String(i)} ESCAPE @esc`).join(' AND ');
    const andBody = idx
      .map((i) => `COALESCE(node_fts.body, '') LIKE @k${String(i)} ESCAPE @esc`)
      .join(' AND ');
    const perTerm = idx
      .map(
        (i) =>
          `(n.name LIKE @k${String(i)} ESCAPE @esc OR COALESCE(node_fts.body, '') LIKE @k${String(i)} ESCAPE @esc)`,
      )
      .join(' AND ');
    const pos = `instr(lower(COALESCE(node_fts.body, '')), lower(@win0))`;
    const from = `FROM node_fts JOIN node n ON n.id = node_fts.rowid
     WHERE n.deleted_at IS NULL AND ${perTerm}${typeFrag}${subFrag}`;
    return {
      count: `${cte}SELECT COUNT(*) AS c ${from}`,
      rows: `${cte}SELECT ${NODE_COLUMNS},
       (${andName}) AS name_all, (${andBody}) AS body_all,
       CASE WHEN ${pos} = 0 THEN 0 ELSE max(1, ${pos} - ${SNIPPET_WINDOW}) END AS win_start,
       CASE WHEN ${pos} = 0 THEN '' ELSE substr(node_fts.body,
         CASE WHEN ${pos} <= ${SNIPPET_WINDOW + 1} THEN 1 ELSE ${pos} - ${SNIPPET_WINDOW} END,
         ${SNIPPET_WINDOW * 2}) END AS body_window,
       length(COALESCE(node_fts.body, '')) AS body_len
     ${from}
     ORDER BY n.updated_at DESC, n.id ASC
     LIMIT @limit OFFSET @offset`,
    };
  }

  /** 过滤绑定：类型白名单升序绑 @t0/@t1；underPath 解析为 @rootId（回收站/不存在 → E_VFS_NOT_FOUND） */
  function filterBinds(
    shape: FilterShape,
    filters: SearchFilters | undefined,
    out: BindParams,
  ): void {
    shape.types.forEach((t, i) => {
      out[`t${String(i)}`] = t;
    });
    if (filters?.underPath !== undefined) {
      const row = stmtPathToId.get(filters.underPath);
      if (row === undefined) {
        throw new AppError(E_VFS_NOT_FOUND, '子树过滤路径不存在或已在回收站');
      }
      out.rootId = row.id;
    }
  }

  /** COUNT(*) 聚合恒返回单行（SQLite 语义），get 结果无空值路径——显式断言收窄，
   *  不引入运行时不可达的空值分支（v2 迁移对账同款收口，29205e3）；对自身构造语句的
   *  聚合结果形态断言，不涉 A.1-5 的 IPC 边界/外部输入解析/schema 校验三类禁区 */
  function countOf(
    pair: StatementPair<TrigramRow> | StatementPair<LikeRow>,
    binds: BindParams,
  ): number {
    return (pair.count.get(binds) as { c: number }).c;
  }

  function runTrigram(
    match: string,
    shape: FilterShape,
    filters: SearchFilters | undefined,
    limit: number,
    offset: number,
  ): { rows: TrigramRow[]; total: number } {
    const key = shapeKey(shape);
    let pair = trigramCache.get(key);
    if (pair === undefined) {
      const sqls = trigramSqls(shape);
      pair = {
        rows: db.prepare<BindParams, TrigramRow>(sqls.rows),
        count: db.prepare<BindParams, { c: number }>(sqls.count),
      };
      trigramCache.set(key, pair);
    }
    // 列命中位绑定：列过滤前缀 + 复用整段 MATCH 短语组（引号转义与 @match 同源，无原文拼接）
    const binds: BindParams = {
      match,
      nameMatch: `name : (${match})`,
      bodyMatch: `body : (${match})`,
    };
    filterBinds(shape, filters, binds);
    // 计数语句无 LIMIT/OFFSET 占位，多余绑定键被 better-sqlite3 忽略（binder 仅遍历语句具名参数）
    const total = countOf(pair, binds);
    return { rows: pair.rows.all({ ...binds, limit, offset }), total };
  }

  function runLike(
    patterns: readonly string[],
    terms: readonly string[],
    shape: FilterShape,
    filters: SearchFilters | undefined,
    limit: number,
    offset: number,
  ): { rows: LikeRow[]; total: number } {
    // 缓存键 = 过滤形态 + 词数（LIKE 语句形态随词数变化），上界 8 词 × 形态数
    const key = `${shapeKey(shape)}#${String(patterns.length)}`;
    let pair = likeCache.get(key);
    if (pair === undefined) {
      const sqls = likeSqls(shape, patterns.length);
      pair = {
        rows: db.prepare<BindParams, LikeRow>(sqls.rows),
        count: db.prepare<BindParams, { c: number }>(sqls.count),
      };
      likeCache.set(key, pair);
    }
    // ESCAPE 转义字符为单个反斜杠（与 queryBuilder.escapeLikePattern 的前置反斜杠语义一致）
    // 窗口锚点取首词：buildSearchQuery 保证 terms 非空（空查询已拒绝），下标 0 必存在，
    // 显式断言收窄避免引入运行时不可达的空值回退分支（29205e3 同类收口）
    const binds: BindParams = { esc: '\\', win0: (terms[0] as string).toLowerCase() };
    patterns.forEach((p, i) => {
      binds[`k${String(i)}`] = p;
    });
    filterBinds(shape, filters, binds);
    const total = countOf(pair, binds);
    return { rows: pair.rows.all({ ...binds, limit, offset }), total };
  }

  return {
    /**
     * 执行查询（spec §5）：构造 → 通道执行 → 命中装配（元数据 + 区间片段）。
     * @param request IPC 层已 zod 校验；limit 缺省 50/钳 200 双保险，offset 缺省 0
     * @returns 命中列表（分页窗口）、精确总数 truncated 标记（还有未返回命中）
     * @throws AppError(E_IPC_BAD_PAYLOAD / E_VFS_NOT_FOUND) 见工厂头注
     */
    query(request: SearchQueryRequest): SearchQueryResponse {
      const started = performance.now();
      // 参数拒绝先 warn 审计（拒绝原因形态描述，不含关键词原文，docs/03 §7.4）再原样重抛；
      // E_VFS_NOT_FOUND 等其他错误不在本 try 内（underPath 解析在 runTrigram/runLike 内），语义不变
      let built: BuiltQuery;
      try {
        built = buildSearchQuery(request.keyword);
      } catch (e) {
        if (e instanceof AppError && e.code === E_IPC_BAD_PAYLOAD) {
          console.warn(`[search] 查询参数被拒绝：${e.message}`);
        }
        throw e;
      }
      const limit = Math.min(request.limit ?? SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
      const offset = request.offset ?? 0;
      const shape = filterShape(request.filters);
      const hits: SearchHit[] = [];
      // 双通道分支各自回填后再读取（channel 为二元字面量联合，TS 可判定确定赋值）
      let total: number;
      if (built.channel === 'trigram') {
        const r = runTrigram(built.match, shape, request.filters, limit, offset);
        total = r.total;
        for (const row of r.rows) {
          hits.push({
            node: toNodeMeta(row),
            matchIn: matchInOf(row.name_hit === 1, row.body_hit === 1),
            score: row.score,
            nameSnippet: nameSnippet(row.name, built.terms),
            bodySnippet: row.body_hit === 1 ? parseMarkedSnippet(row.body_marked) : null,
          });
        }
      } else {
        const r = runLike(built.likePatterns, built.terms, shape, request.filters, limit, offset);
        total = r.total;
        for (const row of r.rows) {
          hits.push({
            node: toNodeMeta(row),
            matchIn: matchInOf(row.name_all === 1, row.body_all === 1),
            score: null, // 回退通道无相关性分数（spec §5）
            nameSnippet: nameSnippet(row.name, built.terms),
            bodySnippet: windowSnippet(row, built.terms),
          });
        }
      }
      // 日志含通道/词数/计数/耗时，不落关键词原文（docs/03 §7.4）
      console.info(
        `[search] 通道=${built.channel === 'trigram' ? '索引' : '回退LIKE'} 词数=${String(built.terms.length)} 命中=${String(hits.length)}/${String(total)} 耗时=${(performance.now() - started).toFixed(1)}ms`,
      );
      return { hits, total, truncated: offset + hits.length < total };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
