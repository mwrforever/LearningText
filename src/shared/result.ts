/**
 * Result 型 DTO（宪法 A.7-3）：跨进程错误显式建模，禁依赖异常透传。
 * AppError.code 取值见 src/shared/errors.ts；message 面向用户、必须中文。
 */
export interface AppError {
  /** 业务错误码，如 E_IPC_BAD_PAYLOAD */
  code: string;
  /** 面向用户的中文消息 */
  message: string;
}

/** 请求结果的统一载体：成功带 value，失败带 error，两分支互斥 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** 构造成功结果 */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** 构造失败结果：code 用 errors.ts 中的常量，禁裸写字符串 */
export const err = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
