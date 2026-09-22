// afterPack 钩子：在打包产物二进制上翻转 Electron fuse 位（宪法 B.5-8）
// 裁决清单与逐条证据：docs/agmds-research/2026-09-23-electron-fuses清单.md
//
// 接线：electron-builder.yml `afterPack: ./scripts/flip-fuses.mjs`。
// electron-builder 的 resolveFunction 以动态 import 优先加载钩子文件（支持 ESM .mjs），
// 导出解析优先级为「与钩子同名的具名导出 → default」，故此处具名导出 afterPack。
//
// 时序依据（app-builder-lib packager.js 实证）：afterPack 位于安装包压缩（NSIS/DMG/AppImage）
// 与签名之前——exe 已拷入 appOutDir（可翻转）、翻转结果会进入安装包、OS 签名在后锁定位，
// 三者顺序不可倒置。
//
// 手动复核（只读，不翻转）：
//   node scripts/flip-fuses.mjs --check release/win-unpacked/LearningText.exe
//   node scripts/flip-fuses.mjs --check release/linux-unpacked/learningtext
//   node scripts/flip-fuses.mjs --check release/mac/<productName>.app
import path from 'node:path';
import { access } from 'node:fs/promises';
import {
  flipFuses,
  getCurrentFuseWire,
  FuseVersion,
  FuseV1Options,
  FuseState,
} from '@electron/fuses';

// 全量 fuse 裁决表（9 项 = 当前 fuse wire 全长；每项理由见调研报告，此处只留一句话锚点）。
// 全量显式 + strictlyRequireAllFuses: true，未来 Electron 增加 fuse 位时打包直接失败
// 而非静默漏配，强制补决策（fail-fast）。
const FUSE_DECISIONS = {
  // 关闭 ELECTRON_RUN_AS_NODE：堵「应用二进制当裸 Node 解释器」的环境变量借道攻击面
  [FuseV1Options.RunAsNode]: false,
  // cookie 加密维持官方默认关：本应用不用 Chromium cookie 存储，且该位单向转换、macOS 需签名
  [FuseV1Options.EnableCookieEncryption]: false,
  // 关闭 NODE_OPTIONS/NODE_EXTRA_CA_CERTS：生产形态无需，堵运行时参数注入面
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // 关闭 --inspect/--inspect-brk：调试端口可被本地附着，生产形态无需
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // asar 完整性校验本期不启用：校验链依赖打包器嵌入哈希（mac 侧依赖签名），
  // 无证书期链路不齐备，随 docs/09 spec 与 OnlyLoadAppFromAsar 同批启用
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  // 只从 app.asar 加载本期不启用：官方语义是与上一位组合才构成完整防护，同批缓启
  [FuseV1Options.OnlyLoadAppFromAsar]: false,
  // 主进程专属 V8 快照维持默认关：防的是「渲染器 nodeIntegration 共享快照」暴露面，本应用不存在
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // 关闭 file:// 额外特权：官方明示不服务 file:// 页面就该关（宪法 B.5-2：资源一律走 vfs://）
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  // Wasm 信号捕获维持默认开：关闭只增编译时间/体积/运行时开销，无收益
  [FuseV1Options.WasmTrapHandlers]: true,
};

// 回读状态的人读标签（数字码对应二进制内的字面 '0'/'1'/'r'/未定值）
const FUSE_STATE_LABELS = {
  [FuseState.DISABLE]: 'OFF',
  [FuseState.ENABLE]: 'ON',
  [FuseState.REMOVED]: 'REMOVED（官方已废弃该位，写入无效）',
  [FuseState.INHERIT]: 'INHERIT（二进制缺省未定值）',
};

/**
 * 解析打包产物的 Electron 二进制/包路径（afterPack 钩子入口）。
 *
 * @param {object} context electron-builder AfterPackContext（appOutDir/electronPlatformName/packager 等）
 * @returns {Promise<string>} 哨兵所在二进制的定位入口：win/linux 为主可执行文件，mac 为 .app 包
 *   （flipFuses 内部解析到 Electron Framework 框架二进制——fuse wire 在框架内而非 app 主可执行内）
 * @throws {Error} 平台不支持或产物二进制不存在时抛出（阻断打包，禁止带伤产物继续压缩安装包）
 */
