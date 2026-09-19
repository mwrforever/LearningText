/**
 * vfs:// 协议处理器（M3 spec §2、§8）：VFS 只读资源出口——虚拟路径→活行 BLOB→
 * HTTP 语义 Response（Content-Type/ETag 304/单区间 206/416/CSP/CORS 通配）。
 * 安全基线：只查 node 表无文件系统接触（FR-RENDER-04）；404/416/500 固定短语
 * 不泄露库内信息（B.5-2）；BLOB 读走同步短临界区（A.1-7：用户显式导航非批量路径）。
 * 语句预编译一次复用（A.4-5）。高频 200/304/206 不记日志（spec §2.6）。
 */
import type Database from 'better-sqlite3';
import { etagOf, ifNoneMatch, parseRange, parseVfsUrl, VFS_HTML_CSP } from './vfsParse';

/**
 * 协议行查询形态：只取响应构造所需列（content_hash 为 ETag 来源，spec §2.3 D6）。
 * content 的 backing store 钉为 ArrayBuffer（better-sqlite3 BLOB 读出为独立分配内存，
 * 非 SharedArrayBuffer），以满足 Response BodyInit 的 ArrayBufferView<ArrayBuffer>
 * 型变要求（Node 24 undici 类型），避免逐响应拷贝或断言。
 */
interface VfsRow {
  readonly mime_type: string;
  readonly node_type: string;
  readonly content: Buffer<ArrayBuffer> | null;
  readonly content_hash: string | null;
}

function textResponse(body: string, status: number): Response {
  // spec §2.3 钉死「所有响应」CORS 恒发（含 404/500 错误侧）：cors 模式 fetch 遇无
  // ACAO 响应直接 reject、读不到错误状态码——Task 8 E2E 在 app:// 页面以 cors 模式
  // fetch('vfs://…') 断言 404/200 状态码、opaque origin 沙箱文档区分「不存在/失败」
  // 均硬依赖此头；200/304/206/416 路径经 headers 展开已带，此处补齐 textResponse 缺漏
  return new Response(body, { status, headers: { 'Access-Control-Allow-Origin': '*' } });
}

/**
 * 预览接收器（M4 spec §5.4 裁决 D10）：css 热替换消息入口——监听 lt:css-swap，
 * 按「href 相对解析 pathname === 消息 path」匹配 <link> 并替换为等值 <style>（滚动保持）。
 * 注意：字符串内不得出现 </script> 序列（会在宿主页提前闭合标签），闭合标签以
 * `'</' + 'script>'` 拼接形态落地。pathname 侧 decodeURIComponent 是硬性必需——
 * WHATWG URL 序列化对非 ASCII 路径恒百分号编码（node 探针实证：
 * new URL('vfs://local/笔记/a.css').pathname === '/%E7%AC%94%E8%AE%B0/a.css'），
 * 而触发端（PreviewPanel）postMessage 的 path 为库内原始 virtualPath，不解码则
 * CJK 路径永不命中（本项目主要场景）；解码失败由既有 try/catch 兜底静默跳过。
 */
const PREVIEW_RECEIVER =
  '<script>(function(){window.addEventListener("message",function(e){var m=e.data;' +
  'if(m&&m.type==="lt:css-swap"&&typeof m.path==="string"&&typeof m.text==="string"){var links=document.querySelectorAll(\'link[rel="stylesheet"]\');' +
  'for(var i=0;i<links.length;i++){var href=links[i].getAttribute("href");if(href!==null){try{' +
  'if(decodeURIComponent(new URL(href,document.baseURI).pathname)===m.path){var s=document.createElement("style");s.textContent=m.text;links[i].replaceWith(s);}}catch(_e){}}}}});})();</' +
  'script>';

/**
 * 接收器只读注入（纯函数）：最后一个 </body>（大小写不敏感）前插入；无 body 标记尾部追加。
 * @param htmlBody 文档 BLOB 按 UTF-8 解码出的原始 HTML 文本（text/html 200 全量响应体）
 * @returns 注入接收器后的响应体文本（恒定输出：同输入恒同输出，消解「同 hash 不同体」）
 */
export function injectPreviewReceiver(htmlBody: string): string {
  const idx = htmlBody.toLowerCase().lastIndexOf('</body>');
  return idx === -1
    ? htmlBody + PREVIEW_RECEIVER
    : htmlBody.slice(0, idx) + PREVIEW_RECEIVER + htmlBody.slice(idx);
}

