/**
 * IPC 通道常量（宪法 B.2-5）：命名 <域>:<动作>，三端唯一来源。
 * M0 仅一条样板通道；后续里程碑按域扩展（vfs:* / search:* / io:* …）。
 */
export const IPC = {
  /** 连通性探针：preload → main，验证类型化 IPC 链路 */
  systemPing: 'system:ping',
} as const;