async function resolvePackagedElectronBinary(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productFilename = packager.appInfo.productFilename;
  let candidate;
  switch (electronPlatformName) {
    case 'darwin':
      candidate = path.join(appOutDir, `${productFilename}.app`);
      break;
    case 'win32':
      // win-unpacked 主可执行按 productFilename 命名（本仓实证：release/win-unpacked/LearningText.exe）
      candidate = path.join(appOutDir, `${productFilename}.exe`);
      break;
    case 'linux':
      // LinuxPackager.executableName 缺省为 sanitizedName 的小写（非 productFilename），本仓即 learningtext
      candidate = path.join(appOutDir, packager.executableName || productFilename.toLowerCase());
      break;
    default:
      throw new Error(`[flip-fuses] 不支持的平台：${electronPlatformName}`);
  }
  try {
    await access(candidate);
  } catch {
    throw new Error(`[flip-fuses] 未找到打包产物二进制：${candidate}（appOutDir=${appOutDir}）`);
  }
  return candidate;
}

/**
 * 回读 fuse wire 并逐位断言与裁决一致；不一致抛错阻断打包（fail-fast）。
 * 回读结果逐位打进 electron-builder 构建日志，作为发布闸门的验收证据。
 *
 * @param {string} electronPath 产物二进制/包路径（与 flipFuses 同参语义）
 * @param {Record<number, boolean>} decisions 裁决表（FuseV1Options 值 → 期望开关）
 * @returns {Promise<void>} 全部位一致时正常返回，日志形式：PASS/FAIL + 位名 + 期望/实际
 * @throws {Error} 任一位实际状态与裁决不符，或产物二进制无 fuse 哨兵（@electron/fuses 抛出）
 */
async function assertFuseStates(electronPath, decisions) {
  const wire = await getCurrentFuseWire(electronPath);
  console.log(`[flip-fuses] 回读 fuse wire（版本 ${wire.version}）：`);
  let failed = false;
  for (const [fuseOption, expected] of Object.entries(decisions)) {
    const name = FuseV1Options[fuseOption];
    // 数字键名转回期望状态码（expected 为裁决布尔值）
    const expectedState = expected ? FuseState.ENABLE : FuseState.DISABLE;
    const actual = wire[fuseOption];
    const ok = actual === expectedState;
    failed ||= !ok;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} 期望 ${expected ? 'ON ' : 'OFF'} 实际 ${
        FUSE_STATE_LABELS[actual] ?? actual
      }`,
    );
  }
  if (failed) {
    throw new Error(
      '[flip-fuses] fuse 回读与裁决不符，打包产物不得流出——请核对裁决表与 Electron 版本',
    );
  }
}

/**
 * electron-builder afterPack 钩子：翻转 fuse → 回读断言 → 结果进打包日志。
 * 翻转失败或断言失败都会让 electron-builder 以非零码退出（宪法 fail-fast）。
 *
 * @param {object} context electron-builder AfterPackContext
 * @returns {Promise<void>} 成功时日志收尾打印 sentinel 副本数（mac universal 包为 2）
 * @throws {Error} 二进制定位失败 / 翻转写入失败 / 回读断言失败
 */
export async function afterPack(context) {
  const electronPath = await resolvePackagedElectronBinary(context);
  console.log(`[flip-fuses] 翻转 fuse：${electronPath}`);
  const sentinelCopies = await flipFuses(electronPath, {
    version: FuseVersion.V1,
    // 翻转即改写二进制，mac 必须随后 ad-hoc 重签否则 arm64 拒启；
    // 该标志按 .app 路径特征判定，win/linux 下为 no-op，故常开（将来 CI 持证书签名在后自动覆盖）
    resetAdHocDarwinSignature: true,
    // wire 全长必须被裁决表覆盖，少配即抛错（防 Electron 升级新增位被静默漏配）
    strictlyRequireAllFuses: true,
    ...FUSE_DECISIONS,
  });
  await assertFuseStates(electronPath, FUSE_DECISIONS);
  console.log(`[flip-fuses] 全部 fuse 翻转并回读校验通过（sentinel 副本数 ${sentinelCopies}）`);
}

// 手动复核模式：node scripts/flip-fuses.mjs --check <二进制或 .app 路径>（只读，不翻转）。
// electron-builder 以钩子方式加载本文件时 argv 不含 --check，此分支不触发。
if (process.argv.includes('--check')) {
  const target = process.argv[process.argv.indexOf('--check') + 1];
  if (!target) {
    console.error('用法：node scripts/flip-fuses.mjs --check <产物二进制或 .app 路径>');
    process.exit(1);
  }
  const wire = await getCurrentFuseWire(target);
  console.log(`[flip-fuses] 当前 fuse wire（版本 ${wire.version}）：${target}`);
  for (const [fuseOption, state] of Object.entries(wire)) {
    if (fuseOption === 'version') continue;
    console.log(`  ${FuseV1Options[fuseOption].padEnd(40)} ${FUSE_STATE_LABELS[state] ?? state}`);
  }
}
