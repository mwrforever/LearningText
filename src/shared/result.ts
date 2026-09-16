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

/**
 * 可抛出的业务错误（服务层内部传播用）：进程内 throw，
 * IPC handler 统一 catch 后转 Result DTO（宪法 A.7-3），禁跨进程抛异常。
 * 实现为 const 绑定的类表达式：与上方同名 interface 分占值/类型两个命名空间，
 * 规避 class 声明与 interface 的同名声明合并（合并会把 Error 实例成员 name
 * 注入 Result.error 形态，并触发 no-unsafe-declaration-merging）；
 * 导出契约与 class 声明完全一致：new AppError(code, message) / instanceof 皆可用。
 */
export const AppError = class extends Error {
  /** 业务错误码（errors.ts 常量） */
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
};

/** 请求结果的统一载体：成功带 value，失败带 error，两分支互斥 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** 构造成功结果 */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

/** 构造失败结果：code 用 errors.ts 中的常量，禁裸写字符串 */
export const err = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
