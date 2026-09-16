# LearningText 存储与 VFS 详细设计

> 文档版本：v0.1（设计稿，待评审）
> 日期：2026-09-16
> 上游文档：[03-全局需求规格说明书](./03-全局需求规格说明书.md)（需求基线）、工程宪法 `AGENTS.md`（A.4 数据库操作 / A.7 跨层约束 / B.1 目录职责）
> 状态：本文档是里程碑 M1 的实现依据，**只补 docs/03 未覆盖的实现细节**；与 docs/03 冲突时先改 docs/03 再改本文。

## 1. 范围与决策范围

本文对应里程碑 M1（存储引擎 M2 + 虚拟文件系统 M3 + FR-VFS 全量，docs/03 §6.2），落实 TASK.md 登记的五项决策范围：

| TASK.md 决策范围 | 对应章节 |
| --- | --- |
| 名称校验与 Unicode 规范化规则 | §6 |
| SQLite 错误码 → `E_VFS_*` 错误映射表 | §5 |
| 迁移脚本组织形态 | §3 |
| 事务封装模板 | §4 |
| 回收站保留策略 | §7.6 |

另覆盖：数据库生命周期（§2）、VFS 服务与路径物化（§7）、IPC 契约与 zod v4 习语（§8）、备份机制（§9）、性能与测试策略（§10）。

### 1.1 M1 里程碑的领域外前置项（不入本文，规格来源为宪法与 TASK.md）

M1 实施范围除本文领域设计外，还包含 M0 移交的工程修复与回填（TASK.md「执行项登记」/「待回填」表）。它们属构建编排与安全基线范畴，非存储/VFS 领域设计，故不在本文展开——规格来源与处置如下，将由 M1 实施计划作为**前置任务**排入：

| 事项 | 规格来源 | 计划中的排位 |
| --- | --- | --- |
| preload 从 tsconfig.main 拆出独立构建（dev watch / 单独 build:main 产出坏 preload，dev 形态 IPC 断） | TASK.md 执行项登记【M1 前置】 | 首个任务（主开发循环即受影响） |
| 补齐 B.5-4/5 窗口安全基线：`will-navigate` origin 白名单、`setWindowOpenHandler` 一律 deny、`setPermissionRequestHandler` 默认拒绝 | 宪法 B.5-4/5（条款已完备） | 窗口/树 UI 任务之前 |
| `configLoader 'native'` 警告与 `"type":"module"` 决策 | TASK.md 待决策表（随 M1 构建编排重构评估） | 随 preload 拆出任务一并裁决 |
| 同步事务阻塞毫秒预算实测回填（宪法 A.5-4） | TASK.md 待回填表 | 随 §10 性能基准测试实测后回填 |
| B.1 + C.4 对齐回填（`build:preload` 脚本、`src/main/ipc.ts` 目录树形态） | TASK.md 待回填表 | M1 评审时一并处理 |

## 2. 数据库生命周期

### 2.1 数据位置

```text
<userData>/LearningText/
├── learningtext.db        # 唯一数据库文件（含 -wal / -shm 伴生文件）
├── backups/               # 滚动备份目录（§9）
└── last-backup.json       # 每日自动备份标记（§9.3）
```

- 路径经 `app.getPath('userData')` 拼接（宪法 A.2-1），目录不存在时启动流程创建（`fs.mkdirSync(recursive)`）；
- `userData` 直下不放任何文件，全部收敛于 `LearningText/` 子目录。

### 2.2 启动装配（对接 M0 的 `bootstrapMain`）

启动顺序在宪法 B.3-1 基础上细化为：

1. 解析数据目录并 `mkdir -p`；
2. `openDatabase({ file })`（M0 已交付：开库即设 WAL + foreign_keys）；
3. `runMigrations(db)`（§3，fail-fast：任何迁移失败中止启动，docs/03 FR-STORE-02）；
4. 将 `db` 交给服务层工厂（VFS 服务、后续搜索/备份服务）并注册 IPC handler；
5. 注册协议与窗口（M0 已有）。

优雅关闭：`app.on('will-quit')` 中 `db.close()`（干净关闭自动最终 checkpoint 并清理 `-wal`/`-shm`）。

### 2.3 连接纪律

- 全进程单连接（M0 `openDatabase` 原语不变），由主进程装配层持有并注入服务；服务层禁止自行开连接；
- `:memory:` 模式仅供测试（M0 集成测试已用）。

## 3. 迁移体系

### 3.1 脚本组织形态（决策：TS 模块注册表）

