# TASK.md — 登记台

> 用途：登记待调研项 / 待决策 / 待回填 / TODO 工单；条目完成或回填后删除。
> 规则：宪法正文修订**先记 `CHANGELOG.md` 再改正文**；一次性例外事项在此登记并限定范围，禁止直接绕过宪法。

## 待回填（M0 脚手架落地时核对）

| 事项 | 涉及段落 | 原因 | 状态 |
| --- | --- | --- | --- |
| package.json / package-lock.json 锁定精确版本（M0-Task 2 触发 TS 版线修正 7.0.x→6.0.3） | AGENTS.md C.2 | 版本已锁定；版线修正已记 CHANGELOG（2026-09-15）并回填 C.2 正文 | 完成（M0） |

## 待决策

| 事项 | 背景 | 状态 |
| --- | --- | --- |
| TypeScript 升级回 7.x（C.2 基线 7.0.x，当前锁 6.0.3） | M0-Task 2 锁版预检：typescript-eslint 8.70.0 的 typescript peer 范围 `>=4.8.4 <6.1.0` 不含 7.x，暂取范围内最高版 6.0.3（已记 CHANGELOG 2026-09-15）；待 typescript-eslint 声明 7.x 支持后评估升级 | 待定 |
| macOS 签名 / 公证证书 | 无证书期发未签名包；证书就绪后填 secrets 并开启 `forceCodeSigning` 硬门禁（跟踪见「执行项登记」release 行） | 待定 |
| better-sqlite3 13.x（N-API）可否免 electron-rebuild | 调研 P-2：官方未给 Electron 场景操作指引，保守保留 rebuild 兜底 | 待定 |
| 开源许可证（README 暂标注待定：MIT） | 影响打包与发布 | 待定 |
| package.json 缺 `author` 字段 | M6 electron-builder NSIS 打包需要，打包前必须补齐 | 待定 |
| electron-builder 以 `postinstall: electron-builder install-app-deps` 替代直调 @electron/rebuild | 打包日志建议项（依赖编排更贴近 electron-builder 语义） | 待定 |
| Vite/Vitest configLoader 'native' 迁移警告（config 文件含 ESM 语法但以 CJS 加载，native 计划成为默认） | 根治需切 `"type":"module"`（CJS/ESM 跨任务决策，影响构建产物形态），随 M1 构建编排重构一并评估 | 已裁决（2026-09-16）：M1 暂不切 "type":"module"——收益仅消除构建警告，代价是主进程 CJS 产物加载链与 preload 捆绑输出的连锁重构；待 Vite 将 native loader 设为默认（大版本升级预警）时随迁移条目再评估 |
| VFS 同路径双回收站树 purge 连带清理 | 同一虚拟路径先后两次 trash 形成两棵回收站树时，purge 任一入口按路径谓词会连带物理移除两棵（谓词无法区分树身份）；restore 场景有 partial unique 约束兜底回滚、无数据风险；根治需 parent_id 递归 CTE 按树定位，属设计级改动 | 待定（M2 开工前评估） |
| ListChildrenRequest 二选一参数未强制互斥 | zod 默认 strip 模式下同时传 parentId 与 virtualPath 会命中 parentId 分支通过校验（spec §7.3 写明互斥）；行为确定性无害（服务层恒取 parentId），终审 Minor；改 z.strictObject 分支即可（spec §8.2 已背书 strictObject） | 待定（下次契约触碰时顺手处理） |
| moveNode 移到当前父目录报误导性 E_VFS_DUPLICATE_NAME | 重名预查命中节点自身（renameNode 有同名短路、moveNode 无对应处理）；计划级语义毛边，终审 Minor | 待定（下次服务触碰时加 target.id === row.parent_id 短路返回 affectedCount 0） |
| restoreNode 返回 meta.updatedAt 为还原前旧值 | stmtRestoreSubtree 已刷 updated_at 但返回用还原前快照，restored 广播事件携带同旧值；无契约要求新鲜度，终审 Minor | 待定（M4 消费广播前裁决：文档化「restored 后以重查为准」或返回还原后行） |
| A.5-4 毫秒预算基线口径偏乐观 | 万行写入基准为裸 SQL 绕过服务层与 node_fts 插入、启动基准为空 :memory: 库（注释已诚实声明）；200ms 预算有十倍余量结论不翻，终审 Minor | 待定（M2 引入文件库 + 服务层路径重测，保持预算结论可追溯） |

## 待调研项（源自 docs/agmds-research/ 四份报告，注明触发时机）

