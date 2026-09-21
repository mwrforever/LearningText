# CHANGELOG.md — 工程变更记录

> 规则：宪法体系（AGENTS.md / CLAUDE.md）及其配套文件修订**先在本文件登记，再改正文**；追加式，不删改历史条目。

## 2026-09-22

- **M6「产品化重构」里程碑出口达标（同日定稿、实施、验收）**：五提交落地（4da1246 基线 / dca5bf6 壳层 / 26aaed0 批次②③ / 1b5c9ed E2E 收敛与缺陷修复 / 09584b6 琢段打磨）。出口证据（Windows 本机实测，台账 `docs/progress/2026-09-22-M6产品化重构-进度台账.md`）：`npm test` 全绿（unit 505 / integration 133 / E2E 26）、coverage 过阈值（三域 100%）、typecheck/lint 零告警、`package:dir` 冒烟通过、NSIS 安装位置可选配置落地、`start.bat`/`start.sh` 实跑/语法验证通过。过程要点：
  - **三平台探针先行纪律再证**：标题栏探针（hidden 形态原生菜单栏不渲染 + overlay env 可读）回填 spec §2.2 后才动窗口创建；
  - **两处产品缺陷由 E2E 实跑捕获并修复**：侧栏分隔条 0px 命中区（flex 无宽度类 hit-test 永不命中）；注入桥 iframe 内 setTimeout 可被渲染器搁置致上报尾部丢失——改逐输入即时上报；
  - **start.bat ASCII 偏差留证**：zh-CN cmd 下 chcp 65001 + UTF-8 批处理解析失步（echo 文本被执行为命令，实跑实证），功能正确性优先消息 ASCII 化，中文说明保留在 start.sh/README；
  - 琢段按宪法 C.7 执行（subagent 加载 @ui-ux-pro-max 与 @taste-skill），十项纯呈现打磨 + 设计系统文档 §九同步，锚点红线（E2E）全绿背书；
  - 原 M6「三平台安装包安装后主链路手测」与 fuses/release 工作流仍属 M6 发布批次（TASK.md docs/09 行已更新覆盖范围）。

- **M6「产品化重构」里程碑启动（用户需求驱动，需求基线与宪法先行修订）**：UI 全量重构为 VS Code 式布局（自绘集成标题栏 + 活动栏 + 侧栏 + 编辑区标签 + 状态栏 + 欢迎页，功能按钮全面图标化 lucide-react）；HTML 编辑改为 Typora 式所见即所得（渲染面即编辑面，经用户确认不提供源码视图；CSS/JS 等非 HTML 文本保留 CodeMirror 源码编辑）；数据保存位置用户可选 + 迁移能力；NSIS 安装位置可选（`oneClick: false` + `allowToChangeInstallationDirectory`）；仓库根补 `start.sh` / `start.bat` 启动脚本。三项形态决策（自绘标题栏 / 纯所见即所得 / 设置标签页）经用户决策门确认，其余推演裁决见 spec `docs/superpowers/specs/2026-09-22-产品化UI重构-design.md`。
- **宪法修订（先记后改）**：
  - **A.2-1**：「用户设置与用户数据统一写 `app.getPath('userData')` 下应用专属子目录」修订为「**默认**写 userData 下应用专属子目录，允许用户在设置中更改数据根目录并迁移（数据根由 userData 直下唯一例外指针文件 `data-dir.json` 记录）；userData 禁放大文件不变」——支撑数据目录用户可选需求；
  - **§1 仓库地图**：补 `scripts/` 一层条目（工程脚本：preload 产物守卫、start 启动脚本），该目录 M0 起实际存在，本次地图对齐。