```text
src/main/store/migrations/
├── index.ts        # 注册表：按 version 升序导出 Migration[]
└── 0001-initial.ts # v1：建表 + 索引 + FTS + 根节点种子
```

```ts
/** 单个迁移：version 单调递增；up 内只做本版本的事 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Database.Database): void;
}
```

**形态裁决与理由**：迁移用 TS 模块而非 `.sql` 文件——① 类型检查覆盖 DDL 字符串常量与种子数据；② 迁移可在 `:memory:` 库上直接单测（无需文件加载器）；③ electron-builder 打包无需额外资源文件规则（SQL 文件须进 asar 打包清单）。DDL 语句以 `db.exec` 执行、带参数的种子数据用 `db.prepare`（宪法 A.4-5）。

### 3.2 执行器语义

`runMigrations(db)`（`src/main/store/migrate.ts`）：

1. `db.pragma('user_version', { simple: true })` 读当前版本 `v`；
2. 遍历注册表中 `version > v` 的迁移，按升序逐个执行；
3. **每个迁移一个独立事务**：`up(db)` 的全部 DDL/DML 与 `PRAGMA user_version = N` 写入在同一事务内提交（user_version 存于数据库头、随事务原子生效），任何错误整体回滚并中止启动；
4. **幂等语义裁决**：幂等由执行器的版本判断保证（同版本不重跑）；迁移脚本内部**不写 `IF NOT EXISTS` / `OR IGNORE`**——重复执行本就不应发生，防御性子句会掩盖真实错误。此为对宪法 A.4-3「幂等」的实现口径。

### 3.3 v1 迁移内容

按 docs/03 §3.1 原样建 `node` 表、三个索引、`node_fts` 虚拟表，并种子根节点：`id=1, parent_id=NULL, node_type='dir', name='', virtual_path='/'`（根节点 `name` 为空串以满足 NOT NULL，展示层特殊处理根名）。迁移编写规范（后续迁移必须遵守）：

- 脚本须在捆绑编译选项下书写：`SQLITE_DQS=0`（字符串字面量一律单引号）、外键默认强制、FTS5 可用；
- `PRAGMA foreign_keys` 等开关切换必须在事务外（事务内 no-op）——本 v1 不需要；
- FTS5 表不可 `ALTER`，未来列集变更只能重建（新表 + 复制 + 换名 + 重建索引）。

## 4. 事务封装模板

### 4.1 形态

`src/main/store/transaction.ts` 导出唯一入口：

```ts
/**
 * 写事务包装：IMMEDIATE 变体（BEGIN 即取写锁，fail-fast）。
 * fn 必须同步（宪法 A.4-4：事务不得跨事件循环 tick、禁 async）。
 * 返回 fn 的返回值；异常映射后以 AppError 抛出（§5）。
 */
export function runWriteTransaction<T>(db: Database.Database, fn: () => T): T;
```

读路径不设显式事务封装：单条 SELECT 天然原子，多读场景由 WAL 并发语义覆盖。

### 4.2 错误处理模板（固定写法）

```ts
try {
  return db.transaction(fn).immediate();
} catch (e) {
  // SQLite 可能未经请求自动回滚（SQLITE_FULL/IOERR/INTERRUPT/NOMEM 等），
  // 先判 inTransaction 再决定语义，避免对已回滚事务二次回滚
  if (!(e instanceof SqliteError)) throw e;
  if (db.inTransaction) { /* 仅在确实需要清理时触达；正常路径不会 */ }
  throw mapSqliteError(e); // §5 映射为 AppError 后向上抛
}
```

- **SQLITE_BUSY 处理裁决**：单连接 + IMMEDIATE 模型下 BUSY 仅剩崩溃恢复期等边缘窗口，不做自动重试；映射 `E_STORE_BUSY` 向渲染端提示「数据库忙，请重试」（满足宪法 A.4-8 的用户提示路径）；
- 服务层禁止裸 `BEGIN/COMMIT/ROLLBACK`、禁止在事务内做 IPC 回调或任何 await（宪法 A.4-4）。

## 5. SQLite 错误码 → 应用错误码映射表

`src/main/store/errorMapping.ts` 的 `mapSqliteError(e: SqliteError): AppError`，按 `SqliteError.code` 分支（宪法 A.4-8）：

