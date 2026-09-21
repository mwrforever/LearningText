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
  /** 列回收站条目（deleted_at 非空行，按删除时刻倒序；M5 批次②） */
  vfsListTrashed: 'vfs:list-trashed',
  /** 虚拟路径解析 */
  vfsResolve: 'vfs:resolve',
  // —— 搜索域（M2）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 模糊/全文搜索：索引通道或 LIKE 回退通道，渲染端无感知（spec §4） */
  searchQuery: 'search:query',
  // —— 设置域（M3）——
  /** 读全量设置（无参，payload null 先例）；服务侧已回退默认，get 不抛业务错 */
  settingsGet: 'settings:get',
  /** 全量写设置（渲染端 get→merge→set，schema 闸口 IPC 层） */
  settingsSet: 'settings:set',
  // —— 备份域（M5 批次③）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 立即创建备份（checkpoint + 整文件复制 + 滚动裁剪） */
  backupCreate: 'backup:create',
  /** 列出备份条目（文件名/字节数/修改时刻，新→旧） */
  backupList: 'backup:list',
  /** 还原到指定备份（integrity 校验 + 原子替换，成功后主进程 relaunch） */
  backupRestore: 'backup:restore',
  /** 主→渲染：备份创建完成广播（载荷为备份文件名），设置页据以刷新列表 */
  backupDone: 'backup:done',
  /** 主→渲染：树变更广播（事务提交成功后发出，宪法 B.3-4） */
  vfsChanged: 'vfs:changed',
  // —— 导入域（M5 批次⑥）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 导入磁盘目录到 VFS（分批事务写入，进度经 ioProgress 广播，长任务异步返回计数） */
  ioImport: 'io:import',
  /** 取消进行中的导入（当前批完成后停止，已写入节点保留——D16） */
  ioCancel: 'io:cancel',
  /** 主→渲染：导入/导出进度广播（导入/导出可辨识联合按 kind 区分，批间让出后发） */
  ioProgress: 'io:progress',
  /** 选择磁盘目录（openDirectory；multiple 开关区分多选源与单选目标，Task 13 复用） */
  ioPickDirectory: 'io:pick-directory',
  /** 导出 VFS 子树到磁盘（逐节点写盘 + vfs:// 引用改写，进度经 ioProgress 广播） */
  ioExport: 'io:export',
  /** 在系统文件管理器中打开目录（导出完成动作；入参按当次会话目录选择登记簿校验） */
  shellOpenPath: 'shell:open-path',
  // —— 外壳域（M4）：命名 <域>:<动作>（宪法 B.2-5）——
  /** 主→渲染：菜单/窗口命令（ShellCommand 可辨识联合，shell-contract 单一来源） */
  shellCommand: 'shell:command',
  /** 渲染→主：guard 确认后强制关闭（spec §2.3 放行唯一通道） */
  shellForceClose: 'shell:force-close',
  /** 按 nodeId 反查节点 meta（rename/move 后路径新鲜化，spec §6.1） */
  vfsGet: 'vfs:get',
  /** 活节点总数（状态栏文档计数，M6 spec §2.6；无参 payload null 先例） */
  vfsCount: 'vfs:count',
} as const;
