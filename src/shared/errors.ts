/**
 * 业务错误码常量。全量码表规划见 docs/03 §7.3，此处仅定义实际使用的码，
 * 禁止预定义未使用码（死代码零容忍）。
 */
export const E_IPC_BAD_PAYLOAD = 'E_IPC_BAD_PAYLOAD';
export const E_IPC_FORBIDDEN_ORIGIN = 'E_IPC_FORBIDDEN_ORIGIN';

// —— 以下为 M1 存储与 VFS 通道实际使用的码（映射表见 spec §5，禁预定义未使用码）——
export const E_VFS_NOT_FOUND = 'E_VFS_NOT_FOUND';
export const E_VFS_DUPLICATE_NAME = 'E_VFS_DUPLICATE_NAME';
export const E_VFS_INVALID_NAME = 'E_VFS_INVALID_NAME';
export const E_VFS_INVALID_MOVE = 'E_VFS_INVALID_MOVE';
export const E_VFS_FILE_TOO_LARGE = 'E_VFS_FILE_TOO_LARGE';
export const E_VFS_TYPE_MISMATCH = 'E_VFS_TYPE_MISMATCH';
export const E_STORE_BUSY = 'E_STORE_BUSY';
export const E_STORE_DB_DAMAGED = 'E_STORE_DB_DAMAGED';
export const E_STORE_DISK_FULL = 'E_STORE_DISK_FULL';
export const E_STORE_INTERNAL = 'E_STORE_INTERNAL';