| SqliteError.code | 典型触发场景 | 应用错误码 | 面向用户消息（中文） |
| --- | --- | --- | --- |
| `SQLITE_CONSTRAINT_UNIQUE`（命中 `idx_node_parent_name`） | 创建/重命名/还原时同目录重名 | `E_VFS_DUPLICATE_NAME` | 「同级已存在同名文件或文件夹」 |
| `SQLITE_BUSY` | 崩溃恢复期等边缘写锁竞争 | `E_STORE_BUSY` | 「数据库忙，请稍后重试」 |
| `SQLITE_CORRUPT` / `SQLITE_NOTADB` | 库文件损坏或非本应用库 | `E_STORE_DB_DAMAGED` | 进入只读恢复引导（docs/03 §2.3） |
| `SQLITE_FULL` | 磁盘空间不足 | `E_STORE_DISK_FULL` | 「磁盘空间不足，写入失败」 |
| 其余 `SQLITE_CONSTRAINT_*` / 兜底 | 服务层前置校验漏网 | `E_STORE_INTERNAL` | 「操作失败」；主进程 error 日志必须含原始 code 与节点 id/虚拟路径 |

约定：

- 应用错误码常量追加至 `src/shared/errors.ts`，**仅定义本表出现的码**（死代码零容忍），格式沿用 M0 惯例；
- 服务层的前置校验（重名之外的名称非法、超限、环检测等）**不依赖 SQLite 报错**，在进入事务前显式返回对应 `E_VFS_*`（docs/03 §7.3），SQLite 约束只是最后防线；
- `E_VFS_DUPLICATE_NAME` 特例：还原操作依赖 partial unique index 约束报错映射（§7.5），不做预查询。

## 6. 名称校验与 Unicode 规范化

### 6.1 NFC 规范化（决策）

所有节点 `name` 在入库前统一 `name.normalize('NFC')`，校验基于规范化后的值。理由：macOS APFS/HFS+ 文件名是 NFD 分解形态，同一「拼」字存在两种 Unicode 序列；统一 NFC 保证 ① 跨平台导出（M7）到真实文件系统不产生视觉重复名，② VFS 内同名判定唯一。

### 6.2 校验规则（按序执行，任一失败即拒绝并返回 `E_VFS_INVALID_NAME`）

| # | 规则 | 依据 |
| --- | --- | --- |
| 1 | 类型为 string，长度（Unicode 码点数）1–255 | docs/03 §3.2-2 |
| 2 | 禁含字符：`/ \ : * ? " < > |` 及控制字符 U+0000–U+001F、U+007F | docs/03 §3.2-2 ∪ Windows 文件命名规则——取三平台最严并集，保证 M7 导出到任意平台合法 |
| 3 | 禁止 Windows 保留名：`CON PRN AUX NUL COM1..COM9 LPT1..LPT9`（大小写不敏感，含带扩展名形式如 `CON.txt`） | Windows 保留设备名——三平台统一拒绝（跨平台一致性优先于平台差异化宽松） |
| 4 | 禁止 `.` 与 `..` | docs/03 §3.2-2（路径穿越防护） |
| 5 | 禁止尾随空格与尾随 `.` | Windows 会静默剥离尾随空格/点，导致导出后名称与库内不一致 |

校验实现为纯函数 `validateNodeName(raw: string): string`（规范化通过则返回规范化后的名称，失败抛 `AppError(E_VFS_INVALID_NAME)`），置于 `src/main/vfs/`，供创建/重命名共用。根节点（`name=''`）不经过此校验（由迁移种子创建，不可重命名）。

## 7. VFS 服务设计

### 7.1 模块与 DTO

- 模块：`src/main/vfs/`（`vfsService.ts` 服务 + `nodeName.ts` 校验 + `mime.ts` 映射），事务只经由 §4 封装进入；
- `NodeMeta` DTO（宪法 A.7-2，plain object、可结构化克隆）：

```ts
interface NodeMeta {
  readonly id: number;
  readonly parentId: number | null;   // 根为 null
  readonly nodeType: 'dir' | 'file';
  readonly name: string;
  readonly virtualPath: string;
  readonly mimeType: string | null;   // 目录为 null
  readonly size: number;              // 文件字节数，目录恒 0
  readonly createdAt: string;         // ISO 8601 本地时区含偏移（§7.7）
  readonly updatedAt: string;
}
```

- 读写行模型 ≠ 查询参数 ≠ 响应 DTO，各自建模（宪法 A.7-4）。

### 7.2 MIME 映射

