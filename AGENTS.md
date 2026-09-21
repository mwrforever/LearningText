# LearningText 工程宪法（AGENTS.md）

> 本文件是本仓库**最高工程规范**（整仓单应用：定位层职责与子项目宪法深度合一，全仓库仅此一份实体）。
> **只存工程原则与约束**：功能设计与业务数据契约见 `docs/` 设计文档（职责见下方「配套文件职责」），待办见 `TASK.md`，变更记录见 `CHANGELOG.md`（先记再改），本文档均不重复。
> **强制阅读路由**：写本仓库任何代码前必读本文件；Part A/B/C 对一切编码行为生效。
> 任何与本文档冲突的代码或设计**不得合入主分支**。
> **全局约束引用**：注释规范见全局 `~/.zcode/AGENTS.md` §一，日志规范见其 §二，测试与死代码规范见其 §四，行为准则见其 §五，编码基础（UTF-8 无 BOM / LF / 中文注释）见其 §〇——均强制生效，本文不复制正文（A.6 仅有工程化补充）。

**配套文件职责（全体系唯一声明落点）**

| 文件/目录                  | 职责                                  |
| ---------------------- | ----------------------------------- |
| `TASK.md`              | 登记台：待调研项 / 待决策 / 待回填 / TODO，回填后删除条目 |
| `CHANGELOG.md`         | 工程变更记录：宪法修订**先记再改**，追加式保留历史         |
| `docs/01~03-*.md`      | 业务功能设计与需求基线（specs 职责），宪法只引用不复制      |
| `docs/agmds-research/` | 宪法调研报告（条款来源证据，正文不逐条标注）              |

**三段结构**：Part A Electron + TypeScript 全栈通用 / Part B 架构分层（Electron 进程模型）/ Part C LearningText 实际。
（槽位说明：A.3 API 设计省略——本项目无对外 HTTP API，IPC 契约约束见 A.7 与 B.2；B.4 外部能力网关省略——无外部网关；C.3 目录结构省略——并入 B.1 注释式目录规范；省略槽位编号不重排。宪法只存工程原则与约束，**实现类工作一律登记 `TASK.md` 执行项，不入宪法**。）

## 1. 项目定位与仓库地图

LearningText 是跨平台桌面端 HTML 文档管理与实时预览工具（Electron 整仓单应用）：文档存于单个 SQLite 数据库，由自建虚拟文件系统（VFS）管理，实时预览与浏览器渲染完全一致，支持模糊搜索。仓库地图（仅一层，`M0` 标记为脚手架阶段落地目标）：

```text
LearningText/
├── AGENTS.md / CLAUDE.md   # 宪法实体 / 根索引（全项目仅此一份索引）
├── TASK.md                 # 登记台（待调研 / 待决策 / 待回填）
├── CHANGELOG.md            # 变更记录（先记再改）
├── README.md               # 项目导览
├── scripts/                # 工程脚本（check:preload 产物守卫、start.sh/start.bat 启动脚本）
├── docs/                   # 设计文档与调研报告（见「配套文件职责」）
├── .github/workflows/      # CI 工作流（ci.yml，门禁基线见 C.5）      [M0]
├── src/main|preload|renderer|shared/  # 主进程 / 桥 / 渲染层 / 共享契约（内部结构见 B.1）[M0]
├── tests/                  # unit / integration / e2e               [M0]
└── .nvmrc / eslint.config.* / electron-builder.yml / playwright.config.ts / vitest 配置 [M0]
```

命令总览：`npm run dev` 启动开发、`npm test` 全量测试、`npm run build` 生产构建——根命令即整个应用（无子项目），全量清单见 C.4。

## 2. 约束效力与遵从总则

1. **强制生效**：本宪法（含跨切约定）对一切开发行为（编码 / 设计 / 脚本 / CI / 文档）强制生效；引用的全局 `~/.zcode/AGENTS.md` 同样强制生效。
2. **不得违背**：冲突以宪法为准，冲突产物不得合入主分支；禁止「临时 / 紧急」绕过——修宪先记 `CHANGELOG.md` 再改正文，一次性事项登记 `TASK.md` 待决策并限定范围。
3. **遵从路径**：动手前通读本文件；实现细节问题先查 `docs/agmds-research/` 对应调研报告，仍无依据再立项调研，禁止凭记忆编造规范。
4. **裁决顺序**：本文档未规定的事项遵引用的全局约束文件；全局与本文档冲突时以本文档（更特化）为准；业务需求以 `docs/03-全局需求规格说明书.md` 为基线，工程约束以本文档为准。

