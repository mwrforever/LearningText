import type { Result } from './result';
import type {
  BackupCreateResponse,
  BackupEntry,
  BackupRestoreRequest,
  BackupRestoreResponse,
} from './backup-contract';
import type {
  ExportRequest,
  ExportResult,
  ImportRequest,
  ImportResult,
  IoCancelRequest,
  IoPickDirectoryRequest,
  IoProgress,
} from './io-contract';
import type { OpenPathRequest } from './shell-contract';
import type { SearchQueryRequest, SearchQueryResponse } from './search-contract';
import type { ShellCommand } from './shell-contract';
import type { SettingsData } from './settings-contract';
import type {
  AffectedResponse,
  CreateNodeRequest,
  ListChildrenRequest,
  MoveNodeRequest,
  NodeIdRequest,
  NodeIdResponse,
  NodeMeta,
  ReadFileRequest,
  ReadFileResponse,
  RenameNodeRequest,
  ResolvePathRequest,
  TrashedNodeMeta,
  VfsChangedBroadcast,
  WriteFileRequest,
} from './vfs-contract';

/**
 * preload 暴露给渲染层的 API 契约（宪法 A.7-4）：类型唯一来源，
 * preload 负责实现，渲染层经 Window.api 类型安全调用。
 */
export interface WindowApi {
  /** 连通性探针：调用主进程 system:ping */
  ping(): Promise<Result<{ readonly pong: true }>>;
  // —— VFS 域（M1）：每通道一个具名包装（宪法 A.7-4 桥接面最小化）——
  listChildren(request: ListChildrenRequest): Promise<Result<NodeMeta[]>>;
  createNode(request: CreateNodeRequest): Promise<Result<NodeMeta>>;
  readFile(request: ReadFileRequest): Promise<Result<ReadFileResponse>>;
  writeFile(request: WriteFileRequest): Promise<Result<NodeMeta>>;
  renameNode(request: RenameNodeRequest): Promise<Result<AffectedResponse>>;
  moveNode(request: MoveNodeRequest): Promise<Result<AffectedResponse>>;
  trashNode(request: NodeIdRequest): Promise<Result<AffectedResponse>>;
  restoreNode(request: NodeIdRequest): Promise<Result<NodeMeta>>;
  purgeNode(request: NodeIdRequest): Promise<Result<AffectedResponse>>;
  /** 回收站列表（M5 批次②）：deleted_at 非空行，按删除时刻倒序 */
  listTrashed(): Promise<Result<TrashedNodeMeta[]>>;
  resolvePath(request: ResolvePathRequest): Promise<Result<NodeIdResponse>>;
  // —— 搜索域（M2）：每通道一个具名包装（宪法 A.7-4 桥接面最小化）——
  searchQuery(request: SearchQueryRequest): Promise<Result<SearchQueryResponse>>;
  // —— 设置域（M3）：全量读写（spec §5）——
  settingsGet(): Promise<Result<SettingsData>>;
  settingsSet(request: SettingsData): Promise<Result<SettingsData>>;
  // —— 外壳域（M4）：菜单命令订阅 + guard 放行 ——
  onShellCommand(callback: (command: ShellCommand) => void): () => void;
  forceClose(): Promise<Result<null>>;
  // —— 备份域（M5 批次③）：create/list 无参通道沿 settingsGet 先例 ——
  /** 立即创建备份（checkpoint + 整文件复制 + 滚动裁剪） */
  backupCreate(): Promise<Result<BackupCreateResponse>>;
  /** 列出备份条目（文件名/字节数/修改时刻，新→旧） */
  backupList(): Promise<Result<BackupEntry[]>>;
  /**
   * 还原到指定备份：数据覆盖级操作（渲染层须强确认后调用）。成功响应 { relaunch: true }
   * 后主进程随即重启——本调用续体可能因进程退出不落地，调用方不得依赖其结果做 UI 收尾。
   */
  backupRestore(request: BackupRestoreRequest): Promise<Result<BackupRestoreResponse>>;
  /** 订阅备份完成广播（载荷为备份文件名），返回取消订阅函数 */
  onBackupDone(callback: (fileName: string) => void): () => void;
  // —— 导入域（M5 批次⑥）：invoke 长任务 + 进度订阅 + 目录选择供给 ——
  /**
   * 导入磁盘目录到目标父节点（分批事务写入，批次间让出事件循环）。进度经 onIoProgress
   * 订阅到达；取消用 cancelImport（按进度载荷中的 importId 寻址）。
   */
  importNodes(request: ImportRequest): Promise<Result<ImportResult>>;
  /** 取消进行中的导入：当前批完成后停止，已写入节点保留（D16） */
  cancelImport(request: IoCancelRequest): Promise<Result<null>>;
  /** 主进程弹出目录选择框：multiple 多选（导入源），单选（导出目标，Task 13 复用）；取消返回空数组 */
  pickDirectory(request: IoPickDirectoryRequest): Promise<Result<readonly string[]>>;
  /**
   * 导出 VFS 子树到磁盘（M5 批次⑥ Task 13）：targetDir 须为 pickDirectory 当次会话产出
   * （主进程按登记簿校验，伪造串拒绝）。进度经 onIoProgress 订阅到达（kind: 'export'）。
   */
  exportNodes(request: ExportRequest): Promise<Result<ExportResult>>;
  /**
   * 在系统文件管理器中打开目录（导出完成动作）：dir 仅接受主进程 dialog 产出的目录串，
   * 主进程按当次会话登记簿校验（渲染层不透传用户可控串直达 shell——B.5-4 同源纪律）。
   */
  openPath(request: OpenPathRequest): Promise<Result<null>>;
  /** 订阅 io 进度广播（导入/导出可辨识联合，kind 判别字段），返回取消订阅函数 */
  onIoProgress(callback: (progress: IoProgress) => void): () => void;
  // —— VFS 补充（M4）：nodeId → NodeMeta 反查（未找到 E_VFS_NOT_FOUND）——
  getNode(request: NodeIdRequest): Promise<Result<NodeMeta>>;
  /** 订阅树变更广播，返回取消订阅函数 */
  onVfsChanged(callback: (broadcast: VfsChangedBroadcast) => void): () => void;
}

declare global {
  interface Window {
    readonly api: WindowApi;
  }
}

export {};
