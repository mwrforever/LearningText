/**
 * IPC 通道常量（宪法 B.2-5）：命名 <域>:<动作>，三端唯一来源。
 * M0 仅一条样板通道；后续里程碑按域扩展（vfs:* / search:* / io:* …）。
 */
export const IPC = {
  /** 连通性探针：preload → main，验证类型化 IPC 链路 */
  systemPing: 'system:ping',
  // —— VFS 域（M1）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 列子节点（parentId 或 virtualPath 二选一） */
  vfsList: 'vfs:list',
  /** 新建目录/文件 */
  vfsCreate: 'vfs:create',
  /** 读文件内容 */
  vfsRead: 'vfs:read',
  /** 写文件内容（覆盖） */
  vfsWrite: 'vfs:write',
  /** 重命名（子树级联路径） */
  vfsRename: 'vfs:rename',
  /** 移动（子树迁移） */
  vfsMove: 'vfs:move',
  /** 删除（软删除进回收站） */
  vfsTrash: 'vfs:trash',
  /** 还原 */
  vfsRestore: 'vfs:restore',
  /** 彻底删除（物理移除） */
  vfsPurge: 'vfs:purge',
  /** 虚拟路径解析 */
  vfsResolve: 'vfs:resolve',
  // —— 搜索域（M2）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 模糊/全文搜索：索引通道或 LIKE 回退通道，渲染端无感知（spec §4） */
  searchQuery: 'search:query',
  /** 主→渲染：树变更广播（事务提交成功后发出，宪法 B.3-4） */
  vfsChanged: 'vfs:changed',
} as const;
