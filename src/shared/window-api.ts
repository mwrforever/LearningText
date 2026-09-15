import type { Result } from './result';

/**
 * preload 暴露给渲染层的 API 契约（宪法 A.7-4）：类型唯一来源，
 * preload 负责实现，渲染层经 Window.api 类型安全调用。
 */
export interface WindowApi {
  /** 连通性探针：调用主进程 system:ping */
  ping(): Promise<Result<{ readonly pong: true }>>;
}

declare global {
  interface Window {
    readonly api: WindowApi;
  }
}

export {};
