/**
 * 数据目录域 IPC 契约（宪法 A.7-5 单一来源，M6 spec §5）：数据目录查看与更改迁移。
 * 指针文件 schema 同此唯一来源（dataDir.ts 装载期消费）；渲染层零 schema 运行时，
 * 类型仅经 `import type` 引用（M5 D28 主 chunk 裁剪同款纪律）。
 */
import { z } from 'zod';

/** 指针文件形态（userData/data-dir.json，userData 直下唯一例外文件，宪法 A.2-1 修订版）：root=null 表示默认位置 */
export const DataDirPointerSchema = z.strictObject({ root: z.string().min(1).nullable() });
export type DataDirPointer = z.infer<typeof DataDirPointerSchema>;

/** storage:get-info 响应：当前数据目录布局 + 是否自定义位置（设置页「数据与存储」分区消费） */
export const DataDirInfoSchema = z.strictObject({
  root: z.string().min(1),
  dbFile: z.string().min(1),
  backupsDir: z.string().min(1),
  settingsFile: z.string().min(1),
  custom: z.boolean(),
});
export type DataDirInfo = z.infer<typeof DataDirInfoSchema>;

/** storage:change-data-dir 请求：目标父目录（数据落 <targetDir>/LearningText，spec D8） */
export const ChangeDataDirRequestSchema = z.strictObject({ targetDir: z.string().min(1) });
export type ChangeDataDirRequest = z.infer<typeof ChangeDataDirRequestSchema>;

/**
 * storage:change-data-dir 响应：成功后主进程随即 relaunch（同 backup:restore 语义）——
 * 本调用续体可能因进程退出不落地，调用方不得依赖其结果做 UI 收尾。
 */
export interface ChangeDataDirResponse {
  readonly relaunch: true;
}
