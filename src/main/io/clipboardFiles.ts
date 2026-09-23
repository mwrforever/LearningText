/**
 * 剪贴板文件清单读取（2026-09-23 M9 批次，FR-IO-03 粘贴导入）：
 * 从系统剪贴板提取「用户复制的文件/目录」本地路径清单，供 io:import-clipboard 通道直接导入。
 *
 * 信任边界（安全审查口径）：源路径由**主进程**读取剪贴板获得，既不经渲染层也不经对话框
 * 登记簿——登记簿的信任边界针对「渲染层可伪造的路径串」，本模块产出的是主进程自采数据，
 * 渲染层无从注入；故 ipc 层对本通道不做登记簿校验（对照 io:import 的 sourcePaths 校验）。
 *
 * 平台格式差异与 Electron 44 运行时现实（本机探针实证，见模块尾注）：
 * - win32：理论上 FileNameW（CF_HDROP 宽字符形态，UTF-16LE、\0 分隔、双 \0 收尾）优先，
 *   老 ANSI 形态 FileName 次之；Electron 44 已不再暴露这两个原始格式，文件复制统一映射为
 *   text/uri-list——故 win32 分支保留原始格式优先级（升级兼容 / 其他来源可能携带）并以
 *   uri-list 兜底。
 * - darwin：public.file-url（Finder 复制产出的 file:// URI 串）优先；text/uri-list 兜底。
 * - linux 及其他：text/uri-list（各文件管理器统一约定，每行一条 file:// URI）。
 *
 * 纯函数 + DI 缝（ClipboardReader）：剪贴板访问是平台副作用且为异步 API，测试以假体驱动
 * 全部分支；生产适配（clipboardReaderFromItems）把一次 clipboard.read() 快照装配成读取面
 * （宪法 A.5-1 主进程顶层只做装配）。
 */
import { fileURLToPath } from 'node:url';

/** Windows 剪贴板格式名（宽字符形态，优先） */
const FORMAT_FILE_NAME_W = 'FileNameW';
/** Windows 剪贴板格式名（ANSI 回退形态） */
const FORMAT_FILE_NAME = 'FileName';
/** macOS 剪贴板格式名（Finder 复制文件产出的 file:// URI） */
const FORMAT_PUBLIC_FILE_URL = 'public.file-url';
/** 跨平台剪贴板格式名（每行一条 file:// URI，# 开头为注释行；Electron 44 文件复制的统一映射） */
const FORMAT_URI_LIST = 'text/uri-list';

/**
 * 剪贴板读取器（DI 缝，异步形态）：生产实现为 clipboardReaderFromItems（对一次
 * clipboard.read() 快照的读取面），测试注入假体以驱动平台分支与异常路径。
 * 只暴露读取面，不暴露剪贴板写能力。异步的原因：Electron 44 已移除同步剪贴板 API
 * （availableFormats / readBuffer 运行时为 undefined，本机探针实证），唯一读取入口是
 * 异步的 clipboard.read()。
 */
export interface ClipboardReader {
  /** 当前剪贴板快照含有的格式名清单（对应 Electron clipboard.read() 各项 types 的并集） */
  availableFormats(): Promise<readonly string[]>;
  /** 按格式名读取文本形态内容（UTF-8 解码；格式不存在时拒绝，由调用方 try/catch 收敛） */
  read(format: string): Promise<string>;
  /** 按格式名读取二进制形态内容（格式不存在时拒绝，由调用方 try/catch 收敛） */
  readBuffer(format: string): Promise<Buffer>;
}

/** getType 产物的结构视图（Node/Chromium Blob 形态；不引入 electron 进程专属类型） */
export interface ClipboardBlobLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Electron ClipboardItem 的结构视图（duck typing，保持本模块零 electron 依赖） */
export interface ClipboardItemLike {
  /** 本条目携带的格式名清单（clipboard.read() 各项的 types 原样） */
  readonly types: readonly string[];
  /** 按格式名取载荷；契约上仅在格式缺失时拒绝（bookmark 分支与本模块格式名不相交） */
  getType(type: string): Promise<ClipboardBlobLike>;
}

/**
 * 把一次 clipboard.read() 的快照装配为同步快照上的异步读取面（生产适配器）：
 * 三个读取面都消费同一份 items 快照，保证 availableFormats 与 read/readBuffer 看到的是
 * 同一次粘贴内容（多次 read() 可能跨越剪贴板变更，快照语义是正确性前提而非优化）。
 * @param items Electron clipboard.read() 的返回值（ClipboardItem 数组，可为空数组）
 * @returns ClipboardReader（格式缺失时 read/readBuffer 拒绝，调用方 try/catch 收敛空清单）
 */
export function clipboardReaderFromItems(items: readonly ClipboardItemLike[]): ClipboardReader {
  // 按格式名定位条目并取载荷：快照内找不到即拒绝（读侧前置 availableFormats 检查，
  // 正常流不可达；异常拒绝由 readClipboardFilePaths 的 try/catch 收敛为空清单）
  function blobOf(format: string): Promise<ClipboardBlobLike> {
    const item = items.find((candidate) => candidate.types.includes(format));
    if (item === undefined) {
      return Promise.reject(new Error(`剪贴板快照中不存在格式 ${format}`));
    }
    return item.getType(format);
  }
  return {
    availableFormats: async () => items.flatMap((item) => [...item.types]),
    read: async (format) =>
      Buffer.from(await (await blobOf(format)).arrayBuffer()).toString('utf8'),
    readBuffer: async (format) => Buffer.from(await (await blobOf(format)).arrayBuffer()),
  };
}