- **需求基线修订（先记后改；docs/01 与 docs/03 同步）**：
  - docs/01 §1 核心体验第 2 条改为「所见即所得编辑 HTML：渲染结果即编辑面」；§3 M1 职责布局描述改为 VS Code 式四区（标题栏/活动栏+侧栏/编辑区/状态栏）；M4 增加「所见即所得编辑画布」职责并退役滚动同步；M5 边界「不做可视化所见即所得编辑」改写为「HTML 走所见即所得（仅既有元素内容级简单修改），源码编辑保留用于 CSS/JS/纯文本」；M8 设置职责「数据库位置查看」升级为「数据目录查看、更改与迁移」；
  - docs/03 §1.4 数据位置改为「默认 OS 标准用户数据目录，用户可在设置中更改数据根并迁移（指针文件记录，迁移原子、失败不落地）」；§2.2-4 实时预览链路改述为所见即所得链路（编辑发生在渲染面，写侧去抖落库语义不变）；§4.1 FR-SHELL-01 改为 VS Code 式布局、FR-SHELL-02 菜单改为「应用内菜单 + 保留原生加速器」；§4.4 删除 FR-RENDER-06 滚动同步（编辑面与渲染面合一，无同步对象）、新增 FR-RENDER-08 所见即所得编辑画布；§4.5 FR-EDIT-01 限定非 HTML 文本、新增 FR-EDIT-05 所见即所得编辑；§4.8 FR-AUX-03 增数据目录更改与迁移；§6.2 M6 里程碑行更新为产品化重构验收；§7.1 补 `storage:get-info` / `storage:change-data-dir` 通道；§7.3 补 `E_STORAGE_*` 错误码。

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

## 2026-09-19

