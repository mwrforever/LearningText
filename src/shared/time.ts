/**
 * ISO 8601 本地时区时间戳（含偏移量，如 2026-09-16T14:30:00.000+08:00）。
 * docs/03 §3.2-5 规定 created_at/updated_at 统一此格式（Date.toISOString 是 UTC，不适用）。
 */
export function toLocalIsoTime(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  // 偏移量以分钟计，西半球为正 getTimezoneOffset，故取负号得到 ISO 惯例的 ±HH:mm
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffset / 60);
  const offsetRest = absOffset % 60;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}${sign}${pad(offsetHours)}:${pad(offsetRest)}`
  );
}
