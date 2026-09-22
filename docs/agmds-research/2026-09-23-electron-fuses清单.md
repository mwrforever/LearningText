# 调研报告：Electron fuses 全量清单与 @electron/fuses 用法（打包期安全位翻转）

- 归属文档：仓库根 `AGENTS.md` B.5-8（打包阶段用 `@electron/fuses` 关闭 `runAsNode` / `nodeCliInspect` 等不需要的 fuse）
- 补齐缺口：`2026-09-14-语言框架与UI栈.md` §三 B 槽位（安全清单第 19 条仅给出原则与模块名，细节页未取证，即 B0-19 待调研项）
- 调研日期：2026-09-23
- 版本基线：Electron 44.3.0（本仓锁定）；`@electron/fuses` 2.1.3（npm dist-tags latest，2026-09-23 实查，`--save-exact` 锁定入 devDependencies）
- 取证方式：Electron 官方 fuses 文档（docs/latest）逐条原文 + `@electron/fuses` 官方 README + 本地 `node_modules/@electron/fuses/dist` 源码（2.1.3 即最终运行版本）+ `electron-builder` 26.15.3 本地源码（钩子时序 / ESM 钩子加载 / 发布链）

---

## 一、fuses 机制概况（Electron 官方）

来源：https://www.electronjs.org/docs/latest/tutorial/fuses

- fuses 是打进 Electron 二进制的「魔法位」：以哨兵字符串（`dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`）+ 版本字节 + 线长字节 + 每 fuse 一字节（`0x30`=禁用 / `0x31`=启用 / `0x72`=已移除）编码在二进制内，打包期翻转、运行期生效。
- **翻转必须发生在 OS 代码签名之前**：签名后二进制被 OS（Gatekeeper / AppLocker）校验锁死，再翻转即签名失效。这是「afterPack 钩子接线」的时序根本依据（见 §三）。
- 官方推荐工具即 `@electron/fuses`（Electron Forge 另有 `@electron-forge/plugin-fuses` 包装）；验证手段为 `npx @electron/fuses read --app <path>` 或程序化 `getCurrentFuseWire`。
- 未标注为「单向转换」的 fuse 均可反复翻转；`cookieEncryption` 例外（见下表）。

## 二、全量 fuse 清单与逐条裁决（9 项，FuseV1Options 线序）

官方默认值取自 Electron 官方 fuses 文档页（当前 docs/latest，对应 Electron 44.x）；「本应用裁决」的落地位置为 `scripts/flip-fuses.mjs`（afterPack 钩子，见 §三）。

