/**
 * 搜索域纯常量（宪法 A.7-5 单一来源）：无 zod 依赖的独立模块。
 * 拆分原因（M5 D28 主 chunk 裁剪）：与 vfs-constants.ts 同款——渲染层搜索面板仅消费
 * 分页常量，常量与 zod schema 同文件会把 zod 运行时整链拖入渲染端 bundle；
 * 渲染端零 schema 运行时（契约校验归主进程 handler，A.7）。
 */

/** 每页命中数默认（spec §5） */
export const SEARCH_LIMIT_DEFAULT = 50;
/** 每页命中数硬上限（spec §5） */
export const SEARCH_LIMIT_MAX = 200;
/** 查询词项数上限（超限整条拒绝，spec §4） */
export const MAX_SEARCH_TERMS = 8;
/** 单词项码点长度上限（与名称长度上限量级一致） */
export const MAX_SEARCH_TERM_CODEPOINTS = 255;