`mime.ts` 维护扩展名 → MIME 表（`text/html .html/.htm`、`text/css`、`text/javascript`、`text/plain`、`application/json`、`image/svg+xml`、`image/png|jpeg|gif|webp|avif`、`font/woff2`、`audio/mpeg`、`video/mp4`、`application/pdf` 等），未识别扩展名返回 `application/octet-stream`；目录 `mime_type = NULL`。M3 的 `vfs://` 协议（Content-Type）与本文共用此表，保证库内元数据与协议响应一致。

### 7.3 服务接口清单（对应 FR 编号）

| 方法 | 入参（具名对象） | 返回 | 错误码 | FR |
| --- | --- | --- | --- | --- |
| `listChildren` | `{ parentId } \| { virtualPath }`（二选一，zod 校验互斥） | `NodeMeta[]`（按 node_type, name 排序，仅未删除） | `E_VFS_NOT_FOUND` | FR-VFS-02/08 |
| `createNode` | `{ parentId, name, nodeType: 'dir'\|'file', content?: Uint8Array }` | `NodeMeta` | `E_VFS_NOT_FOUND` / `E_VFS_INVALID_NAME` / `E_VFS_DUPLICATE_NAME` / `E_VFS_FILE_TOO_LARGE` | FR-VFS-01 |
| `readFile` | `{ nodeId }` | `{ content: Uint8Array, meta: NodeMeta }` | `E_VFS_NOT_FOUND` / `E_VFS_TYPE_MISMATCH`（目录） | FR-VFS-02 |
| `writeFile` | `{ nodeId, content: Uint8Array }` | `NodeMeta` | 同 create（不含 `E_VFS_DUPLICATE_NAME`） | FR-VFS-03 |
| `renameNode` | `{ nodeId, newName }` | `{ affectedCount: number }`（子树级联条数） | `E_VFS_NOT_FOUND` / `E_VFS_INVALID_NAME` / `E_VFS_DUPLICATE_NAME` | FR-VFS-04 |
| `moveNode` | `{ nodeId, targetDirId }` | `{ affectedCount: number }` | `E_VFS_NOT_FOUND` / `E_VFS_INVALID_MOVE` / `E_VFS_DUPLICATE_NAME` | FR-VFS-05 |
| `trashNode` | `{ nodeId }` | `{ affectedCount: number }` | `E_VFS_NOT_FOUND`（根节点拒绝删除同此码） | FR-VFS-06 |
| `restoreNode` | `{ nodeId }` | `NodeMeta` | `E_VFS_NOT_FOUND` / `E_VFS_DUPLICATE_NAME` | FR-VFS-06 |
| `purgeNode` | `{ nodeId }` | `{ purgedCount: number }` | `E_VFS_NOT_FOUND` | FR-VFS-06 |
| `resolvePath` | `{ virtualPath: string }` | `{ nodeId: number }` | `E_VFS_NOT_FOUND` | FR-VFS-07 |

补充约定：`content` 在跨进程契约层用 `Uint8Array`（Electron 结构化克隆对 Buffer 的传输形态），主进程内部以 `Buffer` 读写 BLOB（宪法 A.4-7）；`size > 0` 的目录被 `readFile`/`writeFile` 视为类型不匹配。`E_VFS_TYPE_MISMATCH` 为本文新增码（docs/03 §7.3 为节选，全量以 `errors.ts` 为准）。

### 7.4 路径物化与级联更新

`virtual_path` 物化规则：分隔符 `/`；子节点路径 = 父路径（去尾 `/`）+ `/` + name；根恒为 `/`。

**重命名 / 移动的子树级联**（单事务内两条 SQL，避免 LIKE 通配符转义问题，用 `substr` 前缀比较）：

```sql
-- oldPath = 被改节点旧路径，newPath = 新路径（rename）或 targetDirPath + '/' + name（move）
UPDATE node
SET virtual_path = @newPath || substr(virtual_path, length(@oldPath) + 1)
WHERE virtual_path = @oldPath
   OR substr(virtual_path, 1, length(@oldPath) + 1) = @oldPath || '/';
```

- 前缀比较不会误伤兄弟节点（`/a` 只匹配 `/a` 与 `/a/…`，不匹配 `/ab`）；
- 语句内各行新路径互异且与未更新行互异，行级 UNIQUE 检查不会产生中间态假冲突；「移入自身/后代」由 §7.5 环检测事前拒绝，不存在 `newPath` 落在 `oldPath` 子树内的更新；
- 子树定位复用同一谓词（`SELECT id ... WHERE` 同条件）计算 `affectedCount` 与 FTS 行范围。

### 7.5 删除 / 还原 / 彻底删除语义