| 事项 | 来源报告 | 触发时机 |
| --- | --- | --- |
| tsconfig 次级开关取值（exactOptionalPropertyTypes / verbatimModuleSyntax / isolatedModules） | 2026-09-14-语言框架与UI栈.md §三 | M0 编写 tsconfig 前 |
| TypeScript 7 与 5.x/6.x 行为差异 | 同上 §三 | M0 版本锁定前 |
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

> 位置约定（用户 2026-09-16 指定）：spec（设计文档）落 `docs/superpowers/specs/YYYY-MM-DD-<主题>-design.md`（superpowers 体系约定目录）；实施计划落 `docs/superpowers/plans/`。表中编号为路线图序号，不再作为文件名前缀。

| 编号 | spec | 决策范围（docs/03 缺口） | 定稿时机 | 状态 |
| --- | --- | --- | --- | --- |
| docs/06 | 预览管线详细设计 | protocol.handle 响应语义（Content-Type/ETag/Range）、iframe 沙箱属性与 CSP 具体值、去抖与刷新事件归属、滚动同步协议（P1） | M3 开工前（先完成 protocol.handle 待调研项） | 待撰写 |
| docs/07 | 编辑器与保存管线设计 | 多标签页状态模型、自动保存去抖与写合并（竞态规则）、大文件阈值行为 | M4 开工前 | 待撰写 |
| docs/08 | 导入导出与辅助功能设计 | 导入冲突判定键与三策略（跳过/重命名/覆盖）语义、vfs:// → 相对路径改写算法、设置 schema、备份命名与恢复流程 | M5 开工前 | 待撰写 |
| docs/09 | 打包与发布规格 | electron-builder 配置基线、@electron/fuses 关闭清单（待调研项）、release 工作流与签名占位、版本号策略 | M6 开工前（先完成 fuses 待调研项） | 待撰写 |

不需要单独 spec 的：M0 脚手架（宪法 C.4/C.6 + TASK.md 执行项已是完整依据）；IPC 字段级契约（在 `src/shared` 以 TS + zod 为单一来源，docs/03 §7 已定通道语义，代码即规格）；安全基线（宪法 B.5 禁令已完备）。

## 执行项登记（实现类工作不入宪法，在此跟踪）

| 事项 | 依据 | 触发时机 | 状态 |
| --- | --- | --- | --- |
| 落地 `.github/workflows/ci.yml`（触发面 [main, dev]）：三平台矩阵（fail-fast: false + 每作业 timeout）、六阶段流水线（npm ci → 静态质量 → Vitest+覆盖率 → electron-rebuild → E2E → --dir 打包冒烟）、concurrency 取消旧跑 / permissions 只读 / 禁 paths 过滤、缓存（npm + Electron 二进制 zip + electron-builder；Playwright 浏览器不缓存）、产物仅短期 artifact 不发布。**实施计划：docs/superpowers/plans/2026-09-15-M0-脚手架与CI.md（SDD 执行）** | docs/agmds-research/2026-09-14-CI链与生产落地.md §三方案 A | M0 | 完成（M0） |
| 配置分支保护（**dev=日常开发主干；main=生产分支，项目完整落地后一次性合入并触发完整 CI/CD 打包发布**）：dev 与 main 必需检查 = 三平台检查名 + 要求分支同步，无人工绕过通道 | 同上；分支模型经用户 2026-09-15 指定 | M0 首个 PR 前 | 完成（M0） |
| 【M1 前置】补齐 B.5-4/5 窗口安全基线缺口：`will-navigate` origin 白名单拦截（URL 解析器比较）、`setWindowOpenHandler` 一律 deny、`setPermissionRequestHandler` 默认拒绝 | 宪法 B.5-4/5 强制条款，M0 未落地 | M1 窗口 / 预览工作时优先补齐 | 完成（M1） |
| 【M1 前置】preload 从 tsconfig.main 拆出独立构建：现 dev watch 与单独 `npm run build:main` 会用 tsc 多文件产物覆盖 rolldown 单文件 preload（sandbox 下坏产物、dev 形态 IPC 断），重构构建编排——dev 主开发循环即受影响，M1 开工首日即撞上 | M0-Task 8/11 实测遗留 | M1 前置（M1 开工首日） | 完成（M1） |
| release 发布工作流：tag 触发、draft release 人工发布闸门、签名 / 公证 secrets 占位、`forceCodeSigning` 证书就绪后开启为硬门禁 | 同上 §三方案 C | M6 | 待办 |
| electron-builder v27 `electronGet` 更名复核 | 同上 §三（C.6-11） | v27 发布后 |
