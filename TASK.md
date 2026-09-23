# TASK.md — 登记台

> 用途：登记待调研项 / 待决策 / 待回填 / TODO 工单；条目完成或回填后删除。
> 规则：宪法正文修订**先记 `CHANGELOG.md` 再改正文**；一次性例外事项在此登记并限定范围，禁止直接绕过宪法。

## 待回填（M0 脚手架落地时核对）

| 事项 | 涉及段落 | 原因 | 状态 |
| --- | --- | --- | --- |
| package.json / package-lock.json 锁定精确版本（M0-Task 2 触发 TS 版线修正 7.0.x→6.0.3） | AGENTS.md C.2 | 版本已锁定；版线修正已记 CHANGELOG（2026-09-15）并回填 C.2 正文 | 完成（M0） |
| FR-EDIT-01「文件 ≤ 5MB 打开 < 1s」实测回填：树点选 → 编辑器可见 E2E 计时中位 ≈170ms（6 样本 123–177ms，2026-09-19 dev 实测，Task 10 报告） | docs/03 §4.5 FR-EDIT-01 | 实测远优于目标值；数值已记 CHANGELOG（2026-09-19） | 完成（M4） |

## 待决策

| 事项 | 背景 | 状态 |
| --- | --- | --- |
| TypeScript 升级回 7.x（C.2 基线 7.0.x，当前锁 6.0.3） | M0-Task 2 锁版预检：typescript-eslint 8.70.0 的 typescript peer 范围 `>=4.8.4 <6.1.0` 不含 7.x，暂取范围内最高版 6.0.3（已记 CHANGELOG 2026-09-15）；待 typescript-eslint 声明 7.x 支持后评估升级 | 待定 |
| macOS 签名 / 公证证书 | 无证书期发未签名包；证书就绪后填 secrets 并开启 `forceCodeSigning` 硬门禁（跟踪见「执行项登记」release 行） | 待定 |
| better-sqlite3 13.x（N-API）可否免 electron-rebuild | 调研 P-2：官方未给 Electron 场景操作指引，保守保留 rebuild 兜底 | 待定 |
| 开源许可证（README 暂标注待定：MIT） | 影响打包与发布 | 待定 |
| electron-builder 以 `postinstall: electron-builder install-app-deps` 替代直调 @electron/rebuild | 打包日志建议项（依赖编排更贴近 electron-builder 语义） | 待定 |
| Vite/Vitest configLoader 'native' 迁移警告（config 文件含 ESM 语法但以 CJS 加载，native 计划成为默认） | 根治需切 `"type":"module"`（CJS/ESM 跨任务决策，影响构建产物形态），随 M1 构建编排重构一并评估 | 已裁决（2026-09-16）：M1 暂不切 "type":"module"——收益仅消除构建警告，代价是主进程 CJS 产物加载链与 preload 捆绑输出的连锁重构；待 Vite 将 native loader 设为默认（大版本升级预警）时随迁移条目再评估 |

## 待调研项（源自 docs/agmds-research/ 四份报告，注明触发时机）

