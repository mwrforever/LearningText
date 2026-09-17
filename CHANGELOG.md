# CHANGELOG.md — 工程变更记录

> 规则：宪法体系（AGENTS.md / CLAUDE.md）及其配套文件修订**先在本文件登记，再改正文**；追加式，不删改历史条目。

## 2026-09-14

- **创建宪法体系**：`AGENTS.md`（整仓单应用，定位与深度合一）+ `CLAUDE.md`（根索引）+ `TASK.md`（登记台）+ 本文件。
- **CI 门禁方案选定：方案 A「三平台全量严格矩阵」**，经用户于 2026-09-14 选定；调研依据与落选方案（B 分层快速反馈 / C 严格+发布就绪）见 `docs/agmds-research/2026-09-14-CI链与生产落地.md`。方案 C 发布链登记为 M6 演进项（AGENTS.md C.5-7）。
- 宪法关键裁决（依据见对应调研报告）：
  - 产物目录：Vite 显式 `outDir=dist/renderer/`，electron-builder `output=release/`，解决两者默认 `dist/` 冲突（AGENTS.md C.3）；
  - Node 钉 24 LTS，`.nvmrc` + `engines` 双写（C.6-1）；
  - SQLite `synchronous` 保持 NORMAL，持久性由每日滚动备份补偿（A.4-2）；备份采用「空闲时刻 checkpoint + 整文件复制」（A.4-9）；
  - FTS 删除顺序固化为「先索引行后业务行」（A.4-10）；检索入口最短 3 字符边界（A.4-11）；
  - **事件广播时点**（B.3-4）为项目裁决：广播只能在事务提交成功后发出，依据 `docs/03` §2.2 一致性红线（无外部调研条款，审核轮次 1 登记）；
  - ESLint 10 仅 flat config；Prettier 集成仅 `eslint-config-prettier`，禁 `eslint-plugin-prettier`（C.6-4）；
  - 禁引入已证伪的 `ELECTRON_SKIP_BINARY_DOWNLOAD`（C.6-3）。
- 设计文档（docs/01~03）与技术栈同日建立，未发生宪法修订。

## 2026-09-15

- **C.2 TS 版线修正：TypeScript 7.0.x → 6.0.3（M0-Task 2 锁版预检）**：实查 `@typescript-eslint/parser@8.70.0` 的 peerDependencies 中 `typescript` 范围为 `>=4.8.4 <6.1.0`，不含 7.x（typescript-eslint 8.70.0 尚未适配 TS 7）；按 peer 约束取范围内最高精确版本 `6.0.3` 锁定。C.2 基线中 TypeScript 7.0.x 待 typescript-eslint 声明 7.x 支持后再升级，跟踪见 `TASK.md` 待决策表。
  - 补充（M0-Task 15 回填正文）：TS 6.0.3 下 `moduleResolution:"node"` 已弃用（TS5107），tsconfig.main / tsconfig.test 经用户裁决迁移 module/moduleResolution 双 `"nodenext"`（package.json 无 `"type"` 字段仍产出 CJS）；C.2 正文 TypeScript 行由 7.0.x 回填为 6.0.x。
- **宪法修订（先记后改，用户指令）**：
  - C.4 常用命令改为「代码块 + 注释」精简说明，删除表格形态；
  - B.1 目录职责边界与 C.3 目录结构**合并**为 B.1 注释式目录规范（C.3 槽位省略，编号不重排）；
  - C.5 由「CI 生产落地方案」细则全文**精简**为工具、选定方案与门禁语义的精简描述——工作流文件、矩阵、阶段、缓存、产物策略及 M6 发布链均属后续执行项，不入宪法，移登记至 `TASK.md`「执行项登记」。
- **M0-Task 15 收尾**：dev / main 分支保护经 GitHub API 配置生效（必需检查 = Task 14 三平台检查名 + 要求分支同步，禁强推 / 禁删除；main 不豁免管理员）；`rolldown@1.2.8` 由 vite 传递依赖显式化为直接 devDependency（`build:preload` 直调 CLI 不再是幻影依赖，版本与 vite 依赖树严格一致）；`TASK.md` 执行 M0 回填（精确版本锁定、目录 / 命令对齐、.nvmrc 双写三项销账，ci.yml 与分支保护执行项标记完成，新增 B.1 对齐回填待办与 M1 / M6 待办登记）。
- **M0 最终评审修复**：electron-builder `files` 补 `dist/shared/**/*`（tsconfig.main rootDir=src 将 shared 编译到 dist/shared，dist/main 产物 require `../shared/*`，此前打包产物缺该目录必崩）；`playwright.config.ts` 新增 `globalSetup`（`tests/e2e/global-setup.ts` 执行完整生产构建），干净检出下 `npm test` 无需手动 build，本地与 CI 语义一致；`TASK.md` 两处调整（B.1 + C.4 对齐回填差异点补注、preload 拆出条目提升 M1 前置）并新增 Vitest configLoader 'native' 待决策项。

