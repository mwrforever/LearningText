import type { Result } from './result';
import type { SearchQueryRequest, SearchQueryResponse } from './search-contract';
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
  VfsChangedEvent,
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
  resolvePath(request: ResolvePathRequest): Promise<Result<NodeIdResponse>>;
  // —— 搜索域（M2）：每通道一个具名包装（宪法 A.7-4 桥接面最小化）——
  searchQuery(request: SearchQueryRequest): Promise<Result<SearchQueryResponse>>;
  /** 订阅树变更广播，返回取消订阅函数 */
  onVfsChanged(callback: (event: VfsChangedEvent) => void): () => void;
}

declare global {
  interface Window {
    readonly api: WindowApi;
  }
}

export {};
