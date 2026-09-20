/**
 * 备份滚动保留纯函数（M5 批次③）：无 IO、无时钟依赖——输入文件名名单与保留份数，
 * 输出待剪名单/到期判定，供 BackupService 消费。文件名约定 lt-YYYYMMDD-HHMMSS.db
 * （时间戳段高位在前），字典序即时间序，是排序与到期判定的共同前提。
 */

/** 滚动保留份数（docs/03 §2.2：每日滚动备份保留最近 7 份） */
export const RETENTION_KEEP = 7;

/**
 * 选出超出保留份数的最旧备份名单。
 * @param fileNames 备份文件名名单（名形合法性由调用方过滤；内部仅做排序与切分）
 * @param keep 保留份数（生产固定 RETENTION_KEEP=7；0 语义为全部剪除）
 * @returns 按字典序（=时间序）排列的最旧超额名单；未超额返回空数组（不可变入参，不改动）
 */
export function selectBackupsToPrune(
  fileNames: readonly string[],
  keep: number,
): readonly string[] {
  // 升序排列后头部即最旧：默认字符串排序即 UTF-16 码元字典序，与时间先后一致
  // （名形约定承载，无需解析时间戳，亦无需自定义比较器）
  const sorted = [...fileNames].sort();
  const excess = sorted.length - keep;
  if (excess <= 0) return [];
  return sorted.slice(0, excess);
}

/**
 * 每日自动备份到期判定：最近一次备份的本地日期与今天不同即到期。
 * @param todayIsoDate 本地时区日期串（YYYY-MM-DD，app 层传入，服务不摸钟保持可测性）
 * @param lastBackupIsoDate 最近一次备份的本地日期串；null 表示从未备份（首次启动即到期）
 */
export function isAutoBackupDue(todayIsoDate: string, lastBackupIsoDate: string | null): boolean {
  return lastBackupIsoDate === null || lastBackupIsoDate !== todayIsoDate;
}