## 3. 跨切约定

- **文档同步**：需求变更先改 `docs/03` 再动代码；宪法修订先记 `CHANGELOG.md`；文档与代码不一致视为缺陷。
- **编码基线**：全仓 UTF-8 无 BOM、LF 行尾、中文注释，由 `.gitattributes` / `.editorconfig` 强制承载，修改这两个文件视同修宪。
- **CI 链总则**：主分支受分支保护硬门禁约束，任何检查失败阻断合入、禁止人工绕过；工具与门禁基线的精简描述见 C.5，落地方案属执行项（登记 `TASK.md`，不入宪法）。

---

# Part A — Electron + TypeScript 全栈通用规范

## A.1 编码约束

1. TypeScript `strict: true` 全家桶为唯一基线，禁局部关闭 `strictNullChecks` / `noImplicitAny`；启用 `noUncheckedIndexedAccess`（下标访问一律先判空）。
2. 版本政策：跟随各依赖最新稳定大版本、锁定精确小版本；TypeScript / Electron 大版本升级必须走独立 PR 并通过全量测试（对应全局 §六 CI 阻断）。
3. 禁隐式 `any`；显式 `any` 仅允许「第三方无类型过渡」「渐进迁移点」两类场景且必须行注释说明；优先 `unknown` + 类型收窄。
4. 多形态数据（IPC 消息、命令、状态机）必须用可辨识联合（公共字面量判别字段），`switch` 配 `never` 穷举兜底；禁用「可选属性单 interface」编码消息协议。
5. 非空断言 `!` 与类型断言 `as` 禁用于 IPC 边界、外部输入解析、schema 校验之前；`as` 仅限掌握超集信息并行注释理由。
6. 默认用 `interface`；需要联合 / 元组 / 映射类型 / 原始类型别名时用 `type`。
7. 异步界限：渲染进程禁 `sendSync`，IPC 边界永远异步；主进程内允许同步 SQLite **短临界区**，可预期大批量 / 长事务（导入、重建索引）必须剥离 utility process / worker 或分批；禁止以任何形式把数据库同步句柄暴露给渲染端。
8. 产物形态：渲染端由 Vite 构建为 ESM、目标 Chromium，禁引入 `@vitejs/plugin-legacy` 与 polyfill。
9. CodeMirror 的 `EditorState` / `Text` / decoration 集合视为不可变值，禁止原地修改，变更一律走 transaction / 新建状态。
10. React 组件渲染期间禁改 props / state / context / 模块级全局；禁对 state 用原地变更数组的方法（push/pop/reverse/sort）；副作用只放事件处理器，`useEffect` 为最后手段。

## A.2 配置管理

1. 用户设置与用户数据**默认**写 `app.getPath('userData')` 下应用专属子目录；允许用户在设置中更改数据根目录并提供迁移能力（数据根由 userData 直下指针文件 `data-dir.json` 记录——该文件是 userData 直下唯一例外）；`userData` 禁放大文件——文档正文一律进 SQLite BLOB（C.2 选型）。
2. 环境变量只在主进程读取；渲染进程需要时由主进程经 IPC 显式下发白名单字段。
3. 渲染端构建期常量仅经 `VITE_` 前缀注入、经 `import.meta.env` 读取；**禁止把敏感值放入任何 `VITE_*` 变量**（会打进产物）。
4. `.env.local` / `.env.*.local` 必须进 `.gitignore`；渲染端 env 类型扩展写在 `src/vite-env.d.ts`。
5. 构建模式切换用 `--mode` + `.env.[mode]`，禁挪用 `NODE_ENV` 表达业务模式。
6. 运行时可变配置（编辑去抖、预览刷新策略等）属「用户设置」：走 userData 配置文件并经 IPC 读写，不用环境变量表达。

## A.4 数据库操作（better-sqlite3 + SQLite）