| 事项 | 来源报告 | 触发时机 |
| --- | --- | --- |
| tsconfig 次级开关取值（exactOptionalPropertyTypes / verbatimModuleSyntax / isolatedModules） | 2026-09-14-语言框架与UI栈.md §三 | M0 编写 tsconfig 前 |
| TypeScript 7 与 5.x/6.x 行为差异 | 同上 §三 | M0 版本锁定前 |
| Electron fuses 全量清单与 @electron/fuses 用法 | 同上 §三（B-0-19） | 完成（2026-09-23）：清单与逐条裁决见 `docs/agmds-research/2026-09-23-electron-fuses清单.md`，afterPack 已接线（`scripts/flip-fuses.mjs`）；asar 完整性双 fuse（#4/#5）本期缓启，随 docs/09 spec 证书就绪后启用 |
| Electron 用户设置社区方案（如 electron-store） | 同上 §三（A.2） | 若内置 userData JSON 方案不足 |
| wal_checkpoint TRUNCATE 模式原文；trigram 引入精确版本号（3.34.0）核对 | 2026-09-14-存储层.md §三（P-3/P-4） | 引用对应语义时核对原文 |
| Playwright Linux E2E 是否需 install-deps；screenshot/video 配置默认值 | 2026-09-14-构建测试与打包.md §三 | CI 首次三平台跑通 / E2E 规范编写前 |
| Vite `build.assetsDir` / `emptyOutDir` 默认值；Vitest 默认 exclude 清单 | 同上 §三 | M0 构建配置编写前 |
| 辅助 action 最新大版本核对（actions/checkout、upload-artifact 等） | 2026-09-14-CI链与生产落地.md §三 | M0 编写 ci.yml 前 |
| Playwright retries 推荐定值 | 2026-09-14-CI链与生产落地.md §三 | M0 CI 调参时 |
| 三平台 `-latest` runner 镜像版本映射核对 | 2026-09-14-CI链与生产落地.md §三 | M0 及 GitHub 大版本升级时 |
| Electron 沙箱专题页 / MessagePorts 专题页全文 | 2026-09-14-语言框架与UI栈.md §三 | 需要 API 级细化条款时 |
| husky v8→v9 迁移差异页（官方 404，报告已按 v9 现行文档固化） | 2026-09-14-构建测试与打包.md §三 | 已裁决，随报告处理，无需行动 |
| 存储层 P-5：compilation.md 与 Release 捆绑 SQLite 版本不一致 | 2026-09-14-存储层.md §三 | 已裁决（按 Release notes 记 3.53.4），无需行动 |

## 待撰写 spec（对应里程碑开工前定稿评审；只补 docs/03 未覆盖的细节，冲突先改 docs/03）

> 位置约定（用户 2026-09-16 指定）：spec（设计文档）落 `docs/superpowers/specs/YYYY-MM-DD-<主题>-design.md`（superpowers 体系约定目录）；实施计划落 `docs/superpowers/plans/`。表中编号为路线图序号，不再作为文件名前缀。

| 编号 | spec | 决策范围（docs/03 缺口） | 定稿时机 | 状态 |
| --- | --- | --- | --- | --- |
| docs/07 | 编辑器与保存管线设计 | 多标签页状态模型、自动保存去抖与写合并（竞态规则）、大文件阈值行为 | M4 开工前 | 待撰写 |
| docs/08 | 导入导出与辅助功能设计 | 导入冲突判定键与三策略（跳过/重命名/覆盖）语义、vfs:// → 相对路径改写算法、设置 schema、备份命名与恢复流程 | M5 开工前 | 待撰写 |
| docs/09 | 打包与发布规格 | electron-builder 配置基线、@electron/fuses 关闭清单（待调研项）、release 工作流与签名占位、版本号策略 | M6 发布批次开工前（先完成 fuses 待调研项） | 部分覆盖（2026-09-22）：NSIS 安装位置可选与 author 字段已由 `docs/superpowers/specs/2026-09-22-产品化UI重构-design.md` §5.3 落地；fuses 调研与 afterPack 落地已完成（2026-09-23，`docs/agmds-research/2026-09-23-electron-fuses清单.md`，asar 完整性双 fuse 缓启待本 spec）、release 工作流已建（`.github/workflows/release.yml`）；asar 完整性启用与版本策略仍待本 spec；**应用内更新规格已独立成文**（2026-09-23，`docs/superpowers/specs/2026-09-23-应用内更新-design.md`：能力矩阵/八态状态机/IPC 契约/安全隐私/不做清单；macOS 自更新随签名证书启用） |

不需要单独 spec 的：M0 脚手架（宪法 C.4/C.6 + TASK.md 执行项已是完整依据）；IPC 字段级契约（在 `src/shared` 以 TS + zod 为单一来源，docs/03 §7 已定通道语义，代码即规格）；安全基线（宪法 B.5 禁令已完备）。

## 执行项登记（实现类工作不入宪法，在此跟踪）

