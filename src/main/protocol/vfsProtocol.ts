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
 * 预览接收器 + 显式编辑态桥（M4 spec §5.4 裁决 D10 → M9 批次「交互优先」重构，FR-RENDER-08
 * 2026-09-23 修订版；设计依据 `docs/design/2026-09-23-M9交互蓝图.md` 面 A 含 §1.4 在途实现
 * 对齐）：沙箱子文档注入脚本，职责三段——
 * ① lt:css-swap 热替换（按「href 相对解析 pathname === 消息 path」匹配 <link> 并替换为
 *    等值 <style>，滚动保持；pathname 侧 decodeURIComponent 是硬性必需——WHATWG URL
 *    序列化对非 ASCII 路径恒百分号编码，不解码则 CJK 路径永不命中；解码失败 try/catch
 *    兜底静默跳过）。
 * ② 显式编辑态（M9 批次，推翻 M6「打开即整页 contentEditable」——整页可编辑使用户文档
 *    自带的按钮/脚本交互整体失效，用户实测反馈立项）：父→子 lt:edit-enter / lt:edit-exit
 *    切换（无载荷）；交互态双击文本元素（合格判定：非表单控件/媒体、非空文本、非 html/body；
 *    未命中不干预，文档自身双击行为保留）直接进入编辑态并锁定该元素；编辑态内单击切换目标
 *    （旧目标记账还原、新目标 contenteditable）、单击空白/媒体/表单控件与 Esc 均直接退出
 *    ——双击与 Esc 均在桥内判定（蓝图 §1.4：父窗零 DOM 知识、Esc 零冲突），状态变更经
 *    lt:edit-state {editing} 回执同步父窗工具条（同值回写 bail-out 不成环）。工具条进入
 *    （无指针目标）时以 body 为落笔目标（蓝图 A.5 键盘路径：整页可编辑，元素级目标是
 *    指针便利路径）。事件闸门（capture 阶段）：click/dblclick/submit/dragstart 阻断文档
 *    自身脚本与默认动作（「脚本与链接暂停」的可判定实现），mousedown/mouseup/pointerdown/
 *    pointerup/keydown/keyup 仅阻断传播、不拦默认（光标落点/选区/键入是编辑本体）。
 *    导航闸门最低形态（蓝图 A.3，交互态）：链接点击与表单提交一律 preventDefault 取消
 *    就地导航（标签↔文档绑定与保存管线按 nodeId 记账，就地导航后错配）；同文档锚点
 *    （href 以 # 开头）放行原生滚动不转交；vfs 站内链接经 lt:link-open {href} 交父窗
 *    resolvePath 后开新标签（与树点选同入口），其余静默取消；
 *    脚本式 location.assign/window.open 不在此闸门覆盖面（蓝图 §八 R3 已知边界，主进程
 *    will-frame-navigate 接线登记 TASK.md）。
 *    子→父 lt:doc-edit {html} 逐输入即时上报（spec 批次④修正：原 200ms setTimeout 去抖
 *    在沙箱 iframe 内可被渲染器计时器搁置无限期延迟，上报尾部丢失即保存尾部丢失——每输入
 *    即报，写侧节奏由父窗 SaveController 全权承担）。
 * ③ 序列化 = clone documentElement → 摘除全部 [data-lt-injected]（本桥与高亮样式，永不
 *    落库）→ 无条件清除 data-lt-hover / data-lt-active / 根元素 data-lt-editing（桥自有
 *    标记）→ **按记账还原** contenteditable / spellcheck（(元素, 属性, 原值) 三元组经
 *    data-lt-touched 标记按文档序对位克隆树还原：原值存在则还原原值、不存在才移除——
 *    用户文档自带的 contentEditable 区域不得被误删，蓝图 §1.4 必修项）→ doctype 重建
 *    （name/publicId/systemId）→ outerHTML 拼接（spec §3.2）。M6 起滚动同步退役（spec D5）。
 * 高亮（无过渡，瞬时）由注入的 <style data-lt-injected> 承载：hover 候选 1px 虚线、当前
 * 目标 2px 实线；色值 #64748B = light 档 --ring 现值（theme.css 同源注释）：子文档
 * opaque origin 读不到宿主 CSS 变量，且文档底色不可预知——对白底 4.9:1 / 对 #0F172A 底
 * 3.4:1 双底达标，dark 档 #94A3B8 对白底不达标，故刻意不随主题切换（蓝图 A.2-3，唯一
 * 硬编码色例外）。
 * 注意：字符串内不得出现 </script> 序列（会在宿主页提前闭合标签），闭合标签以
 * `'</' + 'script>'` 拼接形态落地；拼接体的 JS 语法由集成测试以 new Function 编译
 * 守卫兜底，注入/剥离行为由 E2E 真机覆盖。
 * 本桥带 data-lt-injected 标记：既是序列化剥离锚，也是集成测试注入断言锚。
 */
