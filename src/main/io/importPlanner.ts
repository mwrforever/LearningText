// 导入节点计划纯函数（M5 批次⑥ Task 12，FR-IO-01）：磁盘读取一律由 service 注入 fs 抽象，
// 本模块零 IO——根层计划把目录清单折叠为写入节点（目录字节归零），重名三策略独立可测。
// 目录递归（广度遍历追加子层计划）由 service 承担，保持本函数纯函数契约（spec D15 前置）。

/** 重名冲突策略（io-contract 同型再导出，消费方就近引用避免跨层穿透 shared 之外的路径） */
export type ImportConflict = 'skip' | 'rename' | 'overwrite';

/** 计划写入节点：relPath 相对源根（'/' 连接层级），name 为当前级名（重名策略可改写落点名） */
export interface PlannedNode {
  readonly relPath: string;
  readonly name: string;
  readonly isDir: boolean;
  readonly sizeBytes: number;
}

/**
 * 根层计划（目录递归由 service 广度遍历追加）：源根目录清单 → 首层写入节点。
 * 目录条目字节归零（目录无内容语义，sizeBytes 仅对文件有意义）。
 */
export function planImportRoots(
  entries: readonly { name: string; isDir: boolean; sizeBytes: number }[],
): readonly PlannedNode[] {
  return entries.map((entry) => ({
    relPath: entry.name,
    name: entry.name,
    isDir: entry.isDir,
    sizeBytes: entry.isDir ? 0 : entry.sizeBytes,
  }));
}

/**
 * 重名三策略判定（spec §7.1 / D15）：
 * - skip：同名存在即 skip（名字原样返回，供服务层计数归因）；
 * - rename：无冲突 write 原名；冲突递增 `name (2).ext`、`name (3).ext`……扩展名保留
 *   （最后一段点为扩展名；无扩展名或点开头文件整体作主名追加后缀）；
 * - overwrite：存在与否一律 write 原名——覆盖落点由服务层 trash 旧节点实现（回收站可找回）。
 */
export function resolveConflict(
  baseName: string,
  existingNames: ReadonlySet<string>,
  conflict: ImportConflict,
): { readonly action: 'skip' | 'write'; readonly name: string } {
  if (conflict === 'overwrite') {
    return { action: 'write', name: baseName };
  }
  if (!existingNames.has(baseName)) {
    return { action: 'write', name: baseName };
  }
  if (conflict === 'skip') {
    return { action: 'skip', name: baseName };
  }
  // rename：切出主名与扩展名（lastIndexOf > 0 保证点开头文件不被误切出空主名）
  const dot = baseName.lastIndexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  let seq = 2;
  while (existingNames.has(`${stem} (${seq})${ext}`)) {
    seq += 1;
  }
  return { action: 'write', name: `${stem} (${seq})${ext}` };
}
