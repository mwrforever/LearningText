// vfs:// handler 全语义（spec §2/§3）：真实库 + Request/Response——
// 200/304/206/416/404/HEAD、CSP 仅 html、CORS 恒发、目录与回收站不可达、损坏行 500
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../src/main/store/db';
import { runMigrations } from '../../../src/main/store/migrate';
import { createVfsService } from '../../../src/main/vfs/vfsService';
import { createVfsProtocolHandler } from '../../../src/main/protocol/vfsProtocol';

let db: Database.Database;
let handler: (request: Request) => Promise<Response>;

const req = (url: string, init?: RequestInit): Request => new Request(url, init);

function requestUrl(pathname: string): string {
  // 固定 host 约定（shared VFS_URL_HOST 同锚）：Blink 空 host 规范化规避，身份形态 vfs://local/…
  return `vfs://local${pathname}`;
}

beforeAll(() => {
  db = openDatabase({ file: ':memory:' });
  runMigrations(db);
  const vfs = createVfsService(db);
  // 尾部 </body> 标记：Task 9 注入矩阵断言「接收器插其前」的锚点（Range 断言切前 10 字节，前缀不受影响）
  const html = `<p>二元指数分布</p></body>`.padEnd(200, ' '); // 拉高 size 供 Range 断言
  vfs.createNode({ parentId: 1, name: '笔记', nodeType: 'dir' });
  vfs.createNode({
    parentId: 2,
    name: 'index.html',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from(html, 'utf8')),
  });
  vfs.createNode({
    parentId: 1,
    name: 'style.css',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from('body{}', 'utf8')),
  });
  vfs.createNode({ parentId: 1, name: '空文件.html', nodeType: 'file' }); // content NULL 形态
  vfs.createNode({
    parentId: 1,
    name: 'pic.png',
    nodeType: 'file',
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG 魔数占位：charset 边界（二进制不加）断言用
  });
  vfs.createNode({
    parentId: 1,
    name: '回收.html',
    nodeType: 'file',
    content: new Uint8Array(Buffer.from('<p>x</p>', 'utf8')),
  });
  const recycled = vfs.resolvePath({ virtualPath: '/回收.html' });
  vfs.trashNode({ nodeId: recycled.nodeId });
  handler = createVfsProtocolHandler({ db });
});