const PREVIEW_RECEIVER =
  '<script data-lt-injected="1">' +
  '(function () {' +
  'var editing = false;var targetEl = null;var hoverEl = null;var styleEl = null;var ledger = new WeakMap();' +
  'var SKIP = { HTML:1, HEAD:1, META:1, TITLE:1, LINK:1, STYLE:1, SCRIPT:1, BASE:1, NOSCRIPT:1, TEMPLATE:1, INPUT:1, TEXTAREA:1, SELECT:1, OPTION:1, OPTGROUP:1, DATALIST:1, IFRAME:1, OBJECT:1, EMBED:1, PARAM:1, TRACK:1, SOURCE:1, MAP:1, BUTTON:1, IMG:1, VIDEO:1, AUDIO:1, CANVAS:1, PICTURE:1, HR:1, BR:1, FIELDSET:1, LEGEND:1, OUTPUT:1, PROGRESS:1, METER:1 };' +
  'var DBL_SKIP = { BUTTON:1, IMG:1, VIDEO:1, AUDIO:1, CANVAS:1, SVG:1 };function ltSkip(el) {var t = el.tagName.toUpperCase();return SKIP[t] === 1;}' +
  'function ltMark(el, attr) {var rec = ledger.get(el);if (rec === undefined) {rec = [];ledger.set(el, rec);el.setAttribute("data-lt-touched", "1");}for (var i = 0; i < rec.length; i++) {if (rec[i].attr === attr) {return;}}rec.push({ attr: attr, had: el.hasAttribute(attr), value: el.getAttribute(attr) });}' +
  'function ltWrite(el, attr, value) {ltMark(el, attr);if (value === null) {el.removeAttribute(attr);} else {el.setAttribute(attr, value);}}' +
  'function ltRestoreEl(el) {var rec = ledger.get(el);if (rec !== undefined) {for (var i = 0; i < rec.length; i++) {if (rec[i].had) {el.setAttribute(rec[i].attr, rec[i].value);} else {el.removeAttribute(rec[i].attr);}}el.removeAttribute("data-lt-touched");ledger.delete(el);}}' +
  'function ltSerialize() {var clone = document.documentElement.cloneNode(true);var injected = clone.querySelectorAll("[data-lt-injected]");for (var i = injected.length - 1; i >= 0; i--) {injected[i].parentNode.removeChild(injected[i]);}var marks = clone.querySelectorAll("[data-lt-hover],[data-lt-active]");for (var m = 0; m < marks.length; m++) {marks[m].removeAttribute("data-lt-hover");marks[m].removeAttribute("data-lt-active");}clone.removeAttribute("data-lt-editing");var liveTouched = document.querySelectorAll("[data-lt-touched]");var cloneTouched = clone.querySelectorAll("[data-lt-touched]");for (var j = 0; j < liveTouched.length && j < cloneTouched.length; j++) {var rec = ledger.get(liveTouched[j]);if (rec !== undefined) {for (var k = 0; k < rec.length; k++) {if (rec[k].had) {cloneTouched[j].setAttribute(rec[k].attr, rec[k].value);} else {cloneTouched[j].removeAttribute(rec[k].attr);}}}cloneTouched[j].removeAttribute("data-lt-touched");}var head = "";var dt = document.doctype;if (dt) {head = "<!DOCTYPE " + dt.name;if (dt.publicId) {head += " PUBLIC \\"" + dt.publicId + "\\"";if (dt.systemId) {head += " \\"" + dt.systemId + "\\"";}} else if (dt.systemId) {head += " SYSTEM \\"" + dt.systemId + "\\"";}head += ">\\n";}return head + clone.outerHTML;}' +
  'function ltReport() {parent.postMessage({ type: "lt:doc-edit", html: ltSerialize() }, "*");}' +
  'function ltReportState() {parent.postMessage({ type: "lt:edit-state", editing: editing }, "*");}' +
  'function setHover(el) {if (hoverEl !== null && hoverEl !== el) {hoverEl.removeAttribute("data-lt-hover");}hoverEl = el;if (hoverEl !== null) {hoverEl.setAttribute("data-lt-hover", "1");}}' +
  'function candidateFrom(node) {var el = node && node.nodeType === 1 ? node : null;while (el !== null && el !== document.documentElement && (ltSkip(el) || el.getAttribute("data-lt-injected") !== null)) {el = el.parentElement;}if (el === null || el === document.documentElement) {return null;}return el;}' +
  'function setTarget(el, x, y) {if (targetEl === el) {return;}if (targetEl !== null) {targetEl.removeEventListener("input", ltReport);ltRestoreEl(targetEl);}targetEl = el;if (targetEl === null) {return;}ltWrite(targetEl, "contenteditable", "true");ltWrite(targetEl, "spellcheck", "false");ltWrite(targetEl, "data-lt-active", "1");targetEl.addEventListener("input", ltReport);targetEl.focus();if (typeof x === "number" && document.caretRangeFromPoint) {var range = document.caretRangeFromPoint(x, y);var sel = window.getSelection();if (range !== null && sel) {sel.removeAllRanges();sel.addRange(range);}}}' +
  'function onOver(e) {if (!editing) {return;}setHover(candidateFrom(e.target));}' +
  'function onGateClick(e) {var el = e.target;if (el === undefined || el === null || el.nodeType !== 1 || el === document.documentElement || el === document.body || ltSkip(el) || el.getAttribute("data-lt-injected") !== null) {exitEdit();return;}setTarget(el, e.clientX, e.clientY);}' +
  'function onGateKey(e) {e.stopPropagation();if (e.key === "Escape") {exitEdit();}}' +
  'function onGateStop(e) {e.stopPropagation();}' +
  'function onGatePrevent(e) {e.stopPropagation();e.preventDefault();}' +
  'function enterEdit() {if (editing) {return;}editing = true;document.documentElement.setAttribute("data-lt-editing", "1");styleEl = document.createElement("style");styleEl.setAttribute("data-lt-injected", "1");styleEl.textContent = "[data-lt-hover]{outline:1px dashed rgba(100,116,139,.6)}[data-lt-active]{outline:2px solid #64748B;outline-offset:1px}";(document.head || document.documentElement).appendChild(styleEl);document.addEventListener("mouseover", onOver, true);document.addEventListener("click", onGateClick, true);document.addEventListener("dblclick", onGatePrevent, true);document.addEventListener("mousedown", onGateStop, true);document.addEventListener("mouseup", onGateStop, true);document.addEventListener("pointerdown", onGateStop, true);document.addEventListener("pointerup", onGateStop, true);document.addEventListener("submit", onGatePrevent, true);document.addEventListener("dragstart", onGatePrevent, true);document.addEventListener("keydown", onGateKey, true);document.addEventListener("keyup", onGateStop, true);setTarget(document.body);ltReportState();}' +
  'function exitEdit() {if (!editing) {return;}editing = false;setTarget(null);setHover(null);document.documentElement.removeAttribute("data-lt-editing");if (styleEl !== null && styleEl.parentNode !== null) {styleEl.parentNode.removeChild(styleEl);}styleEl = null;document.removeEventListener("mouseover", onOver, true);document.removeEventListener("click", onGateClick, true);document.removeEventListener("dblclick", onGatePrevent, true);document.removeEventListener("mousedown", onGateStop, true);document.removeEventListener("mouseup", onGateStop, true);document.removeEventListener("pointerdown", onGateStop, true);document.removeEventListener("pointerup", onGateStop, true);document.removeEventListener("submit", onGatePrevent, true);document.removeEventListener("dragstart", onGatePrevent, true);document.removeEventListener("keydown", onGateKey, true);document.removeEventListener("keyup", onGateStop, true);ltReportState();}' +
  // 交互态导航闸门（最低形态，蓝图 A.3）：链接点击取消就地导航并交父窗（vfs 站内开新标签、
  // 其余静默）；表单提交取消默认动作（JS 提交处理器不受影响，仅拦「导航型提交」）
  'document.addEventListener("click", function (e) {if (editing) {return;}var el = e.target;if (el === undefined || el === null || el.nodeType !== 1) {return;}var a = el.closest("a[href]");if (a === null) {return;}var href = a.getAttribute("href");if (href === null || href === "" || href.charAt(0) === "#") {return;}e.preventDefault();parent.postMessage({ type: "lt:link-open", href: href }, "*");}, true);' +
  'document.addEventListener("submit", function (e) {if (editing) {return;}e.preventDefault();}, true);' +
  'window.addEventListener("message", function (e) {var m = e.data;if (m && m.type === "lt:css-swap" && typeof m.path === "string" && typeof m.text === "string") {var links = document.querySelectorAll(\'link[rel="stylesheet"]\');for (var i = 0; i < links.length; i++) {var href = links[i].getAttribute("href");if (href !== null) {try {if (decodeURIComponent(new URL(href, document.baseURI).pathname) === m.path) {var s = document.createElement("style");s.textContent = m.text;links[i].replaceWith(s);}} catch (_e) {}}}} else if (m && m.type === "lt:edit-enter") {enterEdit();} else if (m && m.type === "lt:edit-exit") {exitEdit();}});' +
  'document.addEventListener("dblclick", function (e) {if (editing) {return;}var el = candidateFrom(e.target);if (el === null || el === document.body) {return;}if (DBL_SKIP[el.tagName]) {return;}if (el.textContent === null || el.textContent.trim() === "") {return;}e.preventDefault();e.stopPropagation();enterEdit();setTarget(el, e.clientX, e.clientY);}, true);' +
  '})();</' +
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
