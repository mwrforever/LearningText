/**
 * 导入导出域 IPC 契约（宪法 A.7-5 单一来源，M5 批次⑥）：io:import / io:cancel /
 * io:pick-directory / io:export 四通道的请求与响应 DTO + zod schema，及 io:progress
 * 广播载荷形态（导入/导出可辨识联合，kind 判别字段）。校验失败由 handler 统一映射
 * E_IPC_BAD_PAYLOAD；业务错误码（E_IO_SOURCE_NOT_FOUND 等）见 src/shared/errors.ts
 * 与 docs/03 §7.3。
 */
import { z } from 'zod';

/** 重名冲突策略（D15）：skip 跳过 / rename 递增改名 / overwrite 覆盖（trash 旧节点） */
export type ImportConflict = 'skip' | 'rename' | 'overwrite';

/**
 * io:import 请求：源磁盘路径清单（目录或文件，可混选）+ 目标父节点 id + 重名策略。
 * 目录源：内容合并导入目标父目录之下（源根目录本身不物化为节点——实现读法经设计文档
 * §7.1 澄清注钉死，属既有合并语义的自然延伸）；文件源：单节点物化为目标父的直接子项
 * （FR-IO-01「目录/文件批量导入」的文件形态，M7 批次补全）。sourcePaths 必须来自主进程
 * 选择对话框（io:pick-directory 目录 / io:pick-file 文件）的当次会话产出（ipc 层按登记簿
 * 校验，渲染层伪造串拒绝——io:export / shell:open-path 同一登记簿，防渲染层被攻破后
 * 任意路径读盘）。
 */
export const ImportRequestSchema = z.strictObject({
  sourcePaths: z.array(z.string().min(1)).min(1),
  targetParentId: z.number().int(),
  conflict: z.enum(['skip', 'rename', 'overwrite']),
  /**
   * 文件源落点名（可选，M7「导入即重命名」）：仅对文件源生效（目录源忽略）——渲染端
   * 导入确认浮层的名称输入直传，未传/空白回退磁盘 basename。合法性（非法字符/重名）
   * 由服务层 validateNodeName 与冲突策略兜底。
   */
  sourceName: z.string().min(1).optional(),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

/**
 * 导入进度广播载荷（io:progress，主→渲染）：批次间、事务提交后发（宪法 B.3-4，D16）。
 * phase=scanning 时 done/total 表达「已扫描源根数 / 源根总数」；writing 时为「已写入节点数 /
 * 计划节点总数」。currentPath 为扫描中的源路径或刚写完批次的末节点相对路径。
 * kind 判别字段（宪法 A.1-4）：与导出进度共用 io:progress 通道的可辨识联合成员。
 */
export interface ImportProgress {
  readonly kind: 'import';
  readonly importId: number;
  readonly phase: 'scanning' | 'writing';
  readonly done: number;
  readonly total: number;
  readonly currentPath: string;
}

/**
 * 导入结果计数（D17 toast 汇总口径）：imported 新增 / skipped 跳过（含目录合并与超限跳过）/
 * failed 失败。importedNodeIds 为本次 imported 命中的新节点 id（与计数同序累积）——单文件
 * 导入的「导入后即打开」渲染链按 [0] 寻址，避免渲染层靠名称反查（rename 策略可能递增改名）。
 */
export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
  readonly importedNodeIds: readonly number[];
}

/**
 * io:pick-file 请求：主进程弹出文件选择框（单选，过滤器固定 HTML：html/htm——HTML 文档
 * 导入专用入口，FR-IO-01 文件形态）。无参通道载荷固定 null（settingsGet 先例）；
 * 用户取消弹窗返回空数组（不作为错误）。产出文件路径登记入当次会话登记簿。
 */
export const IoPickFileRequestSchema = z.null();
export type IoPickFileRequest = null;

/** io:cancel 请求：按服务侧单调分配的 importId 寻址（首个进度广播到达即可取消） */
export const IoCancelRequestSchema = z.strictObject({ importId: z.number().int() });
export type IoCancelRequest = z.infer<typeof IoCancelRequestSchema>;

/**
 * io:pick-directory 请求：multiple=true 多选目录（导入源）；false 单选（Task 13 导出目标复用）。
 * 响应为所选目录绝对路径数组；用户取消弹窗返回空数组（不作为错误）。
 */
export const IoPickDirectoryRequestSchema = z.strictObject({ multiple: z.boolean() });
export type IoPickDirectoryRequest = z.infer<typeof IoPickDirectoryRequestSchema>;

/**
 * io:export 请求：导出子树根节点 id + 目标磁盘目录（根节点以自身名字目录落入该目录之下）。
 * targetDir 必须来自主进程目录选择对话框的当次会话产出（ipc 层按登记簿校验，渲染层
 * 伪造串拒绝——shell.openPath 同一登记簿，防渲染层被攻破后任意路径写盘）。
 */
export const ExportRequestSchema = z.strictObject({
  nodeId: z.number().int(),
  targetDir: z.string().min(1),
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

/**
 * 导出进度广播载荷（io:progress 复用，与 ImportProgress 形态对称）：
 * phase=collecting 一次性发（done=0，total=计划条目数，currentPath=导出根虚拟路径）；
 * writing 随批推进（done=已写盘条目数 / total=计划条目数）。currentPath 为写盘批的
 * 末条目相对导出容器的路径。kind 判别字段同上（A.1-4）。导出无取消语义（FR-IO-02 未要求）。
 */
export interface ExportProgress {
  readonly kind: 'export';
  readonly exportId: number;
  readonly phase: 'collecting' | 'writing';
  readonly done: number;
  readonly total: number;
  readonly currentPath: string;
}

/**
 * 导出结果计数（toast 汇总口径）：exported 成功写盘条目数（目录建目录 + 文件写文件）/
 * rewritten html 内 vfs:// 引用改写数 / missing 越界引用 '#' 占位数 /
 * skipped 名称不可写盘（磁盘合法性复检失败）跳过数 / failed 单条目失败数（不拖垮整单）。
 */
export interface ExportResult {
  readonly exported: number;
  readonly rewritten: number;
  readonly missing: number;
  readonly skipped: number;
  readonly failed: number;
}

/** io:progress 广播载荷（导入/导出可辨识联合，kind 判别字段——宪法 A.1-4） */
export type IoProgress = ImportProgress | ExportProgress;
