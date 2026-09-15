/**
 * IPC handler 集中注册（宪法 B.3-2）：
 * 每通道两道校验——senderFrame origin 白名单（B.5-6）→ zod safeParse（A.7-5），
 * 校验失败与业务结果统一以 Result DTO 返回（A.7-3），禁止抛异常透传。
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { err, ok, type Result } from '../shared/result';
import { E_IPC_BAD_PAYLOAD, E_IPC_FORBIDDEN_ORIGIN } from '../shared/errors';

/** system:ping 请求载荷：探针通道固定为 null，其余一律拒绝 */
const PingPayloadSchema = z.null();

export interface IpcHandlerDeps {
  /** 允许发起 IPC 的 origin 白名单（用 origin 不用 URL，B.5-6） */
  allowedOrigins: readonly string[];
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  ipcMain.handle(IPC.systemPing, (event, payload: unknown): Result<{ pong: true }> => {
    // senderFrame 可能为 null（B.5-6），null 与非白名单 origin 一律拒绝
    const origin = event.senderFrame?.origin;
    if (
      origin === undefined ||
      origin === null ||
      origin === '' ||
      !deps.allowedOrigins.includes(origin)
    ) {
      return err(E_IPC_FORBIDDEN_ORIGIN, '拒绝来自未授权来源的调用');
    }
    const parsed = PingPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return err(E_IPC_BAD_PAYLOAD, '请求载荷不合法');
    }
    return ok({ pong: true });
  });
}