1. **连接单例**：主进程启动时打开一次、应用退出前 `db.close()` 优雅关闭；禁止按请求开关连接。
2. **初始化 PRAGMA**：连接打开后立即设 `journal_mode=WAL`、`foreign_keys=ON`（事务内设置无效，必须在事务外）、`busy_timeout` 沿用默认；`synchronous` 保持 WAL 默认 NORMAL，持久性由每日滚动备份补偿（裁决：不升 FULL）。
3. **迁移强制**：表结构变更一律走迁移；版本存 `PRAGMA user_version`，脚本按版本顺序编号、幂等、**只升不降**；单个迁移的全部 DDL 与 `user_version` 写入必须在同一事务内，用 `db.exec` 执行、出错整体回滚并中止启动。
4. **事务边界（宪法级）**：任何「业务表写 + FTS 索引写」必须包在同一 `db.transaction()` 内；写事务用 `.immediate()` 变体；事务包装函数内禁裸 `BEGIN/COMMIT/ROLLBACK`、禁 async 函数、事务不得跨事件循环 tick；捕获 SQLite 错误后先判 `db.inTransaction` 再决定回滚语义。
5. **查询安全（宪法级）**：SQL 一律 `db.prepare` + 绑定参数，**禁止字符串拼接**（尤其含用户输入的搜索词）；高频语句模块级创建一次复用；单语句绑定参数 ≤32766，超出分批。
6. 结果集：大量或需提前退出用 `.iterate()`；`.all()` 仅限量级可控；批量写入合并进单事务，禁逐条自动提交。
7. BLOB：以 `Buffer` 读写；单文件 50MB 上限由应用层写入前校验；50MB 级读写必须移出交互关键路径（合并进保存事务 / 空闲期执行）。
8. 错误处理：按 `SqliteError.code` 分支（如 `SQLITE_CONSTRAINT_UNIQUE`）；`SQLITE_BUSY` 是 WAL 下合法边缘事件，必须具备重试或用户提示路径。
9. 备份纪律：整文件复制前必须完成 WAL checkpoint 并确认无活动写事务（裁决：空闲时刻 checkpoint + 复制，实现最薄）；官方等价替代为 `db.backup()`。
10. FTS 契约：索引行 `rowid` = 业务节点 id；**删除先删索引行、后删业务行**；一致性校验用 `integrity-check` / `rebuild`；`optimize` 仅限空闲期，禁业务运行期无脑执行。
11. trigram 查询边界：全文 / LIKE / GLOB 检索入口强制最短 3 个 Unicode 字符，不足走回退策略（不发起索引查询）；实现必须避开「`case_sensitive=1` 时 LIKE 不可优化」「LIKE 带 ESCAPE 无法走索引」等退化形态。

## A.5 基础设施与进程生命周期

1. 主进程模块顶层只做装配：服务显式初始化（数据库打开与迁移 → 协议注册 → 窗口创建，fail-fast，迁移失败阻止启动）；显式释放（退出前关库、解绑 handler）。
2. 原生模块：better-sqlite3 锁定 13.x；**每次 `npm install` 后重跑 electron-rebuild**（脚本化，见 C.4 `rebuild`）；升级 Electron 大版本后必须验证 ABI 重编译；打包时 `.node` 文件必须 asar unpack。
3. Windows 构建环境：项目路径禁空格与特殊字符；安装失败清理 `node_modules` 与 `~/.node-gyp` 重试。
4. 同步阻塞纪律：UI 交互路径内禁止可预期的大批量 / 大 BLOB 同步操作，此类操作移入独立连接的 worker 或拆分为空闲期小事务（量化毫秒预算实测后回填，见 `TASK.md`）。（M1 实测预算：交互路径单事务 ≤ 200 ms——依据万行级写入/查询实测 ×10 余量取整）（M2 复核含 FTS 写入与服务层查询实测：≤ 3500 ms——口径升级后原结论上调，v2 换表属启动期一次性成本不入交互预算）
5. CPU 密集 / 易崩任务（大文件导入、全库重建索引）从主进程剥离到 utility process（M0 可先以分批事务替代，原则不可违背）。

## A.6 注释 / 日志 / 测试

注释、日志、测试与死代码规范见全局 `~/.zcode/AGENTS.md` §一 / §二 / §四，强制生效。本项目工程化补充：