| 事项 | 依据 | 触发时机 | 状态 |
| --- | --- | --- | --- |
| 落地 `.github/workflows/ci.yml`（触发面 [main, dev]）：三平台矩阵（fail-fast: false + 每作业 timeout）、六阶段流水线（npm ci → 静态质量 → Vitest+覆盖率 → electron-rebuild → E2E → --dir 打包冒烟）、concurrency 取消旧跑 / permissions 只读 / 禁 paths 过滤、缓存（npm + Electron 二进制 zip + electron-builder；Playwright 浏览器不缓存）、产物仅短期 artifact 不发布。**实施计划：docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md（SDD 执行）** | docs/agmds-research/2026-09-14-CI链与生产落地.md §三方案 A | M0 | 完成（M0） |
| 配置分支保护（**dev=日常开发主干；main=生产分支，项目完整落地后一次性合入并触发完整 CI/CD 打包发布**）：dev 与 main 必需检查 = 三平台检查名 + 要求分支同步，无人工绕过通道 | 同上；分支模型经用户 2026-09-15 指定 | M0 首个 PR 前 | 完成（M0） |
| 【M1 前置】补齐 B.5-4/5 窗口安全基线缺口：`will-navigate` origin 白名单拦截（URL 解析器比较）、`setWindowOpenHandler` 一律 deny、`setPermissionRequestHandler` 默认拒绝 | 宪法 B.5-4/5 强制条款，M0 未落地 | M1 窗口 / 预览工作时优先补齐 | 完成（M1） |
| 【M1 前置】preload 从 tsconfig.main 拆出独立构建：现 dev watch 与单独 `npm run build:main` 会用 tsc 多文件产物覆盖 rolldown 单文件 preload（sandbox 下坏产物、dev 形态 IPC 断），重构构建编排——dev 主开发循环即受影响，M1 开工首日即撞上 | M0-Task 8/11 实测遗留 | M1 前置（M1 开工首日） | 完成（M1） |
| release 发布工作流：tag 触发、draft release 人工发布闸门、签名 / 公证 secrets 占位、`forceCodeSigning` 证书就绪后开启为硬门禁 | 同上 §三方案 C | M6 | 主体完成（2026-09-23：`.github/workflows/release.yml` 三平台 matrix + draft 闸门 + tag/版本一致性守卫；forceCodeSigning 与签名 secrets 随证书就绪启用）；**v0.1.1 已公开发布**（2026-09-23，8 项产物，run 35822947798；v0.1.0 未公开 draft 保留待清理） |
| 搜索索引重建修复例程（设置页：v1 对账不平或用户自修复触发——同 v2 复制范式重跑） | docs/superpowers/specs/2026-09-17-搜索-design.md §7.1 | 后续批次 | 待办（M6 已按用户需求「未实现功能不设计」移除设置页 disabled 占位按钮；接线项保留） |
| electron-builder v27 `electronGet` 更名复核 | 同上 §三（C.6-11） | v27 发布后 |
| A.5-4 交互/批量预算分档与基句悬空指针清理（终审建议：交互单点写与批量导入分档、删「见 TASK.md」悬空引用） | M2 终审 | 下一修宪周期 | 待办 |
| searchService `filterFragments` 类型白名单形态仅覆盖 ≤2 值（0/1/2 三分支，≥3 静默失真）——nodeTypes 枚举扩展时须同步参数化改造 | M2 终审 deferred（Task 7 评审） | M4 契约/枚举变更时 | 待办（M4 核对：未触碰对应文件，保留） |
| 渲染层主 chunk 体积裁剪（D28 硬性出口 ≤ 800KB）：已闭环——**1,033,486B（Task 17 基线实建）→ 主 chunk 78,541B**。手段：① 共享域纯常量拆分 zod-free 模块（`vfs/search/settings-constants.ts`，渲染层零 zod 运行时、总量 1,033,486B→944,957B，全 chunk 指纹核验零残留）；② vite `codeSplitting` 三 vendor 分包（codemirror 492,838B / react 218,844B / 其余三方 154,145B），主 chunk 即业务+shadcn 组件；③ cn 双轨不做（不影响 chunk：clsx/tailwind-merge 仅测试消费不入包）。全量单测/集成/E2E 回归零变化 | M5 D28 按需导入红线；Task 1/6/15 评审登记 | M5 Task 17 出口验收前（硬性主 chunk ≤ 800KB） | 完成（M5 Task 17） |
| persistLayout 裸写入队：Workspace.tsx 布局写（裸 get→set）与 M5 Task 5 新增的 recent/workspace 串行写队列并存，存在全文档 set 互踩丢写窗口——把 persistLayout 一并入队（一行改动）消掉最后一处全文档裸写 | M5 Task 5 评审 Minor | 下次触碰 Workspace settings 写链时顺手清 | 待办 |
| mime 表扩展：src/main/vfs/mime.ts（M1 域）无 `.ogg`→`audio/ogg` 映射，M5 Task 14 的 audio 预览分支对 .ogg 文件不可达（落 octet-stream 拒开 toast）——补一行映射 | M5 Task 14 评审发现（跨里程碑缝隙） | 下次触碰 mime.ts 时顺手清 | 待办 |
| 树多层后代缓存元数据不随单条 renamed/moved 广播刷新：getNode 续体只反查事件节点自身、markStaleAround 只标树内直父一层——moved 目录的多层后代 virtualPath 缓存及已开后代标签 meta 靠逐层展开/后续广播收敛（与改前行为一致，无回归） | M7 反馈②④⑤批次审查 P3（2026-09-23） | 后续树同步打磨批次 | 待办 |
| toast 宿主与壳层底边叠压：宿主 `fixed bottom-4`（距视口底 16px）落在状态栏（24px 高）内部 8px，遮盖状态栏主题/设置钮上沿约 6px 命中区；单条 toast 与画布浮动「从库重新加载」钮（`absolute right-4 bottom-4`）重叠约 10px；`z-50` + `pointer-events-auto` 使被覆盖处点击被 toast 吞掉 | M8 批次审查 P2（2026-09-23；存量缺陷，非本批引入） | 下次触碰 toast 宿主定位时（须与进度面板 `bottom-14` 协同上移，属呈现面位移改动） | 待办 |
| 还原失败后半开状态改 relaunch：备份还原 rename 极端失败后重开的 db 与 vfs/search 旧连接脱节，此后库操作报错至重启——建议 relaunch+exit 替代重开连接（重开无人使用的连接不如干净重启） | M5 终审（2026-09-21） | 后续批次打磨 | 待办（M6 数据目录迁移已按同向 D9 语义落地：关库后失败=清理+重启走旧指针） |
| 主进程 `will-frame-navigate` 导航闸门接线（交互态站内导航已由注入桥最低形态承接：链接/表单取消就地导航 + 站内链接交父窗开新标签；脚本式 location.assign/window.open 不在覆盖面——蓝图 §八 R3 已知边界） | M9 交互蓝图 A.3 导航闸门 + 设计系统 §十四 | 下一画布批次（触碰 vfsProtocol/webContents 生命周期时） | 待办 |
| macOS 自更新启用：需签名证书（Squirrel.Mac 强制签名）+ mac zip target（dmg 不可自更新）+ latest-mac.yml 产物；证书就绪前 macOS 显式降级 unsupported 说明（已落地） | docs/superpowers/specs/2026-09-23-应用内更新-design.md 能力矩阵；FR-UPDATE-01 | 签名证书就绪时（与 forceCodeSigning/asar fuse 同批） | 待办 |
| 更新链真机打包冒烟：打包版启动 → 检查到新版（需已发布 Release 含 latest.yml）→ 下载 → 重启安装全链路；开发形态仅降级呈现已 E2E 覆盖 | docs/superpowers/specs/2026-09-23-应用内更新-design.md「必须真机验证的项」 | v0.2.0 发布批次（本批发版冒烟时顺验检查面；下载/重启安装待 v0.2.1+ 存量发布后具备可检条件） | 待办 |
| macOS Playwright _electron 进程退出验证不可驱动（guard E2E darwin 跳过）——Electron quit 流程被 guard preventDefault 中断后 forceClose 关窗不在 quit 流程内，mac window-all-closed 不自动退，Playwright 连接与 OS 句柄存在固有窗口；guard 链验收由 Windows/Linux 覆盖，mac 真实验证记录见 M4 Task 10 报告 §十二（第四轮 CI dialog 链全通日志） | M4 Task 10 fix loop 四轮 CI 实证 + SDD breaker 裁决（2026-09-19）；降级先例：spec §9.1-7 检查元素原生 popup 不可驱动 | mac 平台 guard E2E 覆盖需求出现时（或 Playwright _electron 进程退出能力演进时）重评 | 已裁决（darwin 跳过 + 留证） |