export function createVfsProtocolHandler(deps: {
  db: Database.Database;
}): (request: Request) => Promise<Response> {
  // 行查询语句惰性预编译、仅此一次复用（A.4-5「一次创建、全程复用」语义）：
  // 首个请求时 prepare 并缓存。装配点收敛在请求期是两处消费方共同钉死的裁决——
  // ① 语句构建失败（stmt 抛错）属 handler 意外异常兜底语义（spec §2.6），必须在
  //    请求期暴露为 500 + error 日志，而非工厂调用期直接抛出；
  // ② app.ts 装配仅传句柄建 handler（装配单测的开库桩无 prepare），工厂自身不触库，
  //    挂载顺序（开库→迁移→协议注册→建窗）不受语句装配时点影响。
  let stmtVfsRow: Database.Statement<string[], VfsRow> | undefined;

  /** 响应构造主体（异常由外层包装兜底记 error，spec §2.6） */
  function handle(request: Request): Promise<Response> {
    const target = parseVfsUrl(request.url);
    if (target.kind === 'invalid') return Promise.resolve(textResponse('Not Found', 404));
    const stmt = (stmtVfsRow ??= deps.db.prepare<string[], VfsRow>(
      `SELECT mime_type, node_type, content, content_hash FROM node
       WHERE virtual_path = ? AND deleted_at IS NULL`,
    ));
    const row = stmt.get(target.virtualPath);
    // 目录与回收站行不可达：deleted_at 过滤在 SQL、目录在行型判定，同返 404（spec §2.2-4）
    if (row === undefined || row.node_type !== 'file') {
      return Promise.resolve(textResponse('Not Found', 404));
    }
    // file 行 content_hash 由 createNode/writeFile 写路径恒维护（M1 不变式）；
    // null 属手工损坏形态：记 error 返 500（不猜内容、集成用例直插构造覆盖）
    if (row.content_hash === null) {
      console.error(`[vfs] 行 content_hash 缺失（损坏形态）path=${target.virtualPath}`);
      return Promise.resolve(textResponse('Internal Server Error', 500));
    }
    const body = row.content ?? Buffer.alloc(0); // 空文件 content NULL 形态 → 空体（200 合法）
    const etag = etagOf(row.content_hash);
    // text/* 附加 charset=utf-8（库内容恒 UTF-8 写入，docs/03 §3.2；终审 M-5 修非 ASCII 乱码）。
    // 仅改响应头：库内 BLOB、content_hash/ETag 一概不参与，304 命中不受影响
    const contentType = row.mime_type.startsWith('text/')
      ? `${row.mime_type}; charset=utf-8`
      : row.mime_type;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      ETag: etag,
      'Cache-Control': 'no-cache',
      // opaque origin 沙箱文档的 fetch 带 Origin: null 走 CORS（spec §2.3）；无凭据请求通配无泄露面
      'Access-Control-Allow-Origin': '*',
    };
    if (row.mime_type === 'text/html') headers['Content-Security-Policy'] = VFS_HTML_CSP;
    if (ifNoneMatch(request.headers.get('if-none-match'), etag)) {
      return Promise.resolve(new Response(null, { status: 304, headers }));
    }
    if (request.method === 'HEAD') {
      return Promise.resolve(new Response(null, { status: 200, headers }));
    }
    const range = parseRange(request.headers.get('range'), body.length);
    if (range.kind === 'unsatisfiable') {
      return Promise.resolve(
        new Response('Range Not Satisfiable', {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${String(body.length)}` },
        }),
      );
    }
    if (range.kind === 'partial') {
      return Promise.resolve(
        new Response(body.subarray(range.start, range.end + 1), {
          status: 206,
          headers: {
            ...headers,
            'Content-Range': `bytes ${String(range.start)}-${String(range.end)}/${String(body.length)}`,
            'Accept-Ranges': 'bytes',
          },
        }),
      );
    }
    // text/html 200 全量注入接收器（响应构造期，不改库内 BLOB、不参与 content_hash/ETag——裁决 D10）
    const responseBody =
      row.mime_type === 'text/html'
        ? Buffer.from(injectPreviewReceiver(body.toString('utf8')), 'utf8')
        : body;
    return Promise.resolve(new Response(responseBody, { status: 200, headers }));
  }

  return (request: Request): Promise<Response> => {
    try {
      return handle(request);
    } catch (e: unknown) {
      // 数据库层意外异常（损坏库/约束）：error 日志 + 500 固定短语（spec §2.6/§8）
      console.error('[vfs] 请求处理异常', e);
      return Promise.resolve(textResponse('Internal Server Error', 500));
    }
  };
}