1. 测试命名：单元 / 集成为 `*.test.ts`（Vitest `test.projects` 拆 `unit` / `integration`，禁用已废弃的 workspace 文件），E2E 为 `*.spec.ts`（Playwright）。
2. 测试环境：默认 `node`；仅渲染层组件测试用 `jsdom` / `happy-dom`，按需最小化。
3. 覆盖率：provider 用 `v8`，`@vitest/coverage-v8` 与 vitest 版本**严格一致**；必须显式 `coverage.include: ['src/**/*.{ts,tsx}']`（否则漏测文件不计入）；门禁阈值 `coverage.thresholds` 按全局 §四口径：核心链路（VFS 事务 / 搜索一致性 / 状态变更 / IPC 接口）100%，非核心 ≥80%。
4. E2E 稳定性：配置 `retries` + `trace: 'on-first-retry'`；CI 加 `--forbid-only`；失败报告照常上传不拦截门禁。
5. Vitest 5 写法红线：`vi.mock` / `vi.hoisted` 必须模块顶层；异步断言必须 `await`；`clearMocks` 默认已为 `true`（setup 文件中记录的调用会被清空）。

## A.7 跨层数据对象与传参约束（必含）

以下为通用三原则 + 例外边界按 TypeScript / Electron 习语的翻译，**必须按此成文执行**：

1. **参数对象化**：公开函数形参超过 3 个必须收单个具名对象（IPC payload、组件 props、transaction spec 形态），禁逐参罗列；仅业务确需灵活传参可例外。
2. **返回业务对象**：跨进程 / 服务层返回必须是可结构化克隆的 plain DTO（字段明确、可空字段显式 `| null`），禁返回类实例 / DOM / 句柄，禁以 `undefined` 表达「未找到 / 取消 / 失败」等多态语义；请求与响应分别建模，禁同一对象双向复用。
3. **IPC 错误显式建模**：`ipcMain.handle` 抛错序列化后渲染端只余 message——跨进程错误一律返回 Result 型 DTO（`ok` / `error` + 业务错误码 + 面向用户消息），不依赖异常透传。
4. **职责隔离**：查询参数 ≠ 响应 DTO ≠ 存储行模型，字段全同也各自建模；禁万能对象承载多职责；桥接面最小化——preload 每通道暴露一个具名包装函数，渲染端不感知 `ipcRenderer` 与通道字符串（含回调包装 `(_event, value) => callback(value)`，禁透传原始回调）。
5. **契约单一来源**：`src/shared/` 集中定义通道名常量 + 请求 / 响应类型 + zod schema（`z.infer` 推导类型）；主进程 handler 入口 `safeParse`，失败返回统一错误码；主→渲染事件与命令消息用可辨识联合建模。
6. **React / CodeMirror 习语**：props 只读、子→父只经 `onXxx` 回调、受控组件 = `value` + `onChange`、状态提升到最近公共父；列表 key 用稳定业务 id（VFS 节点 id），禁无脑数组索引；集合一律不可变更新；编辑器能力封装为返回 extension 的工厂函数，文档内容只经 `view.dispatch` 变更。
7. **例外边界**：仅业务功能确需动态 / 灵活结构可偏离，且须能陈述业务理由；无理由的违反视为缺陷，不得合入。

---

# Part B — 架构分层（Electron 进程模型）

## B.1 目录职责边界与结构规范（C.3 并入本节，全仓唯一目录权威）

```text
src/
├── main/                      # 主进程：唯一持有 Node / SQLite / 文件系统能力；窗口、生命周期、原生 API
│   ├── app.ts                 #   装配入口：开库 → 迁移 → 协议 → 窗口（fail-fast，见 B.3-1）
│   ├── ipc.ts                 #   IPC handler 集中注册：origin+zod 两道校验、Result 转换、变更广播
│   ├── security.ts            #   origin 白名单判断（B.5-4，纯函数）
│   ├── store/                 #   存储层：连接单例、迁移（migrations/）、事务、备份——事务边界唯一归属地（A.4）
│   ├── vfs/                   #   虚拟文件系统服务：节点树、路径解析、软删除
│   ├── search/                #   搜索服务：FTS5 索引维护与查询
│   ├── io/                    #   导入导出服务
│   └── protocol/              #   vfs:// 自定义协议：只读资源出口（B.5-2）
├── preload/                   # 桥层：仅 contextBridge 暴露类型化 API；禁业务逻辑、禁暴露 ipcRenderer 本体
├── renderer/                  # 渲染进程：React UI，只写 Web 标准代码；无 require / Node，禁文件与系统直接访问
│   ├── features/              #   界面域按功能分目录：tree/ editor/ preview/ search/ settings/（M0 可细化）
│   └── vite-env.d.ts          #   渲染端 env 类型扩展（A.2-4），禁写 import
└── shared/                    # 三端共享契约：通道常量、请求/响应类型、zod schema、错误码
                               #   纯类型与常量，无运行时副作用，禁 import 任何进程专属模块
tests/
├── unit/  integration/        # Vitest：*.test.ts，test.projects 拆分（A.6-1）
└── e2e/                       # Playwright _electron：*.spec.ts
dist/renderer/                 # Vite 输出（裁决：显式 outDir）——构建产物，gitignore 禁提交
release/                       # electron-builder 输出（裁决：output=release/）——构建产物，gitignore 禁提交
```

