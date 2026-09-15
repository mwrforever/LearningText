# 任务交接文档 (Session Handoff)

> ⚠ **交接声明（务必先读）**：本文档由 `session-handoff` 技能生成，是新会话续接任务的**唯一事实来源**，内容仅来自当前会话的设计与实现事实，自包含、不引用其他进度文档或历史会话记录。
> 「第 2 节 未完成」中的全部任务必须在【新会话】执行；生成本文档的会话已交接封存，不再实现任何任务。
> 新会话续接前必须完整读取本文档、以本文档为准，禁止凭空推测进度或重复已完成的工作。

## 元信息 (Meta)
- workspace_dir: D:\code\project\LearningText
- saved_at: 2026-09-15T11:08:43+08:00
- 生成方式: update（更新本会话此前生成的交接文档）
- 版本控制提交号: dev 分支 67d1585（M0 实施计划定稿提交，已推送 origin）
- 交接状态: 已交接（本会话封存，未完成部分须在新会话执行）
- 任务一句话描述: LearningText 立项阶段收尾——设计与宪法定稿、M0 实施计划（SDD 模式）已定稿于 dev 分支，**新会话直接按计划开工 M0**

## 1. 已完成 (Completed) — 只列结论，让新会话知道哪些不用再做
- [x] 三份设计文档定稿并推送：`docs/01-功能模块定义.md`（8 模块 M1~M8）、`docs/02-技术选型.md`（11 决策点）、`docs/03-全局需求规格说明书.md`（需求基线：架构/数据模型/FR/NFR/接口契约/里程碑 M0~M6）——main 分支提交 1f70bfe
- [x] 四份宪法调研报告落盘 `docs/agmds-research/`（CI 链与生产落地 / 语言框架与UI栈 / 存储层 / 构建测试与打包），约 120 条带真实来源 URL 的候选条目，版本号为 2026-09-14 npm registry 实查——main 分支提交 5b2edcd
- [x] 工程宪法体系建成：`AGENTS.md`（整仓单应用实体，248 行）+ `CLAUDE.md`（根索引）+ `TASK.md`（登记台）+ `CHANGELOG.md`；独立审计通过（1 轮修订：CRLF 阻断项经字节级三重复核实为误报驳回；B.3-4 事件广播条款登记为项目裁决；4 项建议全采纳）；三条用户修订令落实（C.4 命令代码块化、B.1/C.3 合并、C.5 精简执行项不入宪法）——main 分支提交 5b2edcd / ac3ad25
- [x] CI 门禁方案选定：**方案 A「三平台全量严格矩阵」**（用户 2026-09-14 选定）；宪法 C.5 只留精简描述，细则为执行项
- [x] spec 路线图登记：`TASK.md`「待撰写 spec」表（docs/04~09 共 6 份，对应里程碑开工前 just-in-time 定稿）——main 分支提交 269fa9f
- [x] **dev 分支已创建并推送**（用户 2026-09-15 指定分支模型：**dev=日常开发主干；main=生产分支，项目完整落地后一次性合入并触发完整 CI/CD 打包发布**），当前工作分支为 dev
- [x] **M0 实施计划定稿并标记 SDD 执行**：`docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md`（15 个任务、TDD 步骤粒度、含完整代码块与验证命令、无占位符；writing-plans 自查三项通过）——dev 分支提交 67d1585
- [x] TASK.md「执行项登记」已更新：ci.yml 行（触发面 [main, dev]）与分支保护行（dev+main）均标注实施计划指针与「待 SDD 执行」状态

## 2. 进行中 / 未完成 (Pending) — 重点详述（全部须在新会话执行）
> 每个未完成任务按 2.1 的子结构编号填写，越具体续接越稳。

### 2.1 执行 M0 实施计划（SDD 模式，用户已标记可直接开工）
- 目标: 按 `docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md` 完成 15 个任务，M0 验收清单全绿（lint / format:check / typecheck / test:coverage / build / test:e2e / package:dir 全部通过 + GitHub Actions dev 分支三平台绿 + dev/main 分支保护生效）
- 当前状态: 计划已定稿（dev 分支 67d1585），**实现代码为零**，仓库尚无 package.json
- 涉及文件/产物: 计划文档已列全每任务的 Create/Modify 清单（package.json、tsconfig×4、eslint.config.mjs、vite.config.ts、src/{main,preload,shared,renderer} 最小集、tests×4 类、.github/workflows/ci.yml、electron-builder.yml、.husky/pre-commit）
- 已锁定决策（新会话不得推翻）:
  - 宪法 `AGENTS.md` 全部条款（A.1~A.7 / B.1~B.5 / C.2 / C.4 / C.6）；目录以 B.1 注释式树为准；产物 dist/ 与 release/
  - CI 方案 A 六阶段三平台矩阵，触发面 [main, dev]；检查名 `build (ubuntu-latest)` 等（计划 Task 14）
  - 计划内的两个待核对项必须按计划给定的决策规则执行，不得跳过：Task 2 Step 1（TS 7 与 typescript-eslint 兼容性，冲突时降版并按修宪流程记 CHANGELOG）、Task 14 Step 1（辅助 action 最新大版本核对）
  - 覆盖率阈值（核心 100%/全局 80%）禁止下调；`src/main/app.ts` 装配体不可测时的处理方案已写在计划 Task 10 Step 2