| # | fuse（FuseV1Options） | 官方默认 | 作用（官方语义） | 本应用裁决 | 理由（证据锚点） |
| --- | --- | --- | --- | --- | --- |
| 0 | `RunAsNode` | 启用 | 切换是否尊重 `ELECTRON_RUN_AS_NODE` 环境变量（借道可把应用二进制当裸 Node 解释器执行任意脚本） | **关闭** | 官方安全清单第 19 条点名项：攻击者借环境变量「living off the land」提权为任意代码执行。本应用生产形态无任何以 RUN_AS_NODE 运行子进程的需求；官方明示关闭后 `child_process.fork` 会抛错，替代物是 UtilityProcess——与宪法 A.5-5（CPU 密集任务剥离 utility process）本就同向 |
| 1 | `EnableCookieEncryption` | 禁用 | 用 OS 级加密密钥加密磁盘上的 Chromium cookie SQLite 库 | 维持默认（不启用） | 本应用为本地单机工具，不用 Chromium cookie 存储（无网络会话）；启用有两条硬约束：单向转换（先开后关即损坏 cookie 库）、macOS 需代码签名（Keychain 访问，与 safeStorage 同源）。无收益即不动，避免引入不可逆状态 |
| 2 | `EnableNodeOptionsEnvironmentVariable` | 启用 | 切换是否尊重 `NODE_OPTIONS` / `NODE_EXTRA_CA_CERTS` 环境变量 | **关闭** | `NODE_OPTIONS` 可向主进程注入 V8/Node 参数，与 #0 同属环境变量借道攻击面；官方原文「rarely needed in production; most apps can safely disable it」。本应用生产形态不需要 |
| 3 | `EnableNodeCliInspectArguments` | 启用 | 切换 `--inspect` / `--inspect-brk` 命令行参数（关闭后 SIGUSR1 也不再拉起 inspector） | **关闭** | 宪法 B.5-8 点名项：调试端口可被本地攻击者附着检查/注入；官方原文「most apps can safely disable it」。本应用生产形态不需要远程调试 |
| 4 | `EnableEmbeddedAsarIntegrityValidation` | 禁用 | 加载时校验 `app.asar` 内容（macOS 自 Electron 16、Windows 自 Electron 30），性能开销极小 | **本期不启用**（随 docs/09 spec 启用） | 校验是「链」不是「位」：启用后 Electron 依赖打包器把 asar SHA-256 嵌入载体——macOS 注入 Info.plist 且**依赖代码签名**，Windows 嵌入 exe 资源段；当前无签名证书（TASK.md「待决策：macOS 签名/公证证书」行），链路条件不齐备。electron-builder 26 侧配套已具备（`asar.disableIntegrity` 未关即自动计算嵌入，`electronFuses` 配置可在签名前翻转），证书就绪后随 docs/09《打包与发布规格》一并启用并验收。任务书明确允许缓裁，不为未验收的校验链破坏既有打包语义 |
| 5 | `OnlyLoadAppFromAsar` | 禁用 | 限制应用代码只从 `app.asar` 加载（不再搜索 `app` 目录 / `default_app.asar`） | **本期不启用**（与 #4 同批） | 官方原文：与 asar 完整性校验组合「ensures that it is impossible to load non-validated code」——即 #5 单独启用只是残缺防护，完整收益依赖 #4 的链路；同批缓启避免「加载面收窄」与「完整性校验」分两次各验一半 |
| 6 | `LoadBrowserProcessSpecificV8Snapshot` | 禁用 | 主进程改用 `browser_v8_context_snapshot.bin` 专属 V8 快照，防渲染器使用含 nodeIntegration 的共享快照 | 维持默认（不启用） | 该防护针对「渲染器开启 nodeIntegration」的暴露面；本应用渲染层全沙箱、无 Node 集成（宪法 B.5-1），暴露面不存在；启用以主进程启动时间为代价，纯亏 |
| 7 | `GrantFileProtocolExtraPrivileges` | 启用 | 给 `file://` 页面额外特权（file:// 互访 fetch、service worker、对子 frame 的通用访问） | **关闭** | 官方原文「If you don't serve pages from file://, you should disable it」。本应用禁 `file://` 加载应用页面与资源（宪法 B.5-2，VFS 资源一律走 `vfs://` 自定义协议），特权只留攻击面无收益 |
| 8 | `WasmTrapHandlers` | 启用 | WebAssembly 越界访问用信号处理器 + guard region 捕获（x86_64 三平台 / aarch64 Linux+macOS） | 维持默认（启用） | 关闭的官方代价明确：编译时间、二进制体积、运行时开销全增。本应用虽暂不跑 wasm，没有理由付关闭代价 |

裁决原则归纳：**默认开启的攻击面位一律关**（#0/#2/#3/#7，均有官方「safely disable」背书）；**默认关闭的防护位只在整链可验收时启用**（#4/#5 本期缓，登记 docs/09）；**默认关闭且无暴露面的不动**（#1/#6）；**默认开启的性能位不动**（#8）。9 项全量显式写入裁决表并配合 `strictlyRequireAllFuses: true`（见 §三）——未来 Electron 增加 fuse 位时打包直接失败而非静默漏配，强制补决策，与宪法 fail-fast 精神一致。