- **M4 编辑器与保存管线里程碑定稿（SDD 执行 Task 1-10 完毕，Task 11 收尾）**：spec `docs/superpowers/specs/2026-09-18-编辑器与保存管线-design.md` 与实施计划 `docs/superpowers/plans/2026-09-18-M4-编辑器.md` 定稿并全部落地。要点：
  - **CodeMirror 6 换芯（FR-EDIT-01/03）**：8 包精确版本锁定（state 6.7.5 / view 6.43.12 / commands 6.11.1 / language 6.12.4 / search 6.7.2 / lang-html 6.4.12 / lang-css 6.3.1 / lang-javascript 6.2.5，实查零漂移）；curated 扩展工厂（行号/撤销/自绘选区/自动缩进/括号匹配/查找替换 + contentAttributes 可访问标签「编辑区」，换芯丢失项已随 8036250 恢复）；MIME→语言映射 html/css/js 开箱高亮；EditorState 不可变、per-tab 会话式换芯（state + scrollTop 随签切换换入换出，同 id 重渲染不回灌陈旧态）；
  - **单写管线双计时器语义（FR-EDIT-02）**：`reduceSave` 纯状态机——尾沿去抖（debounceMs）+ 最长挂起强制落库（autoSaveMs = 最长相邻写间隔，连续输入不致无限延迟落库）；写串行（在途期间记挂起、完成后续写）、失败按 autoSaveMs 重试不自旋、flush 三态（脏→立即写 / 在途→转挂起 / 净→no-op）、关标签 flush；
  - **settings schemaVersion 1→2 additive 迁移**：新增 `editor.autoSaveMs`（默认 3000）与 `shell.layout`（三栏折叠三态 + 树/预览宽度比例）；装载链 v2 直读 → v1 静默迁移（preview 保留用户值、新域补出厂默认）原子回写 → 损坏/不识别版本 warn 回退默认值，不阻断启动；`preview.debounceMs` 语义不变；
  - **原生菜单与命令单通道（FR-SHELL-02）**：`createMenuTemplate`（新建文件 Ctrl+N / 新建目录 Ctrl+Shift+N / 保存 Ctrl+S；「快速打开」「全局搜索」「导入/导出」disabled 占位待 M5 启用）经既有 `shell:command` 单通道转发渲染层，快捷键由 accelerator 承载；
  - **编辑区 unsaved-guard 选型（spec D3）**：主进程 close 事件拦截（放行标记 + 重入直通）+ 渲染层 `window.confirm` 确认链（「有未保存的更改，确定退出？」）——弃 `beforeunload`：其原生弹窗不可被 Playwright 驱动，confirm 走 `page.on('dialog')` E2E 可驱动；
  - **三栏折叠与宽度记忆（FR-SHELL-01）**：指针比例纯函数 + settings `shell.layout` 持久化（折叠切换即时持久化、拖拽 pointerup 一次性持久化防写风暴），重启恢复折叠态与分隔比例；
  - **树 rename/move UI 与 meta 同步**：重命名模态 + 移动选择模式（目录点选高亮选定、自身/后代非法拦截、Esc 取消）；rename/move 成功广播后 `vfs:get` 反查同步标签 meta（TabBar 名/预览路径联动）；目录作为 rename/move 源的选中语义扩展与 move 引导文案登记 M5（见 `TASK.md`）；
  - **协议 charset**：`text/*` 响应 Content-Type 附加 `; charset=utf-8`（二进制原样；BLOB/ETag/304/Range 语义不变）；
  - **CSS 热替换（FR-RENDER-07）与 DevTools（FR-RENDER-05）**：热替换全链——PreviewPanel written(css)→fetch 新文本→postMessage `lt:css-swap`，协议层对 text/html 200 全量响应只读注入接收器（不改 BLOB/不参与 ETag；CJK 路径经 decodeURIComponent 命中——WHATWG URL pathname 恒百分号编码，逐字匹配对中文库永不命中，探针实证后修复）；DevTools 右键「检查元素」（`webContents.inspectElement`，原生 popup 不可被 Playwright 驱动、验收降级单测留证）；
  - **验收与实测**：E2E 18/18 全绿（app 2 + editor 9 + preview 7）；NFR/FR-EDIT-01「文件 ≤ 5MB 打开 < 1s」E2E 计时中位 ≈170ms（6 样本 123–177ms，远优于目标）；滚动同步（FR-RENDER-06）为预览 P1 唯一余项，归 M5；
  - `TASK.md` 登记台收尾：删「预览外壳批次」「预览打磨批次」两行（M4 完成）；预览 P1 三项收敛为「滚动同步（FR-RENDER-06）归 M5」一行；追加「搜索 UI 批次」归 M5；M2 deferred 四条核对（M4 未触碰 search 契约/搜索服务/片段渲染，保留登记）；新增「树目录 rename/move 选中语义扩展」「move 模式状态条引导文案」「settingsService `set` 日志域摘要化」三项；待回填登记 FR-EDIT-01 实测值（见上条）。
- **宪法修订（M5 spec v0.3 前端技术栈裁决固化，用户 2026-09-19 指令）**：
  - **新增 A.8「前端 UI 设计约束」**：技术栈红线（shadcn/ui + Tailwind CSS v4 + motion，按需导入，主 chunk 800KB 警戒）、设计步骤强制（基座先行 → 多方向论证择一 → 功能批次按基座产出 → 深度打磨收尾）、设计工具链强制（设计阶段 ui-ux-pro-max、打磨阶段 taste-skill，派遣实施者须显式下达加载指令）、性能红线（合成器路径/禁 layout thrashing/prefers-reduced-motion）、回归红线（aria/语义锚点不可破坏；主题走 shadcn 语义变量 + `.dark`）；
  - **C.2 技术栈表增行**：「样式与组件体系 = Tailwind CSS v4 + shadcn/ui（4.3.x / CLI 4.21.x，2026-09-19 实查）」「动画 = motion（13.4.x）」「编辑器主题 = @codemirror/theme-one-dark」，并补登 M4 遗漏的 CodeMirror 各包行（八包精确版本见 package.json 锁定）；
  - 裁决依据：M5 spec `docs/superpowers/specs/2026-09-19-导入导出与辅助功能-design.md` v0.3（D26–D28）；
  - 联动：M5 实施计划 Task 1 的修宪步骤（CHANGELOG/C.2）由本条目完成，Task 1 收敛为依赖安装与装配。

