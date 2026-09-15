# 任务交接文档 (Session Handoff)

> ⚠ **交接声明（务必先读）**：本文档由 `session-handoff` 技能生成，是新会话续接任务的**唯一事实来源**，内容仅来自当前会话的设计与实现事实，自包含、不引用其他进度文档或历史会话记录。
> 「第 2 节 未完成」中的全部任务必须在【新会话】执行；生成本文档的会话已交接封存，不再实现任何任务。
> 新会话续接前必须完整读取本文档、以本文档为准，禁止凭空推测进度或重复已完成的工作。

## 元信息 (Meta)
- workspace_dir: D:\code\project\LearningText
- saved_at: 2026-09-15T10:43:20+08:00
- 生成方式: rewrite（本次新建）
- 版本控制提交号: 269fa9f（main 分支最新提交，已推送 origin）
- 交接状态: 已交接（本会话封存，未完成部分须在新会话执行）
- 任务一句话描述: LearningText 立项阶段收尾——三份设计文档、工程宪法体系（含 CI 门禁方案 A）全部定稿，spec 路线图登记完毕，**下一步可直接开工 M0**

## 1. 已完成 (Completed) — 只列结论，让新会话知道哪些不用再做
- [x] 三份设计文档定稿并推送：`docs/01-功能模块定义.md`（8 模块 M1~M8）、`docs/02-技术选型.md`（11 决策点）、`docs/03-全局需求规格说明书.md`（需求基线：架构/数据模型/FR/NFR/接口契约/里程碑 M0~M6）——提交 1f70bfe
- [x] 四份宪法调研报告落盘 `docs/agmds-research/`（CI 链与生产落地 / 语言框架与UI栈 / 存储层 / 构建测试与打包），约 120 条带真实来源 URL 的候选条目，版本号为 2026-09-14 npm registry 实查——提交 5b2edcd
- [x] 工程宪法体系建成并推送：`AGENTS.md`（整仓单应用实体，248 行）+ `CLAUDE.md`（根索引）+ `TASK.md`（登记台）+ `CHANGELOG.md`——提交 5b2edcd
- [x] CI 门禁方案选定：**方案 A「三平台全量严格矩阵」**（用户 2026-09-14 选定）；细则属执行项，登记在 `TASK.md`「执行项登记」，宪法 C.5 只保留工具/方案/门禁语义精简描述
- [x] 宪法独立审计通过（1 轮修订）：1 项阻断为审计误报（CRLF，经 od/awk/file 字节级三重复核实为纯 LF，驳回）；1 项阻断成立并已按建议修复（B.3-4 事件广播条款登记为项目裁决，依据 docs/03 §2.2）；4 项建议全部采纳
- [x] 宪法三条修订令落实（用户指令）：C.4 命令改代码块+注释；B.1 与 C.3 合并为注释式目录规范（C.3 槽位省略，编号不重排）；C.5 精简、执行项不入宪法——提交 ac3ad25
- [x] spec 路线图登记：`TASK.md`「待撰写 spec」表（docs/04~09 共 6 份，对应里程碑开工前 just-in-time 定稿）——提交 269fa9f
- [x] 用户已确认宪法定稿，并明确标记：**下一步可以直接开工 M0**（本会话已按其指令生成交接文档，M0 未动工）

## 2. 进行中 / 未完成 (Pending) — 重点详述（全部须在新会话执行）
> 每个未完成任务按 2.1 的子结构编号填写，越具体续接越稳。

### 2.1 M0 工程脚手架 + CI 门禁落地（用户已标记可直接开工）
- 目标: 仓库具备可运行的 Electron + TypeScript 工程骨架；GitHub Actions 三平台门禁全绿；main 分支保护必需检查生效、无人工绕过通道
- 当前状态: 设计/宪法/调研全部就绪，**代码为零**（仓库仅文档与规范文件，无 package.json）；用户已确认开工
- 涉及文件/产物: 以下全部 [待创建]——`package.json`、`package-lock.json`、`.nvmrc`（24）、`tsconfig*.json`、`eslint.config.*`（flat config）、`.prettierrc`、`electron-builder.yml`、`playwright.config.ts`、vitest 配置（`test.projects` 拆 unit/integration）、`src/main/`（app.ts + store/vfs/search/io/protocol 空骨架）、`src/preload/`、`src/renderer/`（Vite + React 入口）、`src/shared/`、`tests/unit|integration|e2e/`、`.github/workflows/ci.yml`、`.husky/pre-commit`
- 已锁定决策（新会话不得推翻）:
  - 宪法 `AGENTS.md` 全部条款：编码约束 A.1~A.7、进程分层 B.1~B.5、版本基线 C.2、命令清单 C.4、永久环境 C.6（含 Node 24 LTS 双写、husky v9、ESLint 10 仅 flat config、禁 `eslint-plugin-prettier`、禁 `ELECTRON_SKIP_BINARY_DOWNLOAD`）
  - 目录规范以 `AGENTS.md` B.1 注释式树为唯一权威（含裁决：Vite outDir=`dist/renderer`、electron-builder output=`release/`）
  - CI 方案 A 六阶段（npm ci → 静态质量 → Vitest+覆盖率 → electron-rebuild → E2E → `--dir` 打包冒烟）、三平台矩阵 fail-fast: false、禁 paths 过滤、concurrency 取消旧跑——依据 `docs/agmds-research/2026-09-14-CI链与生产落地.md` §三方案 A
  - M0 落地后须回填核对 `AGENTS.md` C.2 版本锁定与 B.1/C.4 目录命令对齐（TASK.md「待回填」表）
