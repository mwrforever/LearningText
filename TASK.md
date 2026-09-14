# TASK.md — 登记台

> 用途：登记待调研项 / 待决策 / 待回填 / TODO 工单；条目完成或回填后删除。
> 规则：宪法正文修订**先记 `CHANGELOG.md` 再改正文**；一次性例外事项在此登记并限定范围，禁止直接绕过宪法。

## 待回填（M0 脚手架落地时核对）

| 事项 | 涉及段落 | 原因 | 状态 |
| --- | --- | --- | --- |
| package.json / package-lock.json 锁定精确版本 | AGENTS.md C.2 | C.2 为 2026-09-14 立项实查基线 | 待办 |
| C.3 目录、C.4 命令与实际代码对齐核对 | AGENTS.md C.3 / C.4 | 目录与命令为 M0 目标态 | 待办 |
| `.nvmrc` + `engines` 双写落地（Node 24 LTS） | AGENTS.md C.6-1 | M0 落地 | 待办 |
| 同步事务阻塞毫秒预算（压测后回填 A.5-4） | AGENTS.md A.5-4 | 官方无量化数值，须项目实测 | 待办 |

## 待决策

| 事项 | 背景 | 状态 |
| --- | --- | --- |
| macOS 签名 / 公证证书 | 无证书期发未签名包；证书就绪后填 secrets 并开启 `forceCodeSigning` 硬门禁（AGENTS.md C.5-7） | 待定 |
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
| electron-builder v27 `electronGet` 更名复核 | 同上 §三（C.6-11） | v27 发布后 |
