# TASK.md — 登记台

> 用途：登记待调研项 / 待决策 / 待回填 / TODO 工单；条目完成或回填后删除。
> 规则：宪法正文修订**先记 `CHANGELOG.md` 再改正文**；一次性例外事项在此登记并限定范围，禁止直接绕过宪法。

## 待回填（M0 脚手架落地时核对）

| 事项 | 涉及段落 | 原因 | 状态 |
| --- | --- | --- | --- |
| package.json / package-lock.json 锁定精确版本 | AGENTS.md C.2 | C.2 为 2026-09-14 立项实查基线 | 待办 |
| C.3 已并入 B.1：目录结构（B.1）与命令（C.4）在 M0 后与实际代码对齐核对 | AGENTS.md B.1 / C.4 | 目录与命令为 M0 目标态 | 待办 |
| `.nvmrc` + `engines` 双写落地（Node 24 LTS） | AGENTS.md C.6-1 | M0 落地 | 待办 |
| 同步事务阻塞毫秒预算（压测后回填 A.5-4） | AGENTS.md A.5-4 | 官方无量化数值，须项目实测 | 待办 |

## 待决策

| 事项 | 背景 | 状态 |
| --- | --- | --- |
| macOS 签名 / 公证证书 | 无证书期发未签名包；证书就绪后填 secrets 并开启 `forceCodeSigning` 硬门禁（跟踪见「执行项登记」release 行） | 待定 |
| better-sqlite3 13.x（N-API）可否免 electron-rebuild | 调研 P-2：官方未给 Electron 场景操作指引，保守保留 rebuild 兜底 | 待定 |
| 开源许可证（README 暂标注待定：MIT） | 影响打包与发布 | 待定 |

## 待调研项（源自 docs/agmds-research/ 四份报告，注明触发时机）

| 事项 | 来源报告 | 触发时机 |
| --- | --- | --- |
| tsconfig 次级开关取值（exactOptionalPropertyTypes / verbatimModuleSyntax / isolatedModules） | 2026-09-14-语言框架与UI栈.md §三 | M0 编写 tsconfig 前 |
| TypeScript 7 与 5.x/6.x 行为差异 | 同上 §三 | M0 版本锁定前 |
| zod v4 schema 习语与 API 细节 | 同上 §三（A.7-6） | IPC 契约层实现前 |
| `protocol.handle` API 细则（vfs:// 落地） | 同上 §三（B） | M3 预览管线实现前 |
| Electron fuses 全量清单与 @electron/fuses 用法 | 同上 §三（B-0-19） | M6 打包前 |
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

| 编号 | spec | 决策范围（docs/03 缺口） | 定稿时机 | 状态 |
| --- | --- | --- | --- | --- |
| docs/04 | 存储与 VFS 详细设计 | 名称校验与 Unicode 规范化规则（三平台非法字符并集/保留名）、SQLite 错误码 → E_VFS_* 错误映射表、迁移脚本组织形态、事务封装模板、回收站保留策略 | M1 开工前 | 待撰写 |
| docs/05 | 搜索详细设计 | 查询语法（多关键词/短语）、name 与 body 匹配优先级、结果上限与分页、高亮片段格式 | M2 开工前 | 待撰写 |
| docs/06 | 预览管线详细设计 | protocol.handle 响应语义（Content-Type/ETag/Range）、iframe 沙箱属性与 CSP 具体值、去抖与刷新事件归属、滚动同步协议（P1） | M3 开工前（先完成 protocol.handle 待调研项） | 待撰写 |
| docs/07 | 编辑器与保存管线设计 | 多标签页状态模型、自动保存去抖与写合并（竞态规则）、大文件阈值行为 | M4 开工前 | 待撰写 |
| docs/08 | 导入导出与辅助功能设计 | 导入冲突判定键与三策略（跳过/重命名/覆盖）语义、vfs:// → 相对路径改写算法、设置 schema、备份命名与恢复流程 | M5 开工前 | 待撰写 |
| docs/09 | 打包与发布规格 | electron-builder 配置基线、@electron/fuses 关闭清单（待调研项）、release 工作流与签名占位、版本号策略 | M6 开工前（先完成 fuses 待调研项） | 待撰写 |

不需要单独 spec 的：M0 脚手架（宪法 C.4/C.6 + TASK.md 执行项已是完整依据）；IPC 字段级契约（在 `src/shared` 以 TS + zod 为单一来源，docs/03 §7 已定通道语义，代码即规格）；安全基线（宪法 B.5 禁令已完备）。

## 执行项登记（实现类工作不入宪法，在此跟踪）

| 事项 | 依据 | 触发时机 | 状态 |
| --- | --- | --- | --- |
| 落地 `.github/workflows/ci.yml`：三平台矩阵（fail-fast: false + 每作业 timeout）、六阶段流水线（npm ci → 静态质量 → Vitest+覆盖率 → electron-rebuild → E2E → --dir 打包冒烟）、concurrency 取消旧跑 / permissions 只读 / 禁 paths 过滤、缓存（npm + Electron 二进制 zip + electron-builder；Playwright 浏览器不缓存）、产物仅短期 artifact 不发布 | docs/agmds-research/2026-09-14-CI链与生产落地.md §三方案 A | M0 | 待办 |
| 配置 main 分支保护：必需检查 = 三平台检查名（平台前缀命名保证唯一）+ 要求分支同步，无人工绕过通道 | 同上 | M0 首个 PR 前 | 待办 |
| release 发布工作流：tag 触发、draft release 人工发布闸门、签名 / 公证 secrets 占位、`forceCodeSigning` 证书就绪后开启为硬门禁 | 同上 §三方案 C | M6 | 待办 |
| electron-builder v27 `electronGet` 更名复核 | 同上 §三（C.6-11） | v27 发布后 |