- 阻塞点/风险:
  - 每次 `npm install` 后必须重跑 `npm run rebuild`（electron-rebuild，宪法 A.5-2）；better-sqlite3 13.x N-API 能否免 rebuild 属待调研项，保守保留 rebuild
  - 辅助 action 最新大版本（actions/checkout、upload-artifact）需核对——TASK.md 待调研项；Linux E2E 是否需 `playwright install-deps` 需三平台首跑实测
  - 分支保护配置是对 GitHub 仓库的设置操作（gh api 或网页），须在首个 PR 前完成
  - Windows 本机路径合规（无空格）；Electron 二进制下载慢时用 `ELECTRON_MIRROR`（C.6-3）
- **下一步具体动作**: 先按 superpowers:writing-plans 流程产出 M0 实现计划（落 `docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md`，任务粒度到 TDD 步骤），计划经确认后逐任务执行——起点：`npm init -y` → 按 `AGENTS.md` C.2 版本表安装依赖 → 按 B.1 建四目录骨架 → 依次落 tsconfig / eslint flat config / prettier / vitest / playwright / electron-builder 配置 → 最小可运行窗口（空白页，遵守 B.5 安全基线）→ husky + lint-staged → `ci.yml` + GitHub 分支保护
- 验证方式: `npm run dev` 弹出空白窗口；`npm run lint` / `typecheck` / `test` 全绿；`npm run package:dir` 产出未打包目录；push 后 GitHub Actions 三平台矩阵全绿；分支保护 Required status checks 含三平台检查名且 PR 未过检不可合并

### 2.2 docs/04 存储与 VFS 详细设计（M1 开工前置，可与 M0 收尾并行）
- 目标: 定稿 `docs/04-存储与VFS详细设计.md` 并评审入库
- 当前状态: 决策范围已登记 `TASK.md`「待撰写 spec」表首行，未动笔
- 涉及文件/产物: `docs/04-存储与VFS详细设计.md` [待创建]；`TASK.md` 对应行回填后删除 [修改]
- 已锁定决策: 名称校验基础规则已在 `docs/03` §3.2（禁 `/` `\` 空字节与 `.` `..`、1~255 字符、同目录唯一索引）；单文件 50MB 上限；FTS5 普通表应用层同事务维护；spec 只补细节（Unicode 规范化、SQLite 错误码→`E_VFS_*` 映射表、迁移脚本组织形态、事务封装模板、回收站保留策略），与 docs/03 冲突时先改 docs/03
- 阻塞点/风险: 无硬阻塞；撰写时可顺带完成 zod v4 习语待调研项（TASK.md 待调研表）
- **下一步具体动作**: 在新会话按 `TASK.md`「待撰写 spec」表 docs/04 行的决策范围撰写全文；定稿后删除 TASK.md 该行并提交推送
- 验证方式: docs/04 与 `docs/03` §3/§4.1、宪法 A.4 全部条款无冲突、无遗漏着落；经用户评审确认

## 3. 环境与依赖状态 (Environment)
- 运行时/工具版本: Windows 11（win32 10.0.26200）+ Git Bash；Node 本机 24.19.0（已验证可用，`.nvmrc`/`engines` 尚未落地，M0 创建）；gh CLI 已登录 `mwrforever`（active 账号，token 含 repo/workflow 权限）；git 可用且本地 `core.autocrlf=false`
- 关键配置: 远程仓库 `https://github.com/mwrforever/LearningText.git`（public，默认分支 main，直接 push）；行尾由 `.gitattributes`（`* text=auto eol=lf`）+ `.editorconfig` 强制 UTF-8 无 BOM/LF；全局规范 `~/.zcode/AGENTS.md`（注释/日志/测试/行为准则）强制生效
- 安装/构建/启动命令: M0 前无需（仓库无 package.json）；M0 后全量命令以宪法 C.4 代码块为准

## 4. 全局约定 (Locked Conventions)
> 跨会话必须遵循、不可随意更改的约定，防止新会话重新发明或破坏已有结构。
- 写本仓库任何代码前必读 `AGENTS.md`（宪法）；修订宪法**先记 `CHANGELOG.md` 再改正文**（追加式）；实现类工作一律登记 `TASK.md` 执行项，不入宪法
- `docs/03` 是需求基线：后续 spec（docs/04~09）只补细节，冲突先改 docs/03；里程碑顺序 M0 脚手架 → M1 存储+VFS → M2 搜索 → M3 预览 → M4 编辑器 → M5 导入导出+辅助 → M6 打包发布（docs/03 §6.2）
- 所有产出中文注释/日志/文档、UTF-8 无 BOM、LF 行尾；改 `.gitattributes` / `.editorconfig` 视同修宪
- 会话工作流约定：显式点名的技能必须先加载再执行；关键方案门（如 CI 方案、spec 评审）用 AskUserQuestion 征求用户决策，实现细节自主决策；设计批准（brainstorming）→ 实现计划（writing-plans）→ 执行（executing-plans / subagent-driven）的技能链顺序不跳步
- 本项目纪律：文档同步（需求变更先改 docs/03 再动代码）；测试与实现同提交（核心链路 100% / 非核心 ≥80% 覆盖率，A.6-3）；CI 失败禁止合入、禁止人工绕过