补充诚实注记：#4/#5 启用后并非绝对防线——CVE-2025-55305（Electron ASAR Integrity Bypass，2025 年披露）证明校验链本身也曾被绕过；启用时按当期安全通告验收，不当作银弹。

## 三、落地方式与证据（afterPack + @electron/fuses 2.1.3）

### 3.1 钩子选型与时序（electron-builder 26.15.3 本地源码实证）

`app-builder-lib/out/packager.js` 的 `doBuild`：`pack()`（Electron 二进制拷贝、asar 打包、原生依赖重编译）→ **`afterPack` 钩子** → `afterSign` → 各 target `finishBuild()`（NSIS / DMG / AppImage 安装包产物）→ `buildFinalizeTasks`。源码注释明示 finalize 阶段才是「targets 全部读完共享 appOutDir 之后唯一可安全变更它的时点」——反证 `afterPack` 时安装包尚未压缩、产物二进制无进程占用。

结论：**afterPack 时序可行且是官方推荐位**——exe 已拷入 `appOutDir`（可翻转）、NSIS/DMG 尚未生成（翻转会进入安装包）、签名在后（签名锁定位不冲突）。Windows「exe 被占用不可写」顾虑在此不成立：占用发生在安装/运行期，不在打包期。`@electron/fuses` 官方 README 亦明示 flipFuses「called after packaging but before code signing (e.g., in an electron-builder afterPack hook)」。

### 3.2 API 事实（本地 `node_modules/@electron/fuses/dist` 源码，2.1.3）

- `flipFuses(pathToElectron: string, fuseConfig): Promise<number>`——对二进制以 `r+` 原地写；**注意 2.1.3 的首参是路径字符串**（README 示例传 `require('electron')` 即因其返回路径字符串）。返回哨兵副本数（universal macOS 二进制为 2，其余为 1）。
- `getCurrentFuseWire(pathToElectron): Promise<FuseConfig<FuseState>>`——只读回读当前 wire；**2.1.3 无 `isFuseEnabled` 导出**，读取校验统一用本 API。
- `FuseState`：`DISABLE=48 / ENABLE=49 / REMOVED=114 / INHERIT=144`（对应字面 `0/1/r/`未定值）。
- macOS 路径解析：传 `.app` 包路径时内部解析到 `Contents/Frameworks/Electron Framework.framework/Electron Framework`（fuse wire 在框架二进制内，不在 app 主可执行内）；win/linux 传主可执行文件路径。
- `resetAdHocDarwinSignature: true`：翻转后对 `.app` 执行 ad-hoc 重签（`codesign --sign - --deep`）；实现上按 `.app` 路径特征判定，**win/linux 下为 no-op**，因此常开安全。不重签的后果是 arm64 mac 拒绝启动（签名校验失败）。将来 CI 持证书签名时，electron-builder 签名在翻转之后执行，自动覆盖 ad-hoc 签名且保留 fuse 位。
- `strictlyRequireAllFuses: true`：要求配置覆盖二进制 wire 上的每一位，少配即抛错（配合 §二全量裁决表）。

### 3.3 钩子文件形态与接线

- electron-builder 用户钩子经 `app-builder-lib/out/packager.js` `resolveFunction`（`util/resolve.js`）加载：**动态 `import()` 优先、`require` 兜底，支持 ESM `.mjs`**；导出解析优先级「与钩子同名的具名导出 → `default` 导出 → 模块本身」。故 `scripts/flip-fuses.mjs` 以**具名导出 `afterPack`** 接线。
- `electron-builder.yml` 增加 `afterPack: ./scripts/flip-fuses.mjs`（相对路径按 workspace root 解析并经 `realpath` 校验防逃逸）。
- 跨平台产物二进制定位（钩子内按 `electronPlatformName` 分派，全部有源码依据）：
  - `win32`：`<appOutDir>/<productFilename>.exe`（实证：本仓 `release/win-unpacked/LearningText.exe`）；
  - `darwin`：`<appOutDir>/<productFilename>.app`（交由 flipFuses 内部解析框架二进制）；
  - `linux`：`<appOutDir>/<executableName>`，`executableName` 缺省为 `sanitizedName.toLowerCase()`（`app-builder-lib/out/linuxPackager.js` 实证——**不是** `productFilename`，即 `learningtext`）。
