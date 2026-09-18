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
- **M2 搜索里程碑定稿（SDD 执行 Task 1-10 完毕）**：spec `docs/superpowers/specs/2026-09-17-搜索-design.md` 与实施计划 `docs/superpowers/plans/2026-09-17-M2-搜索.md` 定稿并全部落地。要点：
  - **v2 迁移语义**：trigram 分词器变更不可 ALTER，走「新建 → 复制 → 换名」换表重建（`0002-search-trigram.ts`）；迁移期先做行数对账（非根活节点数 = 索引行数，排除 id=1 根），不平即中止回滚保旧表；并对 `node(parent_id)` 建全量索引 `idx_node_parent_all`——回收站树下钻（递归 CTE）不被仅覆盖活行的部分索引漏掉；
  - **双通道检索设计**：索引通道 FTS5 `bm25(name×10, body×1)` 加权 + 稳定 tie-break 排序分页；不足 3 字符等退化查询走 LIKE 回退通道（A.4-11 边界，无分数、更新时间序，不承诺 P95 红线）；
  - **子树定位根治**：purge / underPath 过滤等子树圈定统一改 `parent_id` 递归 CTE 按树身份定位，替换路径前缀谓词，根治「同路径双回收站树」purge 连带误删；
  - **M1 遗留三项闭环**：`ListChildrenRequest` 改 `strictObject` 强制 parentId/virtualPath 互斥、moveNode 移到当前父目录短路返回 0（不再误报 DUPLICATE）、restoreNode 返回还原后新鲜 `meta.updatedAt`（广播同步新值）；**A.5-4 交互预算上调 3500 ms**（见本日上文复核回填条）；
  - **性能修复**：trigram 行查询列命中探针改物化 CTE（见本日上文首条，万级全命中 3s → 12ms）；
  - `TASK.md` 登记台 M2 触碰条目清零：待决策表删除已闭环四行（双回收站树 purge / ListChildrenRequest 互斥 / moveNode 同父 / restoreNode 新鲜值），并按 spec §7.1 预留登记 M5「搜索索引重建修复例程」执行项。
- **M2 终审修复波（单一提交）：limit 超限语义冲突裁决——遵循 spec §5 截断语义，修实现不动 spec**。终审发现 spec §5（用户定稿）「`limit` 硬上限 200（超限入参截断为 200）」与实现（契约 schema `max(200)` 拒绝 → E_IPC_BAD_PAYLOAD）不一致；控制器经决策门提请用户裁决未应答，按推荐自主裁决（M1 e17da0f 先例）：spec 为用户定稿决策文档，改 spec 属修宪级动作不宜自主执行，且服务层 `Math.min` 钳制已存在、改动最小。落地：`SearchQueryRequestSchema.limit` 去掉 `max(200)`（服务层钳制保留），单元/集成测试同步（201 接受、200 上界接受、超限截断行为断言）。同波其余修复：查询参数拒绝路径补 warn 日志（原因形态描述、不含关键词原文）；`SubtreeRowBase` 复用 `NodeRow` 消除双份手写行模型；集成测试补 trigram×nodeTypes 空集与 LIKE 名称命中 `bodySnippet=null` 断言、修正「afterEach 断言弱序」误导性注释；`TASK.md` 执行项登记 A.5-4 预算分档终审建议（下一修宪周期）。

## 2026-09-18