注：`features/` 内部组织允许 M0 落地时细化，但 main / preload / renderer / shared 四大目录的职责边界不得调整（B.2 依赖方向以此为锚）。

## B.2 层级依赖（强制）

```text
src/renderer ──(window.api 类型化桥)──▶ src/preload ──(ipcMain.handle)──▶ src/main ──▶ SQLite
     │                                     │                                 │
     └──────────（仅类型）─────────────────┴──────── src/shared ◀────────────┘
```

1. 依赖方向单向：`renderer → preload → main`；三端均可依赖 `shared`；`shared` 不依赖任何一方。
2. 禁跨层直连：渲染端禁 import 主进程模块（用官方子路径别名 `electron/main` / `electron/renderer` 配合 ESLint `no-restricted-imports` 在编译期拦截）；主进程禁 import 渲染端模块；禁循环依赖。
3. 事务边界只存在于主进程存储层（A.4）；渲染进程不感知事务。
4. IPC 模式：渲染→主一律 `invoke` / `handle`（禁 `sendSync`、禁遗留 `send + reply` 配对）；主→渲染用 `webContents.send`；渲染进程间不直接通信（经主进程中转或 MessagePort）。
5. IPC 通道命名 `<域>:<动作>`（如 `vfs:write`），常量集中于 `src/shared`。

## B.3 运行时原则

1. 启动顺序固定：打开数据库 → 执行迁移 → 注册 `vfs://` 协议与 IPC handler → 创建窗口；任一步失败即 fail-fast 退出，禁带伤运行。
2. IPC handler 集中注册、每通道两道校验：`senderFrame` origin 白名单 + zod `safeParse`（见 B.5 / A.7）。
3. 错误经 Result DTO 向渲染端透传（A.7-3）；主进程日志按全局 §二分级记录并含业务标识（节点 id、虚拟路径）。
4. **项目裁决**（依据 `docs/03-全局需求规格说明书.md` §2.2 一致性红线，非外部调研条款）：事件广播（树变更、导入进度）由主进程在**事务提交成功后**发出，禁止事务内提前广播。

## B.5 横切关注点（安全基线，全部为禁令）

1. 禁 `nodeIntegration` / `nodeIntegrationInWorker`；禁 `contextIsolation: false`；禁 `sandbox: false`；禁 `webSecurity: false`；禁 `allowRunningInsecureContent`；禁 `experimentalFeatures`；禁 `enableBlinkFeatures`。
2. 应用窗口只加载本地页面（自定义协议 / dev server），禁 `loadURL` 任意外部 URL；禁用 `file://` 加载应用页面与资源——VFS 资源一律经 `vfs://` 自定义协议。
3. 渲染页与预览模板必须带受限 CSP（`default-src 'self'`）。
4. 导航限制：`will-navigate` 按 URL origin 白名单拦截（用 URL 解析器比较，禁字符串前缀判断）；`setWindowOpenHandler` 一律 deny；`shell.openExternal` 仅接受 http(s) 白名单，禁透传用户可控数据。
5. 权限请求默认拒绝（`setPermissionRequestHandler`），未显式放行的一律拒。
6. 每个 `ipcMain.handle` 校验 `event.senderFrame` 的 origin（用 origin 不用 URL）。
7. 预览 iframe 沙箱化，无 Node、无真实文件系统访问，仅能触达 `vfs://` 只读资源。
8. 打包阶段用 `@electron/fuses` 关闭 `runAsNode` / `nodeCliInspect` 等不需要的 fuse（清单细则见 `TASK.md` 待调研项）。

