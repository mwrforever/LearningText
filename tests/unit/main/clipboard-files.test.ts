// 剪贴板文件清单读取单元测试（M9 批次，FR-IO-03）：纯函数解析（FileNameW / uri-list）、
// 快照读取面装配（clipboardReaderFromItems）与平台优先级分支（win32 / darwin / linux）、
// 去重保序与「读取失败降级空清单不炸主进程」的异常路径。全部经 ClipboardReader 假体驱动，
// 不触真实系统剪贴板。
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  clipboardReaderFromItems,
  parseUriList,
  parseWindowsFileNameW,
  readClipboardFilePaths,
  type ClipboardItemLike,
  type ClipboardReader,
} from '../../../src/main/io/clipboardFiles';

/** UTF-16LE 编码 FileNameW 载荷（\0 分隔、双 \0 收尾，与 Windows 剪贴板字节形态一致） */
function fileNameWBuffer(paths: string[]): Buffer {
  return Buffer.from(paths.join('\0') + '\0\0', 'utf16le');
}

/** Buffer → 结构化 Blob 视图（测试侧构造，与 ClipboardItemLike 契约同形） */
function bytesAsBlobLike(buffer: Buffer): { arrayBuffer(): Promise<ArrayBuffer> } {
  return {
    arrayBuffer: () =>
      Promise.resolve(
        // Buffer 底层可为共享池：按字节区间切片后经受控断言定型 ArrayBuffer（A.1-5 测试期同款）
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      ),
  };
}

/** 构造 ClipboardItem 快照项（文本载荷，UTF-8 字节） */
function textItem(types: string[], text: string): ClipboardItemLike {
  const bytes = Buffer.from(text, 'utf8');
  return { types, getType: () => Promise.resolve(bytesAsBlobLike(bytes)) };
}

/** ClipboardReader 假体：按格式名编程返回清单/文本/字节（缺失格式拒绝） */
function makeReader(overrides: {
  formats?: readonly string[];
  texts?: Record<string, string>;
  buffers?: Record<string, Buffer>;
  formatsError?: Error;
}): ClipboardReader {
  return {
    availableFormats: () =>
      overrides.formatsError !== undefined
        ? Promise.reject(overrides.formatsError)
        : Promise.resolve(overrides.formats ?? []),
    read: (format) => {
      const text = overrides.texts?.[format];
      return text === undefined
        ? Promise.reject(new Error(`无格式 ${format}`))
        : Promise.resolve(text);
    },
    readBuffer: (format) => {
      const buffer = overrides.buffers?.[format];
      return buffer === undefined
        ? Promise.reject(new Error(`无格式 ${format}`))
        : Promise.resolve(buffer);
    },
  };
}

describe('parseWindowsFileNameW', () => {
  it('解码 UTF-16LE 双零收尾名单：多路径逐项拆分、空项剔除', () => {
    const buffer = fileNameWBuffer(['D:\\a\\1.html', 'D:\\a\\2.html']);
    expect(parseWindowsFileNameW(buffer)).toEqual(['D:\\a\\1.html', 'D:\\a\\2.html']);
  });

  it('空载荷（仅双零收尾）返回空数组', () => {
    expect(parseWindowsFileNameW(fileNameWBuffer([]))).toEqual([]);
  });
});

describe('parseUriList', () => {
  it('仅保留 file: 协议行并逐行转本地路径，保持行序', () => {
    const paths = parseUriList(['file:///D:/a/1.html', 'file:///D:/a/2.html'].join('\r\n'));
    // 转换语义即 fileURLToPath（平台相关分隔符由 node:url 保证），行序保持
    expect(paths).toEqual([
      fileURLToPath('file:///D:/a/1.html'),
      fileURLToPath('file:///D:/a/2.html'),
    ]);
  });

  it('注释行（# 开头）与非 URI 空行忽略', () => {
    const paths = parseUriList('# comment\n\nfile:///D:/a/1.html\n');
    expect(paths).toEqual([fileURLToPath('file:///D:/a/1.html')]);
  });

  it('非 file: 协议（http/data）静默跳过，不产出路径', () => {
    const paths = parseUriList('https://example.com/a.html\ndata:text/plain,hi\n');
    expect(paths).toEqual([]);
  });

  it('畸形 file: URI（非法转义）跳过该行，其余条目照常返回（一行坏数据不炸整次粘贴）', () => {
    const paths = parseUriList('file:///D:/a/%zz.html\nfile:///D:/b.html');
    expect(paths).toEqual([fileURLToPath('file:///D:/b.html')]);
  });

  it('空文本返回空数组', () => {
    expect(parseUriList('')).toEqual([]);
  });
});

describe('clipboardReaderFromItems', () => {
  it('availableFormats 为各条目 types 的并集，read 按格式名取 UTF-8 文本', async () => {
    const reader = clipboardReaderFromItems([
      textItem(['text/uri-list'], 'file:///D:/a.html'),
      textItem(['text/plain'], 'hello'),
    ]);
    await expect(reader.availableFormats()).resolves.toEqual(['text/uri-list', 'text/plain']);
    await expect(reader.read('text/plain')).resolves.toBe('hello');
  });

  it('readBuffer 返回原始字节（FileNameW 形态可完整取回）', async () => {
    const buffer = fileNameWBuffer(['D:\\a\\1.html']);
    const reader = clipboardReaderFromItems([
      { types: ['FileNameW'], getType: () => Promise.resolve(bytesAsBlobLike(buffer)) },
    ]);
    await expect(reader.readBuffer('FileNameW')).resolves.toEqual(buffer);
  });

  it('快照中不存在的格式拒绝（读侧以 availableFormats 前置检查 + try/catch 收敛）', async () => {
    const reader = clipboardReaderFromItems([textItem(['text/plain'], 'x')]);
    await expect(reader.read('text/uri-list')).rejects.toThrow(
      '剪贴板快照中不存在格式 text/uri-list',
    );
  });

  it('空快照：availableFormats 为空数组', async () => {
    const reader = clipboardReaderFromItems([]);
    await expect(reader.availableFormats()).resolves.toEqual([]);
  });
});

