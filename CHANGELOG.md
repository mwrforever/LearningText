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