## 2026-09-20

- **宪法修订（用户亲自修订，本条为事后补记）**：撤销 2026-09-19 新增的 A.8「前端 UI 设计约束」条目式节；前端 UI 设计思想改以新增 **C.7「UI 设计思想 · 谋建琢三段律」**承载——谋（ui-ux-pro-max 定全局蓝图，未定蓝图不得动工）→ 建（依图营造，忠实实现不擅自降级，粗成品严禁交付）→ 琢（taste-skill 深度打磨，四维验收：高级视觉/高级交互/流畅动画/高性能渲染）；协作纪律：凡派遣 subagent 必须在指令中明确要求加载 `@ui-ux-pro-max` 与 `@taste-skill` 方可开工。技术红线细节（按需导入/800KB 警戒/合成器路径/E2E 锚点）由 M5 spec 裁决 D24/D26–D28 与实施计划 Global Constraints 承载。联动：M5 实施计划与交接文档中的 A.8 引用同步更新为 C.7。

## 2026-09-21

- **设计系统基线增量（M5 批次⑧ Task 15 taste 打磨，先记后改）**：`docs/design/设计系统.md` 新增「§九 打磨增量」承载审计增量，核心为 `--destructive` 双主题各调一档——审计实证破坏色文本真正最坏表面是悬停 accent 面（light `#DC2626`/`#E2E8F0` = 3.92:1、dark `#EF4444`/`#1E293B` = 3.89:1，均不达正文门槛 4.5:1，原 §3.1 只验 background 面属基线验算缺口），修正为 light `#B91C1C`（accent 面 5.25:1）/ dark `#F87171`（accent 面 5.29:1），§3.1 对比度表全组合重算并增列 #18/#19 悬停面行。随批交付：`theme.css` base 层 `button:focus-visible` 2px 焦点环基线、shadcn 浮层消费侧覆写惯例（`AlertDialogContent` p-4 / `AlertDialogTitle` text-base 对齐标尺）、数据数字 `tabular-nums`、面板级组合空态与树行「⋯」hover/focus/open 三态显形等呈现层打磨（全站行为与 aria 锚点零变更，既有测试全绿零改动）；geometry 过渡等 D24 红线不做项留证见 §九-8。打磨对照表已归档：`docs/progress/2026-09-21-M5-打磨对照表.md`。
- **M5 导入导出与辅助功能里程碑定稿（SDD 执行 Task 1-17 完毕，Task 17 收尾）**：spec `docs/superpowers/specs/2026-09-19-导入导出与辅助功能-design.md` 与实施计划 `docs/superpowers/plans/2026-09-19-M5-导入导出与辅助功能.md` 定稿并全部落地。要点：
  - **技术栈裁决落地（D26–D28，C.2/C.7）**：shadcn/ui（CLI add 组件源码）+ Tailwind CSS v4（`@tailwindcss/vite`，CSS-first）装配进渲染层；motion 13.4.x 虽经 C.2 修宪登记，实装裁决为零运行时引入——微交互走 CSS 过渡 + tw-animate-css；打磨阶段 taste-skill 逐面升级（对照表与增量见 2026-09-21 上一条）；A.8 撤销改以 C.7 三段律承载（2026-09-20 已记）；
  - **搜索 UI（批次①）**：全局搜索面板入树栏 search 态（类型过滤/片段区间高亮/分页加载更多/在树中显示/过期响应丢弃）+ 快速打开浮层合流（最近打开 + 搜索结果双组，cmdk）；MatchIn 等检索契约缺陷随批次顺手清（spec §2.3 deferred）；
  - **回收站 / 最近打开 / 工作区恢复（批次②与③数据源）**：回收站面板（列表含原路径与删除时刻/还原/撞名 toast/彻底删除 confirm）、最近打开上限 20 条、工作区标签集与激活标签持久化、启动恢复开关（86e547e 补设置页 UI 控件）；
  - **设置页与 settings v3（批次③）**：schemaVersion 3 additive 四域 appearance/backup/recent/workspace，v1→v2→v3 链式迁移只补默认不改旧值；主题三态（亮/暗/跟随系统，`.dark` 类）+ 编辑器字号滑块联动 one-dark 与 CM 主题解析器重建（D10）；
  - **备份本体（批次④，Task 9）**：每日滚动备份 + 设置页维护区（自动备份开关/手动建份/列表/还原——强确认「覆盖当前全部数据并重启应用」+ relaunch 生效）；搜索索引重建修复例程按 Task 9 裁决 disabled 占位留证（见 `TASK.md` 保留行）；
  - **树行内操作（Task 10）**：树行「⋯」菜单 + 目录 rename/move 选中语义扩展 + move 模式状态条引导文案 + settingsService `set` 日志域摘要化；
  - **滚动同步（批次⑤，FR-RENDER-06）**：比例+锚点协议双向跟随、150ms 回环抑制（D13）、开关关闭不跟随（D14）；随 Task 16 E2E 实测修复 CM6 无高度约束缺陷（e10076a——`.cm-scroller` 与内容同高致滚动链路死路，补 `heightConstraintTheme`）；
  - **导入导出（批次⑥⑦，Task 12/13）**：导入磁盘遍历分批事务写入/重名三策略（跳过/重命名/覆盖）/进度广播与取消（D15–D17）；导出子树写盘/`vfs://` 引用改写相对路径与越界占位（D18）/目录选择登记簿校验与 openPath（D19）；缺陷修复两笔——导入后目标父目录子级直调回写补根（dd6a77c）、导出子树行序结构深度稳定排序（d35718f，move 过子树整批失败根因）；
  - **图片音频只读预览（批次⑧，Task 14）**：openFile 媒体分流、预览双源状态机（媒体点选不清激活标签）、树弱选中；主文档 CSP 增补 `img-src/media-src 'self' vfs:`（e10076a，E2E 探针实证 CSP 回落拦截 `<img>` 载入）；
  - **验收与实测（Task 16，`[perf-m5]` 计时）**：E2E 27/27 全绿（既有 18 + M5 9 用例：主链路/快速打开/回收站/设置/备份/滚动同步/导入取消/图片预览/恢复开关）；主链路导入 ~250ms；600×40KB 健康路径导入 ~0.9s；滚动同步 200 段落长文档比例 ±5% 双向（225–558ms）；图片真实解码 ~80ms；导入取消稳定生效（写入 400/601）；FR-EDIT-01 既有实测（≈170ms）不变；
  - **D28 主 chunk 裁剪（Task 17 出口，硬性 ≤ 800KB）**：渲染层主 chunk 1,033,486B → **78,541B**——① 共享域纯常量拆分 zod-free 模块（`src/shared/vfs/search/settings-constants.ts`：渲染层仅消费常量时零 zod 运行时，契约校验仍归主进程 handler，A.7；JS 总量 1,033,486B → 944,957B，全 chunk 指纹核验零 zod 残留）；② vite `codeSplitting` 三 vendor 分包（codemirror 492,838B / react 218,844B / 其余三方 154,145B）——分包不减总量，是满足「主 chunk ≤ 800KB（原始体积）」口径的手段；cn 双轨不做（clsx/tailwind-merge 仅测试消费不入包）。全量单测（466）/集成（132）/E2E（27）回归零变化；
  - `TASK.md` 登记台收尾：删「滚动同步（FR-RENDER-06）」行（批次⑤交付）；主 chunk 体积行闭环销账（终值 78,541B 与手段留档）；macOS guard 降级（darwin 跳过留证）、搜索索引重建（disabled 占位）、persistLayout 入队、mime `.ogg`、release 工作流等未到期项保留。