## 2026-09-16

- **M1 实施计划定稿并标记 SDD 执行**：`docs/superpowers/plans/2026-09-16-M1-存储与VFS.md`（13 任务、TDD 粒度）；spec `docs/superpowers/specs/2026-09-16-存储与VFS-design.md` 定稿评审通过。
- **需求基线修订（先记后改）：docs/03 §3.1 `virtual_path` 唯一性由列级 UNIQUE 改为部分唯一索引** `idx_node_virtual_path ... WHERE deleted_at IS NULL`。裁决背景：SDD 执行 Task 9 发现基线内部矛盾——列级 UNIQUE 连软删行一并约束，与 FR-VFS-06「回收站让名 + 还原撞名报 `E_VFS_DUPLICATE_NAME`」及 spec §7.5「同名新建合法」互斥（软删行永久占用路径，两语义均不可达，Task 10 计划用例必然失败）。三方案（部分唯一索引 / trash 路径改写加后缀 / 放弃让名语义）经决策门提请用户裁决，用户未应答，按推荐方案自主裁决选**部分唯一索引**：改动最小、完整保留 FR-VFS-06 与 spec §7.5 已锁语义、索引与 `resolvePath` 查询谓词（`virtual_path = ? AND deleted_at IS NULL`）精确匹配、v1 迁移未发布可原地修正（无升级路径负担）。FR 条文本身零变更，仅 schema 机制修正；spec §10「virtual_path UNIQUE 索引」表述随之以部分唯一索引理解。落地：v1 迁移（`0001-initial.ts`）随 Task 10 同步调整。
- **A.5-4 同步阻塞毫秒预算回填——M1 基准实测：万文件单事务写入 20 ms、万行 listChildren 8.7 ms（Windows 本机，:memory:）；交互路径单事务预算定为 200 ms**（基准测试 `tests/integration/vfs/perf-baseline.test.ts`，三次运行取中位数；预算公式 `Z = ceil(max(X, Y) × 10 / 100) × 100` ms、下限 200 ms）。
- **B.1/C.4 对齐回填（M1 Task 13 收尾，先记后改）**：B.1 目录树补 `src/main/ipc.ts` 顶层文件与 `src/main/store/migrations/`、`src/main/security.ts`、`src/main/vfs/` 落位注记；C.4 dev 命令更新为三路编排（renderer/preload/main）并补 `dev:preload`、`check:preload` 说明。

## 2026-09-17

- **NFR-03 复核缺陷修复（Task 9 基准发现）：trigram 行查询列命中探针改物化 CTE**。M2 基准实测发现 `searchService` 行语句的两个列过滤 MATCH 探针以普通 FROM 派生表 LEFT JOIN 时，SQLite 对 FTS5 虚表派生表不自动物化，查询计划按外层命中行逐行重扫 MATCH（万级全命中实测 3s/查询，超 NFR-03 P95 红线 15 倍）；改为 `WITH ... AS MATERIALIZED` 物化后每探针仅执行一次（3s → 12ms），命中位/分数/片段语义逐字段不变（既有 21 个搜索集成用例全绿，红线由基准测试 `tests/integration/search/perf-baseline.test.ts` 锁死）。
- **A.5-4 复核回填——M2 基准实测：万行含 FTS 单事务写入 343 ms、search:query 万级 P95 17.7 ms、v2 换表迁移 24 ms、冷启动 10k 库 3 ms（Windows 本机中位，三次运行取中位数；基准 `tests/integration/search/perf-baseline.test.ts`）**；交互路径预算复核结论：M1 值 200ms **上调至 3500 ms**（按公式 `ceil(max(X′, Y′) × 10 / 100) × 100`、下限 200ms：max(343, 17.7) = 343 → ceil(34.3) × 100 = 3500；含 FTS 的万行批量写为预算主导项）。
