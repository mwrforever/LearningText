/**
 * 备份域 IPC 契约（宪法 A.7-5 单一来源，M5 批次③）：backup:create / backup:list /
 * backup:restore 三通道的请求与响应 DTO + zod schema。校验失败由 handler 统一映射
 * E_IPC_BAD_PAYLOAD；业务错误码（E_BACKUP_FAILED / E_BACKUP_NOT_FOUND / E_BACKUP_CORRUPT）
 * 见 src/shared/errors.ts 与 docs/03 §7.3。
 */
import { z } from 'zod';

/** backup:create 请求形态：无参通道沿 settingsGet 先例传 null（preload 包装侧固定） */
export const BackupCreateRequestSchema = z.null();

/** backup:list 请求形态：同上（无参纯读通道） */
export const BackupListRequestSchema = z.null();

/** 备份条目（backup:list 响应元素）：fileName 为 lt-YYYYMMDD-HHMMSS.db 名形 */
export const BackupEntrySchema = z.strictObject({
  fileName: z.string().min(1),
  /** 备份文件字节数（stat.size） */
  sizeBytes: z.number().int().min(0),
  /** 文件修改时刻（本地 ISO 8601 含偏移，shared/time.ts 既有格式） */
  modifiedAt: z.string().min(1),
});
export type BackupEntry = z.infer<typeof BackupEntrySchema>;

/** backup:create 成功响应：新建备份文件名（列表刷新经 backup:done 广播到达） */
export const BackupCreateResponseSchema = z.strictObject({ fileName: z.string().min(1) });
export type BackupCreateResponse = z.infer<typeof BackupCreateResponseSchema>;

/** backup:restore 请求：目标备份文件名（服务侧另做名形与存在性校验，防路径逃逸） */
export const BackupRestoreRequestSchema = z.strictObject({ fileName: z.string().min(1) });
export type BackupRestoreRequest = z.infer<typeof BackupRestoreRequestSchema>;

/** backup:restore 成功响应：主进程随即 relaunch 重启应用（重启后加载还原后数据） */
export const BackupRestoreResponseSchema = z.strictObject({ relaunch: z.literal(true) });
export type BackupRestoreResponse = z.infer<typeof BackupRestoreResponseSchema>;