- **M3 预览里程碑定稿（SDD 执行 Task 1-8 完毕，Task 9 收尾）**：spec `docs/superpowers/specs/2026-09-18-预览-design.md` 与实施计划 `docs/superpowers/plans/2026-09-18-M3-预览.md` 定稿并全部落地。要点：
  - **vfs:// 协议语义定档**：standard scheme 注册 + `supportFetchAPI`/`stream`/`corsEnabled` 特权；响应统一 CORS（ACAO:*）、ETag（写入时 sha256 计算）+ If-None-Match 304、Range 单区间 206/416；iframe 沙箱（无 Node、仅触达 `vfs://` 只读资源）+ 受限 CSP；主文档 CSP 追加 `connect-src vfs:` 放行沙箱外验证性 fetch；
  - **rev 防撕裂契约变更（跨里程碑接口变更）**：VFS 变更广播载荷由裸 `VfsChangedEvent` 改型为 `{rev, event}`（rev = 主进程写事务提交自增版本号，消费侧比对丢弃过期刷新）——**M4 编辑器/树消费侧一律按 `{rev, event}` 形态解构**（Task 1 dc116f8 落地）；
  - **最小设置通道**：`settings:get` / `settings:set`（zod strictObject 校验，失败统一 E_IPC_BAD_PAYLOAD），文件首字段 `schemaVersion`（当前 1）为旧文件迁移闸；文件缺失/损坏/版本不识别 warn 回退默认值，不阻断启动；M3 仅承载预览去抖一键 `preview.debounceMs`（100–2000，默认 300）；
  - **最小三栏工作台**：树面板（懒加载 + stale 整层重取）/ 编辑区 / 预览面板（沙箱 iframe + `location.replace` 精确重载）装配完成；
  - **验收与性能实测**：E2E 8/8 通过（app 2 + preview 6，七项验收关键项全绿）；NFR-04（编辑→预览首帧一致，含 300 ms 去抖）三轮实测 343/350/351 ms、**中位 350 ms**（门禁 <2000 ms，余量充足；持续观测出口为 `npm run test:e2e` 输出的 `[perf-m3]` 行）。终审补强：E2E 补 304 子资源重验与 https 外链 CSP 阻断断言（终审 I-2）。
- **M3 执行中三项计划外勘误（探针实证产生，均已实施并评审通过；spec 与 docs 同步勘误对齐）**：
  1. **spec §2.2-3 单机制勘误（Task 3）**：WHATWG URL 解析器把规范编码点段（`%2e` 等四种规范形态）与字面点段按**同一机制**根锚定归一（Node 24 探针实证 `new URL("vfs:///a/%2E/b").pathname === "/a/b"`），v0.3「解析器归一 + 处理器点段检查」双机制前提作废；处理器保留残防线（空段/非法编码/host）。为什么：解析器行为是运行时权威事实，文档不得保留与实证相悖的机制划分。
  2. **固定 host 约定 `vfs://local/<virtualPath>`（产品修复波 f84d2bc）**：Blink（GURL）对 standard scheme 空 authority 形态「首段提为 host」（`vfs:///a.html` 规范化为 `vfs://a.html/`），与 Node WHATWG 不同构，空 host 路径式在导航链路不可达（产品死路）；裁决固定 host 约定——身份门仅放行 host `local`（shared 常量 `VFS_URL_HOST` 单一来源，`vfs://evil/` 拒绝语义保留）；spec §2.1/§2.2/§3.1/§9.1/§10-D1 与 docs/03 §7.2、docs/02 §D7 已勘误对齐。为什么：E2E 探针实证导航链路 URL 必变形，固定非空 host 是让 Blink 发起侧与 Node 解析侧同构的最小约定。
  3. **corsEnabled 特权 + 主文档 connect-src（7d729e5）**：vfs scheme 特权补 `corsEnabled: true`——Blink 的 CORS scheme 白名单不含自定义 scheme，缺它一切跨源 `fetch('vfs://…')` 在网络栈前即被拒、响应侧 ACAO:* 无从生效；主文档 CSP 追加 `connect-src vfs:`——缺它 fetch 被 `default-src 'self'` 回落拦截；spec §2.4 勘误。为什么：E2E console 探针分别坐实 CSP 回落拦截与 CORS scheme 白名单拒绝两条独立拦截面。
- **Task 8 E2E 实跑暴露三缺陷（各一句）**：缺陷 1——主文档 CSP 缺 `connect-src vfs:`，主 frame fetch 全拦，index.html 追加修复（f84d2bc）；缺陷 2——Blink 空 host「首段提为 host」致 iframe/`location.replace` 请求 URL 变形、vfs 资源导航链路全 404，固定 host `vfs://local` 约定修复（f84d2bc）；缺陷 3——vfs 特权缺 `corsEnabled: true` 致跨源 fetch 网络栈前拒绝，app.ts 特权一行修复（7d729e5）。
- **TASK.md 登记台收尾**：M3 触碰条目清零——待调研项删「`protocol.handle` API 细则（vfs:// 落地）」（spec §2.4 + Task 4 实测定档收口）、待撰写 spec 删「docs/06 预览管线详细设计」（spec 定稿，用户已书面评审确认）；执行项登记追加 M4「预览外壳批次」（FR-SHELL-01 折叠/记忆 + FR-SHELL-02 原生菜单快捷键 + P1 三项 + 编辑区 unsaved-guard）。