---

# Part C — LearningText 实际

## C.1 定位

Electron 桌面端 HTML 文档管理与实时预览工具：VFS + SQLite 单库存储、Chromium 保真实时预览、FTS5 模糊搜索；业务需求基线见 `docs/03-全局需求规格说明书.md`。

## C.2 技术栈选型

版本为 2026-09-14 npm registry 实查基线（证据见 `docs/agmds-research/2026-09-14-语言框架与UI栈.md`、`2026-09-14-构建测试与打包.md`），精确小版本由 M0 在 `package-lock.json` 锁定：

| 职责         | 技术                                                                              | 基线版本                     |
| ---------- | ------------------------------------------------------------------------------- | ------------------------ |
| 运行时        | Node LTS（`.nvmrc` + `engines` 双写）                                               | 24 LTS                   |
| 桌面框架       | Electron                                                                        | 44.3.x                   |
| 语言         | TypeScript（strict）                                                              | 6.0.x                    |
| UI         | React                                                                           | 19.3.x                   |
| 构建渲染层      | Vite                                                                            | 8.3.x                    |
| 编辑器        | CodeMirror 6（curated 八包自组，版本见 package.json 精确锁定）                                | 6.0.x                    |
| 样式与组件体系    | Tailwind CSS v4（@tailwindcss/vite，CSS-first @theme）+ shadcn/ui（CLI 按需 add 组件源码） | 4.3.x / CLI 4.21.x       |
| 动画         | CSS transition（Tailwind 过渡工具类）+ tw-animate-css（进出场微动效，零运行时引入）；motion 为预留升级项（未安装，引入须论证第三方必要性） | 1.4.x                    |
| 编辑器主题      | @codemirror/theme-one-dark（暗色语法主题，随 UI 主题解析器联动）                                 | 实装日实查                    |
| 存储         | better-sqlite3（WAL + FTS5 trigram）                                              | 13.0.x                   |
| IPC / 参数校验 | zod                                                                             | 4.6.x                    |
| 单元 / 集成测试  | Vitest + @vitest/coverage-v8（严格同版）                                              | 5.0.x                    |
| E2E        | Playwright（`_electron` 驱动）                                                      | 1.63.x                   |
| 打包         | electron-builder（配置 `electron-builder.yml`）                                     | 26.15.x                  |
| 质量工具       | ESLint（flat config）+ typescript-eslint + Prettier                               | 10.10.x / 8.70.x / 3.9.x |
| 本地门禁       | husky + lint-staged                                                             | 9.1.x / 17.5.x           |
| 开发编排       | concurrently                                                                    | 10.x                     |

## C.4 常用命令（M0 落地后 package.json 必须与之对齐）

```bash
npm run dev              # 并行启动渲染层 dev server、preload rolldown watch 与主进程编译（concurrently，任一退出即全部退出）
npm run dev:preload      # preload rolldown watch（dev 三路编排之一，sandbox 单文件捆绑）
npm start                # 开发形态启动应用（electron .）
npm run build            # 完整生产构建：主进程编译 + vite build
npm run check:preload    # preload 产物守卫：断言 dist/preload/index.js 为 rolldown 单文件捆绑（sandbox 回归防护）
npm run preview          # 本地预览渲染层构建产物，禁作生产服务器
npm test                 # 全量测试门禁：unit + integration + e2e 串行，CI 与本地同一入口
npm run test:unit        # Vitest 单元（--project unit）
npm run test:integration # Vitest 集成（--project integration）
npm run test:e2e         # Playwright _electron E2E
npm run test:coverage    # 带覆盖率门禁的测试（A.6-3 阈值生效）
npm run lint             # ESLint 检查；lint:fix 为自动修复
npm run format           # Prettier 格式化；format:check 供 CI 校验
npm run typecheck        # tsc --noEmit 类型门禁
npm run rebuild          # electron-rebuild -f -w better-sqlite3（install 后必跑，A.5-2）
npm run package          # 三平台安装包；package:dir 为 --dir 未打包目录冒烟
npm run release          # 三平台构建并发布（M6 执行项，登记于 TASK.md）
```

## C.5 CI 链（精简描述；落地方案属执行项，不入宪法）