- 钩子内翻转后用 `getCurrentFuseWire` 回读逐位断言（期望 vs 实际），并把每位结果打进 electron-builder 构建日志；任一位不符即抛错阻断打包（fail-fast，禁止带伤产物流出）。

### 3.4 备选方案记录：electron-builder 原生 `electronFuses`（本期未采用）

`app-builder-lib@26.15.3` 的 `scheme.json` 已含顶层 `electronFuses` 配置（描述「Options to pass to `@electron/fuses`」，`FuseOptionsV1` 与 `@electron/fuses` 旗标 1:1，官方语义「flips fuses after packaging and before signing」，并要求启用 `enableEmbeddedAsarIntegrityValidation` 时 `asar.disableIntegrity` 不得为 true——即原生联动 asar 完整性嵌入）。

本期按任务书走显式 afterPack 脚本，理由：① 翻转结果逐位回读并打进打包日志是本批次的硬性验收项，脚本内做断言最直接；② 逐条裁决理由随代码注释同文件维护，评审可读；③ 原生配置为等效简化项，登记 docs/09《打包与发布规格》评审时可择一切换（切换成本：yml 数行 + 删脚本，无行为差异）。

## 四、发布工作流关键事实（同批取证，支撑 .github/workflows/release.yml）

- electron-builder 无 `publish` 配置时：检测到 `GH_TOKEN` / `GITHUB_TOKEN` 即自动选 github provider（`app-builder-lib/out/publish/PublishManager.js` `resolvePublishConfigurations` 实证）；仓库定位回退链为 package.json `repository` 字段 → Travis/Circle CI 环境变量 → `.git/config` 的 remote origin URL（`app-builder-lib/out/util/repositoryInfo.js` 实证）。本仓 package.json 无 `repository` 字段，但 Actions checkout 产生的 `.git/config` 满足第三级回退，无需补字段。
- GitHub publisher 默认 `releaseType: "draft"`（`electron-publish/out/githubPublisher.js` 实证：无显式配置且非 prerelease tag 时取 "draft"）——tag 推送产出草稿 release，人工审核后手动发布，即「人工发布闸门」，无需改 electron-builder.yml 既有语义。
- `--publish always` vs `--publish onTagOrDraft`：工作流触发面已限定 `v*` tag，两者等效；取 `always`（语义直白，不依赖 CI 环境探测分支）。

## 五、来源清单（全部为本报告实际引用并核实过的 URL / 源码位置）

- Electron fuses 官方文档：https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron 安全清单（第 19 条 fuses 原则）：https://www.electronjs.org/docs/latest/tutorial/security
- `@electron/fuses` 官方 README：https://github.com/electron/fuses
- `@electron/fuses` 版本核实：https://registry.npmjs.org/-/package/@electron/fuses/dist-tags （latest=2.1.3，2026-09-23 实查）
- 本地源码（2.1.3 API 事实）：`node_modules/@electron/fuses/dist/index.js` / `config.d.ts` / `constants.d.ts`
- 本地源码（钩子时序 / ESM 加载 / linux 命名 / 发布链）：`node_modules/app-builder-lib/out/packager.js`、`out/util/resolve.js`、`out/linuxPackager.js`、`out/publish/PublishManager.js`、`out/util/repositoryInfo.js`、`scheme.json`；`node_modules/electron-publish/out/githubPublisher.js`
- CVE-2025-55305（ASAR integrity bypass，诚实注记）：https://github.com/electron/electron/security/advisories
