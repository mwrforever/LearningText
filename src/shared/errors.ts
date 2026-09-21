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

// —— 以下为 M5 备份域实际使用的码（docs/03 §7.3 同步，禁预定义未使用码）——
/** 备份创建/还原执行失败（checkpoint/复制/替换等 IO 环节出错） */
export const E_BACKUP_FAILED = 'E_BACKUP_FAILED';
/** 目标备份不存在（名形不合法或已被滚动清理，含路径逃逸入参） */
export const E_BACKUP_NOT_FOUND = 'E_BACKUP_NOT_FOUND';
/** 备份文件完整性校验未通过（无法作为数据库打开或 integrity_check 非 ok） */
export const E_BACKUP_CORRUPT = 'E_BACKUP_CORRUPT';

// —— 以下为 M5 导入导出域实际使用的码（docs/03 §7.3 同步，禁预定义未使用码）——
/** 导入源路径不存在或不可读（选择与发起之间源目录被移动/删除等） */
export const E_IO_SOURCE_NOT_FOUND = 'E_IO_SOURCE_NOT_FOUND';
/** 导出目标目录不可写或不存在（写探针预检失败，选择与发起之间目录被移动/权限收紧等） */
export const E_IO_TARGET_UNWRITABLE = 'E_IO_TARGET_UNWRITABLE';

// —— 以下为 M6 数据目录域实际使用的码（docs/03 §7.3 同步，禁预定义未使用码）——
/** 数据目录迁移目标非法（等于当前目录/不可写/不存在/已含同名数据目录） */
export const E_STORAGE_INVALID_TARGET = 'E_STORAGE_INVALID_TARGET';
/** 数据目录迁移执行失败（关库后复制/写指针环节出错），已清理残留、旧位置不受影响 */
export const E_STORAGE_MIGRATE_FAILED = 'E_STORAGE_MIGRATE_FAILED';