- 阻塞点/风险:
  - Task 7（app.ts 装配）与 Task 8（ipc.ts）存在编译闭合依赖，计划已注明由同一子代理连续执行或合并派发
  - electron 二进制下载慢时用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（宪法 C.6-3）
  - 每次 `npm install` 后必须 `npm run rebuild`；分支保护 API 若 token 权限不足，按计划 Task 15 Step 1 的指引交用户网页配置，禁止降级绕过
- **下一步具体动作**: 在新会话（工作目录 D:\code\project\LearningText，分支 dev）加载 superpowers:subagent-driven-development 技能，读取 `docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md`，从 Task 1 开始逐任务派发子代理执行（每任务完成后两阶段评审，全绿才进入下一任务）
- 验证方式: 计划 Task 15 Step 6 的 M0 验收清单命令全部 0 退出；`gh run watch` 三平台作业全绿；`gh api .../branches/dev/protection` 返回三个必需检查

### 2.2 docs/04 存储与 VFS 详细设计（M1 开工前置，可在 M0 完成后启动）
- 目标: 定稿 `docs/04-存储与VFS详细设计.md` 并评审入库
- 当前状态: 决策范围已登记 `TASK.md`「待撰写 spec」表首行，未动笔
- 涉及文件/产物: `docs/04-存储与VFS详细设计.md` [待创建]；`TASK.md` 对应行回填后删除 [修改]
- 已锁定决策: 名称校验基础规则在 `docs/03` §3.2；单文件 50MB 上限；FTS5 普通表应用层同事务维护；spec 只补细节（Unicode 规范化、SQLite 错误码→`E_VFS_*` 映射表、迁移脚本组织形态、事务封装模板、回收站保留策略），与 docs/03 冲突时先改 docs/03
- 阻塞点/风险: 无硬阻塞；撰写时可顺带完成 zod v4 习语待调研项
- **下一步具体动作**: M0 完成后，按 `TASK.md`「待撰写 spec」表 docs/04 行的决策范围撰写全文；定稿后删除 TASK.md 该行并提交推送（在 dev 分支）
- 验证方式: 与 `docs/03` §3/§4.1、宪法 A.4 全部条款无冲突、无遗漏着落；经用户评审确认

## 3. 环境与依赖状态 (Environment)
- 运行时/工具版本: Windows 11（win32 10.0.26200）+ Git Bash；Node 本机 24.19.0（`.nvmrc` 将由计划 Task 1 创建）；gh CLI 已登录 `mwrforever`（active 账号，token 含 repo/workflow 权限，分支保护 API 需仓库管理员权限——本人即所有者）；git 本地 `core.autocrlf=false`
- 关键配置: 远程仓库 `https://github.com/mwrforever/LearningText.git`（public；`main` 与 `dev` 分支均已存在并跟踪 origin）；行尾由 `.gitattributes`（`* text=auto eol=lf`）+ `.editorconfig` 强制 UTF-8 无 BOM/LF；全局规范 `~/.zcode/AGENTS.md`（注释/日志/测试/行为准则）强制生效
- 安装/构建/启动命令: M0 执行期命令全部在计划文档各任务 Step 内给出；完成后以宪法 C.4 代码块为准（dev 用 `npm run dev` + `npm run start:dev`）

## 4. 全局约定 (Locked Conventions)
> 跨会话必须遵循、不可随意更改的约定，防止新会话重新发明或破坏已有结构。
- **分支模型（用户 2026-09-15 指定）**：一切开发在 `dev` 分支进行；`main` 是生产分支，项目完整落地后才一次性合入，届时触发完整 CI/CD 打包发布流程（release 工作流为 M6 执行项）
- 写本仓库任何代码前必读 `AGENTS.md`（宪法）；修订宪法**先记 `CHANGELOG.md` 再改正文**（追加式）；实现类工作一律登记 `TASK.md` 执行项，不入宪法
- `docs/03` 是需求基线：后续 spec（docs/04~09）只补细节，冲突先改 docs/03；里程碑顺序 M0 脚手架 → M1 存储+VFS → M2 搜索 → M3 预览 → M4 编辑器 → M5 导入导出+辅助 → M6 打包发布（docs/03 §6.2）
- 所有产出中文注释/日志/文档、UTF-8 无 BOM、LF 行尾；改 `.gitattributes` / `.editorconfig` 视同修宪
- 会话工作流约定：显式点名的技能必须先加载再执行；关键方案门用 AskUserQuestion 征求用户决策，实现细节自主决策；设计批准（brainstorming）→ 实现计划（writing-plans）→ 执行（subagent-driven-development，本会话已为 M0 指定 SDD）的技能链顺序不跳步
- 项目纪律：测试与实现同提交（核心链路 100% / 非核心 ≥80% 覆盖率，A.6-3）；CI 失败禁止合入、禁止人工绕过