- **trashNode（软删除）**：单事务内 ① 先删子树 FTS 索引行（宪法 A.4-10：先索引后业务）② 再 `UPDATE node SET deleted_at = ? WHERE <子树谓词>`。partial unique index（`WHERE deleted_at IS NULL`）随即让出同名空间，同名新建合法；
- **restoreNode**：要求节点仍在回收站，且**父目录链未删除**——父节点（或任一祖先）仍在回收站时还原不可达，返回 `E_VFS_NOT_FOUND`（docs/03 §7.3 该码定义「节点不存在或已在回收站」，语义覆盖；用户应先还原其父目录，回收站 UI 按原路径展示引导）。原位置重名**不预查询**，直接依赖 partial unique index 报 `SQLITE_CONSTRAINT_UNIQUE` → §5 映射 `E_VFS_DUPLICATE_NAME`；还原成功同事务重建子树 FTS 行；
- **purgeNode**：物理 `DELETE` 子树行。**不变式：回收站内的节点必无 FTS 行**（trash 时已删），故 purge 不触碰 FTS；FK `ON DELETE CASCADE` 作为孤儿兜底（正常路径子树谓词已显式覆盖）；
- 根节点（id=1）不可 trash/rename/move，服务层显式拒绝。

### 7.6 回收站保留策略（决策：不自动清理）

- **不做任何自动清理**：软删除节点无限期保留，仅经回收站 UI 的「彻底删除 / 清空回收站」（M8 里程碑）物理移除；
- 理由：产品定位是学习笔记管理，误删文档的长期可恢复价值高于磁盘空间收益；库体积增长由用户显式管理；
- docs/03 FR-AUX-01 的回收站能力不受影响；「按保留天数自动清理」若未来需要，属新增需求（先改 docs/03），本期仅在设置 schema 预留说明，不实现。

### 7.7 FTS 写侧同步（M1 就位，查询侧归 M2）

`node_fts(name, body)` 普通表，rowid = node.id，**写侧维护矩阵**（全部在与业务写同一事务内，docs/03 §3.2-4 / 宪法 A.4-4）：

| VFS 操作 | FTS 动作 |
| --- | --- |
| createNode(file) | `INSERT INTO node_fts(rowid, name, body) VALUES (?, ?, ?)` |
| createNode(dir) | 同上，`body = ''` |
| writeFile | `UPDATE`（rowid 定位，重写 body；name 不变） |
| renameNode | `UPDATE`（仅 name；子树其余节点 name 不变，路径级联不影响 FTS 列值） |
| moveNode | 无（name 与 body 均不变） |
| trashNode | `DELETE`（子树全部，先于业务表 UPDATE） |
| restoreNode | `INSERT`（子树全部，随业务同事务） |
| purgeNode | 无（不变式：回收站节点无 FTS 行） |

**body 提取规则**：`mime_type` 以 `text/` 开头（或 `application/json`、`application/javascript`）的文件，body = content 按 UTF-8 解码；二进制类型 body = `''`。M2 搜索的检索语法与排序不在本文范围（docs/05）。

### 7.8 时间戳

统一 `src/shared/time.ts` 的 `toLocalIsoTime(date: Date): string`（如 `2026-09-16T14:30:00.000+08:00`，本地时区含偏移，docs/03 §3.2-5）；`created_at`/`updated_at` 由服务层写入，`updated_at` 在一切写操作（含 rename/move/trash 级联）中刷新为同一事务时间戳。

## 8. IPC 契约与 zod v4 习语

### 8.1 通道清单（docs/03 §7.1 的 M1 子集）

`vfs:list` / `vfs:create` / `vfs:read` / `vfs:write` / `vfs:rename` / `vfs:move` / `vfs:trash` / `vfs:restore` / `vfs:purge` / `vfs:resolve`，另有主→渲染事件 `vfs:changed`（docs/03 §7.1）。全部沿用 M0 样板：通道常量入 `src/shared/ipc.ts`；请求/响应类型 + zod schema 入 `src/shared/vfs-contract.ts`（`z.infer` 推导类型，宪法 A.7-5）；handler 入口 `senderFrame` origin 白名单 + `safeParse`，校验失败统一 `E_IPC_BAD_PAYLOAD`；返回 Result DTO。

`vfs:changed` 事件为可辨识联合（宪法 B.3-4：**事务提交成功后**由主进程发出，事务内禁止广播）：