describe('vfs:// handler 响应语义', () => {
  it('活文件 200：text/* MIME 附 charset、二进制原样，ETag/no-cache/CORS 齐，html 带 CSP，css 不带', async () => {
    const res = await handler(req(requestUrl('/style.css')));
    expect(res.status).toBe(200);
    // text/* 附加 charset=utf-8（库内容恒 UTF-8 写入，docs/03 §3.2；终审 M-5）
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toMatch(/^W\/"[0-9a-f]+"$/i);
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(await res.text()).toBe('body{}');
    // charset 仅限 text/*：二进制 MIME 按库内值原样下发（策略边界锚）
    const pngRes = await handler(req(requestUrl('/pic.png')));
    expect(pngRes.headers.get('content-type')).toBe('image/png');
    const htmlRes = await handler(req(requestUrl('/笔记/index.html')));
    expect(htmlRes.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(htmlRes.headers.get('content-security-policy')).toContain('connect-src vfs:');
  });

  it('ETag 命中 → 304 无体、未命中 → 200 正常体（If-None-Match 列表与 * 两形态）', async () => {
    const first = await handler(req(requestUrl('/style.css')));
    const etag = first.headers.get('etag') ?? '';
    const res = await handler(
      req(requestUrl('/style.css'), { headers: { 'If-None-Match': `"x", ${etag}` } }),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
    const any = await handler(req(requestUrl('/style.css'), { headers: { 'If-None-Match': '*' } }));
    expect(any.status).toBe(304);
    // 未命中对照：列表全不匹配当前 ETag → 条件不成立，走 200 正常体（非命中侧显式锚定；
    // 头值须为 Latin-1 ByteString，ETag 实际形态即 ASCII hash，取固定 64 位十六进制）
    const miss = await handler(
      req(requestUrl('/style.css'), { headers: { 'If-None-Match': `"${'0'.repeat(64)}"` } }),
    );
    expect(miss.status).toBe(200);
    expect(await miss.text()).toBe('body{}');
  });

  it('Range 单区间 206 + Content-Range；越界 416 + bytes */size；多区间忽略按 200', async () => {
    const partial = await handler(
      req(requestUrl('/笔记/index.html'), { headers: { Range: 'bytes=0-9' } }),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toMatch(/^bytes 0-9\/\d+$/);
    // 简报笔误：10 字节按 UTF-8 解码坍缩为 6 字符（截断多字节序列→替换符），按真实字节数断言
    expect((await partial.arrayBuffer()).byteLength).toBe(10);
    const bad = await handler(
      req(requestUrl('/style.css'), { headers: { Range: 'bytes=100-200' } }),
    );
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */6');
    expect(await bad.text()).toBe('Range Not Satisfiable'); // 固定短语：不泄露库内信息
    const multi = await handler(
      req(requestUrl('/style.css'), { headers: { Range: 'bytes=0-1,3-4' } }),
    );
    expect(multi.status).toBe(200);
  });

  it('空文件（content NULL 行）200 不抛错：text/html 空体仅注入接收器', async () => {
    const res = await handler(req(requestUrl('/空文件.html')));
    expect(res.status).toBe(200);
    // text/html 200 全量注入接收器（Task 9 裁决 D10）：空体形态响应体 = 仅接收器脚本
    expect(await res.text()).toContain('lt:css-swap');
    // 写路径「无内容文件」落库为空 BLOB（非 NULL）；content NULL 的活行只能直插构造
    // （同损坏行技法），覆盖空体分支的 content 缺失侧（hash 在位 → 非 500）
    db.prepare(
      `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, content_hash, created_at, updated_at)
                VALUES (1, 'file', 'null体.html', '/null体.html', 'text/html', 0, NULL, @hash, @now, @now)`,
    ).run({ hash: 'a'.repeat(64), now: '2026-09-18T10:00:00.000+08:00' });
    const nullBody = await handler(req(requestUrl('/null体.html')));
    expect(nullBody.status).toBe(200);
    // 同上：注入只改响应构造，不触碰 NULL content 行的读路径语义
    expect(await nullBody.text()).toContain('lt:css-swap');
  });

  it('404 矩阵：不存在/目录/回收站/编码越界/host 形态——固定短语无库内信息', async () => {
    for (const url of [
      requestUrl('/无此.html'),
      requestUrl('/笔记'), // 目录
      requestUrl('/回收.html'), // 回收站不可达（spec §2.2-4）
      'vfs://local/%2E%2E/笔记', // %2E%2E 由 URL 解析器解码归一且不越根，结果 /笔记 为目录 → 404（Task 3 裁决 A）
      'vfs://evil/笔记/index.html', // 伪造 host：身份门拒绝（拒绝语义保留）
      'vfs:///笔记/index.html', // 空 host 形态：Node 侧身份门即拒；Blink 发起侧变形（首段提 host）到达同型同拒（Task 8 探针实证锚）
    ]) {
      const res = await handler(req(url));
      expect(res.status).toBe(404);
      // CORS 恒发含错误响应（spec §2.3）：cors 模式 fetch 须能读到 404 状态码的回归锚
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(await res.text()).toBe('Not Found');
    }
  });

  it('字面 ../ 经 Request 构造的标准归一与直连路径同效（浏览器同构行为，无逃逸面）', async () => {
    const viaDot = await handler(req('vfs://local/笔记/../笔记'));
    expect(viaDot.status).toBe(404); // 归一后 '/笔记' 为目录，仍不可达
    const viaDotFile = await handler(req('vfs://local/笔记/../笔记/index.html'));
    expect(viaDotFile.status).toBe(200); // 归一等价 '/笔记/index.html'
  });

  it('HEAD：200 头齐无体（charset 同 200 语义）', async () => {
    const res = await handler(req(requestUrl('/style.css'), { method: 'HEAD' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await res.text()).toBe('');
  });

  it('损坏行（hash 缺失）→ 500 固定短语 + error 日志（spec §8）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      db.prepare(
        `INSERT INTO node (parent_id, node_type, name, virtual_path, mime_type, size, content, created_at, updated_at)
                  VALUES (1, 'file', '坏行.html', '/坏行.html', 'text/html', 3, NULL, @now, @now)`,
      ).run({ now: '2026-09-18T10:00:00.000+08:00' });
      const res = await handler(req(requestUrl('/坏行.html')));
      expect(res.status).toBe(500);
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('handler 内部异常兜底：stmt 抛错 → 500 + error 日志（spec §2.6）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const broken = createVfsProtocolHandler({
        db: {
          prepare: () => {
            throw new Error('stmt 装配失败');
          },
        } as unknown as Database.Database,
      });
      const res = await broken(req(requestUrl('/style.css')));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Internal Server Error'); // 固定短语：不泄露库内信息
      expect(errSpy).toHaveBeenCalledTimes(1); // 与损坏行用例对齐：error 日志恰一次
    } finally {
      errSpy.mockRestore();
    }
  });
});

// 注入矩阵（Task 9，M4 spec §5.4 裁决 D10）：接收器只读注入 text/html 200 全量响应——
// 库内 BLOB 与 content_hash/ETag 一概不参与，「同 hash 不同响应体」由「注入恒定」消解
describe('CSS 热替换接收器注入（M4 spec §5.4 裁决 D10）', () => {
  it('text/html 200 注入接收器且 ETag 与注入无关；304/206/HEAD 与 css 不注入', async () => {
    const htmlRes = await handler(req(requestUrl('/笔记/index.html')));
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('lt:css-swap'); // 接收器标记
    expect(htmlText.toLowerCase().lastIndexOf('</body>')).toBeGreaterThan(
      htmlText.indexOf('lt:css-swap'),
    );
    const etag = htmlRes.headers.get('etag');
    // 304 响应体空、无注入（与 200 同 ETag）
    const notModified = await handler(
      req(requestUrl('/笔记/index.html'), { headers: { 'If-None-Match': etag ?? '' } }),
    );
    expect(await notModified.text()).toBe('');
    // HEAD 无体（无注入可断言体为空）
    const head = await handler(req(requestUrl('/笔记/index.html'), { method: 'HEAD' }));
    expect(await head.text()).toBe('');
    // 206 分片不含接收器（Range 切原体）：206 侧直接断言（Task 9 评审移交收口，
    // 断言不依赖「注入恒定」推理，实取分片体验内容）
    const partial = await handler(
      req(requestUrl('/笔记/index.html'), { headers: { Range: 'bytes=0-9' } }),
    );
    expect(partial.status).toBe(206);
    expect((await partial.text()).includes('lt:css-swap')).toBe(false);
    const cssRes = await handler(req(requestUrl('/style.css')));
    expect((await cssRes.text()).includes('lt:css-swap')).toBe(false);
  });

  it('injectPreviewReceiver：有 </body> 插其前（大小写不敏感取最后一处）；无则尾部追加', async () => {
    const { injectPreviewReceiver } = await import('../../../src/main/protocol/vfsProtocol.ts');
    expect(injectPreviewReceiver('<html><body><p>x</p></body></html>')).toContain(
      '<p>x</p><script',
    );
    expect(injectPreviewReceiver('<html><BODY></BODY></html>')).toContain('<script');
    // 无 body 标记：原内容保持前缀原样、接收器紧随其后尾部追加
    //（brief 原为 endsWith——接收器以闭合标签收尾，「</p><script」位于串中而非串尾，
    // endsWith 恒假；追加语义以 startsWith 锁定，偏差证据见 task-9-report）
    expect(injectPreviewReceiver('<p>无 body</p>').startsWith('<p>无 body</p><script')).toBe(true);
  });
});