describe('readClipboardFilePaths 平台分支', () => {
  it('win32：FileNameW 优先，经 UTF-16LE 解析为路径清单', async () => {
    const reader = makeReader({
      formats: ['FileNameW', 'FileName'],
      buffers: { FileNameW: fileNameWBuffer(['D:\\a\\1.html', 'D:\\a\\2.html']) },
      texts: { FileName: 'D:\\a\\1.html' },
    });
    await expect(readClipboardFilePaths({ platform: 'win32', clipboard: reader })).resolves.toEqual(
      ['D:\\a\\1.html', 'D:\\a\\2.html'],
    );
  });

  it('win32：无 FileNameW 时回退 ANSI FileName（\\0 切分去空）', async () => {
    const reader = makeReader({
      formats: ['FileName'],
      texts: { FileName: 'D:\\a\\1.html\0D:\\a\\2.html\0\0' },
    });
    await expect(readClipboardFilePaths({ platform: 'win32', clipboard: reader })).resolves.toEqual(
      ['D:\\a\\1.html', 'D:\\a\\2.html'],
    );
  });

  it('win32：原始格式缺失时以 text/uri-list 兜底（Electron 44 文件复制统一映射，生产主路径）', async () => {
    const reader = makeReader({
      formats: ['text/uri-list'],
      texts: { 'text/uri-list': 'file:///D:/a/1.html\n' },
    });
    await expect(readClipboardFilePaths({ platform: 'win32', clipboard: reader })).resolves.toEqual(
      [fileURLToPath('file:///D:/a/1.html')],
    );
  });

  it('win32：三种格式全缺返回空数组（剪贴板无文件是正常操作）', async () => {
    const reader = makeReader({ formats: ['text/plain'] });
    await expect(readClipboardFilePaths({ platform: 'win32', clipboard: reader })).resolves.toEqual(
      [],
    );
  });

  it('darwin：public.file-url 优先并经 uri-list 解析', async () => {
    const reader = makeReader({
      formats: ['public.file-url'],
      texts: { 'public.file-url': 'file:///D:/tmp/a.html\n' },
    });
    await expect(
      readClipboardFilePaths({ platform: 'darwin', clipboard: reader }),
    ).resolves.toEqual([fileURLToPath('file:///D:/tmp/a.html')]);
  });

  it('darwin：无 public.file-url 时回退 text/uri-list', async () => {
    const reader = makeReader({
      formats: ['text/uri-list'],
      texts: { 'text/uri-list': 'file:///D:/tmp/a.html\n' },
    });
    await expect(
      readClipboardFilePaths({ platform: 'darwin', clipboard: reader }),
    ).resolves.toEqual([fileURLToPath('file:///D:/tmp/a.html')]);
  });

  it('darwin：两种格式全缺返回空数组', async () => {
    const reader = makeReader({ formats: ['text/plain'] });
    await expect(
      readClipboardFilePaths({ platform: 'darwin', clipboard: reader }),
    ).resolves.toEqual([]);
  });

  it('linux：text/uri-list 为统一约定', async () => {
    const reader = makeReader({
      formats: ['text/uri-list'],
      texts: { 'text/uri-list': 'file:///D:/home/u/a.html\n' },
    });
    await expect(readClipboardFilePaths({ platform: 'linux', clipboard: reader })).resolves.toEqual(
      [fileURLToPath('file:///D:/home/u/a.html')],
    );
  });

  it('linux 及其他平台：无 uri-list 返回空数组', async () => {
    const reader = makeReader({ formats: [] });
    await expect(readClipboardFilePaths({ platform: 'linux', clipboard: reader })).resolves.toEqual(
      [],
    );
    await expect(
      readClipboardFilePaths({ platform: 'freebsd', clipboard: reader }),
    ).resolves.toEqual([]);
  });

  it('收尾去重保持首次出现顺序（多格式重复路径只留一条）', async () => {
    const reader = makeReader({
      formats: ['public.file-url'],
      texts: {
        'public.file-url': 'file:///D:/tmp/a.html\nfile:///D:/tmp/b.html\nfile:///D:/tmp/a.html\n',
      },
    });
    await expect(
      readClipboardFilePaths({ platform: 'darwin', clipboard: reader }),
    ).resolves.toEqual([
      fileURLToPath('file:///D:/tmp/a.html'),
      fileURLToPath('file:///D:/tmp/b.html'),
    ]);
  });

  it('读取面拒绝（快照缺格式等平台异常）：warn 留痕并降级空清单，不向 IPC 层抛错', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reader = makeReader({
        formats: ['FileNameW'],
        // 清单声称有 FileNameW 但字节面缺失：读侧拒绝 → 整体降级空数组
        buffers: {},
      });
      await expect(
        readClipboardFilePaths({ platform: 'win32', clipboard: reader }),
      ).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith('[clipboard] 读取剪贴板文件清单失败', expect.any(Error));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('availableFormats 自身失败（无 X 会话等）：同样 warn 降级空清单', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reader = makeReader({ formatsError: new Error('剪贴板不可用') });
      await expect(
        readClipboardFilePaths({ platform: 'linux', clipboard: reader }),
      ).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith('[clipboard] 读取剪贴板文件清单失败', expect.any(Error));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