工具为 GitHub Actions，门禁基线为**方案 A「三平台全量严格矩阵」**（2026-09-14 经用户选定，调研与落选方案见 `docs/agmds-research/2026-09-14-CI链与生产落地.md`）。

1. **门禁语义（宪法级）**：main 分支保护开启必需检查，任何检查失败阻断合入，**禁止人工绕过**；本地 pre-commit 门禁（C.6-2）是前置减速带，不可与 CI 互相替代。
2. 工作流文件、触发面、矩阵、流水线阶段、缓存与产物策略等均为**执行项，不入宪法**：M0 按 `docs/agmds-research/2026-09-14-CI链与生产落地.md` §三方案 A 落地，跟踪见 `TASK.md`「执行项登记」。

## C.6 永久环境约束

1. Node 钉 24 LTS：`.nvmrc` 与 `package.json` `engines` 双写，CI 经 `node-version-file` 同源读取；换版本视同修宪。
2. husky v9：devDependencies + `"prepare": "husky"`；钩子脚本只写 POSIX shell（禁 bash 语法）；`.husky/pre-commit` 固定为一行 `npx lint-staged`（不手传文件名）；CI 安装依赖设 `HUSKY=0`。本地 pre-commit 门禁是 CI 门禁的前置减速带，两者不可互相替代。
3. Electron 二进制下载：离线 / 镜像场景用 `ELECTRON_MIRROR`、`ELECTRON_OVERRIDE_DIST_PATH`、`electron_config_cache`；**禁引入已证伪的 `ELECTRON_SKIP_BINARY_DOWNLOAD`**（当前安装脚本不检查该变量）。
4. ESLint 仅 flat config（`eslint.config.*`，v10 已移除 eslintrc）；产物目录进 `globalIgnores()`；Prettier 集成只允许 `eslint-config-prettier`，**禁引入 `eslint-plugin-prettier`**（官方不推荐）。
5. 测试产物目录 `coverage/`、`.vitest/`、`playwright-report/`、`test-results/` 必须进 `.gitignore`。
6. 升级预警：electron-builder v27 将更名 `electronDownload` → `electronGet`；升级 vitest 必须同步升级 `@vitest/coverage-v8` 且版本严格一致；升级 better-sqlite3 须同时核对包 semver 与捆绑 SQLite 版本变更（触发 A.4-3 迁移评审）。

## C.7 UI 设计思想 · 谋建琢三段律

> 凡涉 UI 工作，必循「谋 → 建 → 琢」三段闭环，顺序不可逆，缺一即违律。

**谋 · 谋局定策**

```text
────────────────────────────────────
 谋局定策 ｜ 前置思考 · 全局蓝图
────────────────────────────────────
 核心工具：@ui-ux-pro-max
 阶段职责：全局审视，敲定唯一最优方案
 · 通盘考量布局 / 样式 / 交互 / 动画四大维度
 · 持续思考、多轮推演、比较取舍
 · 拒绝第一直觉草率定案，方案成形方可推进
 ▸ 红线：未定蓝图，不得动工
```

**建 · 依图营造**

```text
────────────────────────────────────
 依图营造 ｜ 忠实实现 · 方案落地
────────────────────────────────────
 施工依据：谋局阶段产出的设计方案
 阶段职责：将既定方案完整转化为代码
 · 忠实执行设计决策，不偏移、不擅自降级
 · 结构清晰，为后续精修预留打磨空间
 · 以蓝图为唯一依据，不凭感觉发挥
 ▸ 红线：落地 ≠ 完成，粗成品严禁交付
```

**琢 · 琢玉成器**

```text
────────────────────────────────────
 琢玉成器 ｜ 深度打磨 · 精修收口
────────────────────────────────────
 核心工具：@taste-skill
 阶段职责：对成品全面深度打磨，逼近极致
 · 逐层打磨组件 / 样式 / 交互 / 动画
 · 剔除粗糙细节，雕琢质感与韵律
 · 四维验收：高级视觉 / 高级交互 /
             流畅动画 / 高性能渲染
 ▸ 红线：四维标准缺一，视为未完成
```

> **协作纪律**：凡派遣 subagent，必须在其指令中明确要求加载 `@ui-ux-pro-max` 与 `@taste-skill` 方可开工。
> **核心精神**：倾尽设计灵感、持续思考、拒绝模板化机械输出。