```ts
type VfsChangedEvent =
  | { type: 'created'; node: NodeMeta }
  | { type: 'written'; node: NodeMeta }
  | { type: 'renamed'; nodeId: number; affectedCount: number }
  | { type: 'moved'; nodeId: number; affectedCount: number }
  | { type: 'trashed'; nodeId: number; affectedCount: number }
  | { type: 'restored'; node: NodeMeta }
  | { type: 'purged'; nodeId: number; purgedCount: number };
```

### 8.2 zod v4 习语（待调研项闭环）

zod 4.6.x 相对 v3 的破坏点已核对官方迁移指南，对本项目结论：

1. 基础用法（`z.object` / `z.string` / `z.literal` / `z.enum` / `z.union` / `safeParse`）无破坏，直接使用；
2. **不做逐字段错误消息定制**（统一 `E_IPC_BAD_PAYLOAD`），因此 v4 的 `message`→`error` 参数变化对本项目零影响；
3. 禁用已废弃形态：方法式格式校验（`z.string().email()`）、`.strict()/.passthrough()`（用 `z.strictObject()/z.looseObject()` 或默认 strip）、`superRefine` 的 `ctx.path`、`ZodError.errors`（用 `.issues`）；
4. `Uint8Array` 载荷用 `z.instanceof(Uint8Array)` 校验（IPC 结构化克隆形态）。

TASK.md「待调研项」中 zod 行以本节结论关闭。

## 9. 备份机制（FR-STORE-04，机制本文定稿，里程碑归属 M5）

1. **触发**：每日首次启动（本地日期比对 `last-backup.json` 记录的上次备份日期）+ 设置页手动触发；
2. **执行序**（宪法 A.4-9 / 调研 A4-14）：`PRAGMA wal_checkpoint(RESTART)` 跑完 → 确认 `db.inTransaction === false` → 整文件复制到 `backups/learningtext-YYYYMMDD-HHmmss.db`；
3. **滚动保留 7 份**：按文件名时间戳排序，超出删除最旧；
4. **恢复**：引导式（用户选择备份文件替换 / 应用启动时检测），M5 细化交互，机制不变；
5. 大库备份耗时风险的异步化（docs/03 R5）随 M5 实现，本期不做。

## 10. 性能与测试策略

- **索引支撑**：`listChildren` 走 `idx_node_parent`；路径解析与级联走 `virtual_path` UNIQUE 索引与 §7.4 前缀谓词（全表扫描仅发生在无索引前缀查询，已规避）；
- **性能验证（集成测试基准用例，对应 NFR-02）**：种子 1 万节点后 `listChildren` 单目录 < 100ms；万节点库启动（开库 + 迁移 + 根查询）< 2s（NFR-01，CI 三平台跑绝对值波动大，阈值在测试中断言为宽松上限并允许环境因子注释）；
- **测试分层**：单元（名称校验、MIME、时间格式化、错误映射——纯函数）；集成（临时文件库跑真实 WAL + 迁移 + 全部 FR-VFS 用例：级联路径、软删除让名、还原撞名、FTS 同步断言、事务回滚原子性、`SQLITE_BUSY` 映射）；渲染端契约以 E2E 归 M4；
- **覆盖率**：存储 + VFS 属核心链路，按宪法 A.6-3 维持 100%。

## 11. 对上游的补充裁决清单（评审重点）

以下为本文新增、docs/03 未明确或需追认的实现级裁决，均不与 docs/03 冲突：

1. 迁移为 TS 模块注册表形态；幂等 = 执行器版本判断，脚本内禁防御性子句（§3.1/3.2）；
2. `runWriteTransaction` 单入口 + IMMEDIATE；SQLITE_BUSY 不自动重试、映射 `E_STORE_BUSY` 用户提示（§4）；
3. 名称校验取三平台最严并集 + NFC 规范化 + 尾随空格/点拒绝（§6）；
4. 回收站**不自动清理**；「按天清理」列为未来需求（§7.6）；
5. 新增错误码 `E_VFS_TYPE_MISMATCH`、`E_STORE_BUSY`、`E_STORE_DISK_FULL`、`E_STORE_INTERNAL`（§5/§7.3，docs/03 §7.3 为节选）；
6. FTS body 提取规则：文本类 MIME 才入 body，二进制为空串（§7.7）；
7. 备份标记用 `last-backup.json` 文件而非数据库表（不触碰 docs/03 §3.1 表结构）（§9.3）；
8. M1 范围含 FTS **写侧**同步（表与维护逻辑），FTS 查询侧归 M2（§7.7）。
