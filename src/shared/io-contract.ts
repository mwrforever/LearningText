/**
 * 导入域 IPC 契约（宪法 A.7-5 单一来源，M5 批次⑥）：io:import / io:cancel /
 * io:pick-directory 三通道的请求与响应 DTO + zod schema，及 io:progress 广播载荷形态。
 * 校验失败由 handler 统一映射 E_IPC_BAD_PAYLOAD；业务错误码（E_IO_SOURCE_NOT_FOUND 等）
 * 见 src/shared/errors.ts 与 docs/03 §7.3。Task 13 导出复用进度广播与目录选择通道。
 */
import { z } from 'zod';

/** 重名冲突策略（D15）：skip 跳过 / rename 递增改名 / overwrite 覆盖（trash 旧节点） */
export type ImportConflict = 'skip' | 'rename' | 'overwrite';

/**
 * io:import 请求：源磁盘路径清单（目录，多选）+ 目标父节点 id + 重名策略。
 * 源目录内容合并导入目标父目录之下（源根目录本身不物化为节点——实现读法经设计文档
 * §7.1 澄清注钉死，属既有合并语义的自然延伸）。
 */
export const ImportRequestSchema = z.strictObject({
  sourcePaths: z.array(z.string().min(1)).min(1),
  targetParentId: z.number().int(),
  conflict: z.enum(['skip', 'rename', 'overwrite']),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

/**
 * 导入进度广播载荷（io:progress，主→渲染）：批次间、事务提交后发（宪法 B.3-4，D16）。
 * phase=scanning 时 done/total 表达「已扫描源根数 / 源根总数」；writing 时为「已写入节点数 /
 * 计划节点总数」。currentPath 为扫描中的源路径或刚写完批次的末节点相对路径。
 */
export interface ImportProgress {
  readonly importId: number;
  readonly phase: 'scanning' | 'writing';
  readonly done: number;
  readonly total: number;
  readonly currentPath: string;
}

/** 导入结果计数（D17 toast 汇总口径）：imported 新增 / skipped 跳过（含目录合并与超限跳过）/ failed 失败 */
export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
}

/** io:cancel 请求：按服务侧单调分配的 importId 寻址（首个进度广播到达即可取消） */
export const IoCancelRequestSchema = z.strictObject({ importId: z.number().int() });
export type IoCancelRequest = z.infer<typeof IoCancelRequestSchema>;

/**
 * io:pick-directory 请求：multiple=true 多选目录（导入源）；false 单选（Task 13 导出目标复用）。
 * 响应为所选目录绝对路径数组；用户取消弹窗返回空数组（不作为错误）。
 */
export const IoPickDirectoryRequestSchema = z.strictObject({ multiple: z.boolean() });
export type IoPickDirectoryRequest = z.infer<typeof IoPickDirectoryRequestSchema>;