/**
 * 解析 Windows `FileNameW` 剪贴板格式：一串以 `\0` 结尾的 UTF-16LE 字符串、名单以双 `\0` 收尾。
 * @param buffer 剪贴板原始字节（FileNameW 格式载荷）
 * @returns 条目路径清单（空项已剔除；无内容返回空数组，调用方据此走「剪贴板无文件」提示）
 */
export function parseWindowsFileNameW(buffer: Buffer): string[] {
  return splitNulSeparated(buffer.toString('utf16le'));
}

/**
 * 解析 `text/uri-list` 文本：每行一条 URI，`#` 开头为注释行。
 * 仅保留 `file:` 协议条目并转本地路径——非 file: 协议（http/data 等）与非 URI 行静默跳过，
 * 单行畸形 URI 被 fileURLToPath 拒绝时同样跳过：一行坏数据不得炸掉整次粘贴（调用方已备
 * 「无可用路径」的克制提示路径）。逐行跳过不记日志，避免循环内刷日志（全局 §二）。
 * @param text 剪贴板文本内容
 * @returns 本地路径清单（保持行序；无可用条目返回空数组）
 */
export function parseUriList(text: string): string[] {
  const paths: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (!line.startsWith('file:')) continue;
    try {
      paths.push(fileURLToPath(line));
    } catch {
      // 畸形 file: URI（非法转义、非本地主机名等）：跳过该行，其余条目照常返回
    }
  }
  return paths;
}

/**
 * 按平台读取剪贴板中的文件路径清单（FR-IO-03 入口，异步）：
 * 逐平台尝试主格式 → 回退格式 → 无可用格式返回空数组，收尾按首次出现顺序去重。
 * 剪贴板访问受平台实现影响可能失败（快照缺失格式、无 X 会话的 Linux、剪贴板被占用等）：
 * 整体包 try/catch 并 warn 留痕后返回空数组——粘贴失败降级为「剪贴板无文件」提示，
 * 不得让异常穿透到 IPC handler 或主进程。
 * @param deps.platform 运行平台（process.platform 原样；注入以便测试覆盖三平台分支）
 * @param deps.clipboard 剪贴板读取器（生产 = clipboardReaderFromItems 快照适配）
 * @returns 去重后的本地路径清单（无可用文件返回空数组）
 */
export async function readClipboardFilePaths(deps: {
  platform: string;
  clipboard: ClipboardReader;
}): Promise<readonly string[]> {
  try {
    const { platform, clipboard } = deps;
    const formats = await clipboard.availableFormats();
    if (platform === 'win32') {
      // 原始格式优先级保留（FileNameW → FileName）；Electron 44 不再暴露二者，
      // 文件复制统一映射为 uri-list——这是本分支的生产主路径（本机探针实证）
      if (formats.includes(FORMAT_FILE_NAME_W)) {
        return dedupe(parseWindowsFileNameW(await clipboard.readBuffer(FORMAT_FILE_NAME_W)));
      }
      if (formats.includes(FORMAT_FILE_NAME)) {
        return dedupe(splitNulSeparated(await clipboard.read(FORMAT_FILE_NAME)));
      }
      if (formats.includes(FORMAT_URI_LIST)) {
        return dedupe(parseUriList(await clipboard.read(FORMAT_URI_LIST)));
      }
      return [];
    }
    if (platform === 'darwin') {
      if (formats.includes(FORMAT_PUBLIC_FILE_URL)) {
        return dedupe(parseUriList(await clipboard.read(FORMAT_PUBLIC_FILE_URL)));
      }
      if (formats.includes(FORMAT_URI_LIST)) {
        return dedupe(parseUriList(await clipboard.read(FORMAT_URI_LIST)));
      }
      return [];
    }
    // linux 及一切其他平台：text/uri-list 为各文件管理器统一约定
    if (formats.includes(FORMAT_URI_LIST)) {
      return dedupe(parseUriList(await clipboard.read(FORMAT_URI_LIST)));
    }
    return [];
  } catch (error: unknown) {
    console.warn('[clipboard] 读取剪贴板文件清单失败', error);
    return [];
  }
}

/** `\0` 分隔串切分去空（FileNameW 二进制形态与 FileName 文本形态共用的分隔约定） */
function splitNulSeparated(text: string): string[] {
  return text.split('\0').filter((entry) => entry.length > 0);
}

/**
 * 按首次出现顺序去重：同一批复制的目录树可能同时出现在多种格式中，Set 保序即「先到者为准」。
 */
function dedupe(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

/**
 * 模块尾注 · Electron 44 剪贴板运行时探针（2026-09-23，本机 Windows 实测）：
 * ① 同步 API 已移除——clipboard.availableFormats / readBuffer 均为 undefined，运行时键仅
 *    clear/has/readText/writeText/read/write；类型面（electron.d.ts）同样只有异步成员。
 * ② 文件复制统一映射——以 PowerShell Set-Clipboard -Path 置入真实 CF_HDROP 文件复制项后，
 *    clipboard.has('text/uri-list') 为 true，read() 返回的 ClipboardItem 携带 text/uri-list
 *    载荷（内容为 file:/// URI 行）；FileNameW 不在 types 中，仅 osclipboard 原始格式的
 *    FileName（ANSI）与 DataObject/Ole Private Data 可见。
 * 据此：读取面走异步快照（clipboardReaderFromItems），win32 生产主路径为 uri-list 兜底分支。
 */
