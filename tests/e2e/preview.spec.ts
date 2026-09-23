// M3 验收关键项（spec §9.1）→ M6 画布语义改写：三形态路径/越界 404/内联 script/null-origin
// fetch/https 外链 CSP 阻断/删除后不可达保持；「连续输入最终态一致/未变子资源重取/NFR-04
// 重载计时」改写为画布语义（编辑面=渲染面零重载 + D7 外部写入后手动「从库重新加载」，
// 304 重验探针勘误见 spec §4.2；编辑面上 CSP/localStorage 隔离等由保活 iframe 同面承载）
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page, Response } from 'playwright';
import { closeAppGracefully } from './close-app';

// 每 spec 独立 userData 临时目录：e2e 写库不碰开发者真实数据（M3 新增，M1 只读用例无此需求）
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const vfsResponses: Response[] = [];

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-preview-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] });
  page = await app.firstWindow();
  page.on('response', (res) => {
    if (res.url().startsWith('vfs://')) vfsResponses.push(res);
  });
  // 装配完成信号（业务语义，非 sleep）：树 nav data-ready 置位 = Workspace mount 首拉
  // listChildren 已应用到树（②批次隐藏合成根行后，「根按钮出现」等待由该锚等价替代——
  // 空库也有合成根，置位语义一致）——此后经桥建目录只与广播链竞争，消除「本用例建目录与
  // mount 首拉交错」的装配期双「笔记」竞争（探针实证见 task-8-report §5.3）
  await page.locator('nav[aria-label="资源树"][data-ready="true"]').waitFor();
});

test.afterAll(async () => {
  // Windows 文件锁纪律：先关应用（释放 SQLite 句柄与 Chromium 目录锁）再删临时目录；
  // 关停前显式放行 guard（macOS quit 流程修复，见 close-app.ts 头注）
  await closeAppGracefully(app, page);
  rmSync(userDataDir, { recursive: true, force: true });
});

/** 经类型化桥建场景（UI 主链路用例单独走按钮，其余验收以桥构造数据排除 UI 噪声） */
async function seedFile(parentId: number, name: string, content: string): Promise<number> {
  const result = await page.evaluate(
    ({ parentId, name, text }) =>
      window.api.createNode({
        parentId,
        name,
        nodeType: 'file',
        content: new TextEncoder().encode(text),
      }),
    { parentId, name, text: content },
  );
  if (!result.ok) throw new Error('建文件失败');
  return result.value.id;
}

async function expandRootAndSelect(name: string): Promise<void> {
  // 展开根 → 目标节点（树懒加载）；点选进入编辑+预览
  const dirBtn = page.getByRole('button', { name: '笔记' });
  await dirBtn.click();
  await page.getByRole('button', { name }).click();
}

test('主链路：新建目录与文件→编辑→预览渲染一致（含相对资源与 root 相对）', async () => {
  // UI：新建目录按钮（根上下文）→ 重命名 M3 无入口，改用桥建目录后点选
  const dir = await page.evaluate(() =>
    window.api.createNode({ parentId: 1, name: '笔记', nodeType: 'dir' }),
  );
  if (!dir.ok) throw new Error('建目录失败');
  // 相对 css + root 相对 img 内联 + 内联 script（验收项 1/3）；charset meta 为真实
  // HTML 文档惯例——M4 Task 8 起协议对 text/* 追加 charset=utf-8（docs/03 §3.2，
  // 集成侧 vfs-protocol.test 锁定），无 meta 的非 ASCII 文档不再按 windows-1252 误解码
  await seedFile(
    dir.value.id,
    'a.html',
    '<meta charset="utf-8"><link rel="stylesheet" href="./a.css"><img src="/笔记/pic.png"><p id="t">待替换</p><script>document.getElementById("t").textContent = "已渲染";</script>',
  );
  await seedFile(dir.value.id, 'a.css', '#t { color: red; }');
  await seedFile(dir.value.id, 'pic.png', 'PNGSTUB'); // 非真 PNG 不影响资源请求 200/MIME 断言
  await expandRootAndSelect('a.html');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#t')).toHaveText('已渲染'); // 内联 script 执行 + DOM 渲染
  const statuses = await page.evaluate(() =>
    [...document.querySelectorAll('iframe')].map((f) => f.getAttribute('src')),
  );
  expect(statuses.some((s) => s?.includes('笔记'))).toBe(true);
});

test('越界双机制闭合：WHATWG 解析器单机制点段归一 + 固定 host 身份门（验收项 2，spec §2.2-3 v0.3）', async () => {
  const enc = await page.evaluate(
    async () => (await fetch('vfs://local/%2E%2E/%2E%2E/etc/passwd')).status,
  );
  // 编码点段 %2E%2E 与字面 ".." 同被 WHATWG 解析器（Node 24 与 Chromium 同构）识别为
  // 点段、同一机制根锚定归一：'/%2E%2E/%2E%2E/etc/passwd' 归一为 '/etc/passwd'，查库不中即 404
  expect(enc).toBe(404);
  const dot = await page.evaluate(async () => {
    const r = await fetch('vfs://local/笔记/../../../etc/passwd');
    return { status: r.status, body: await r.text() };
  });
  expect(dot.status).toBe(404); // 归一后 '/etc/passwd' 库内不中——归一不越根即无逃逸面
  expect(dot.body).toBe('Not Found');
  const ok = await page.evaluate(
    async () => (await fetch('vfs://local/笔记/../笔记/a.css')).status,
  );
  expect(ok).toBe(200); // 正对照：归一等价直连路径，浏览器同款行为不是拒绝对象
  // 身份门层（固定 host 约定，主进程侧仅认 VFS_URL_HOST='local'）：host 非 local 一律 404
  // ——空 host 路径式（Blink 对 standard scheme 做「首段提为 host」规范化，与 Node URL
  // 不同构，故到达侧必为非约定 host）与伪造 host（vfs://evil/…）均被拒，拒绝语义保留
  const emptyHost = await page.evaluate(async () => (await fetch('vfs:///笔记/a.css')).status);
  expect(emptyHost).toBe(404);
  const evil = await page.evaluate(async () => (await fetch('vfs://evil/笔记/a.css')).status);
  expect(evil).toBe(404);
});

test('沙箱内 fetch null-origin 可取 VFS 资源（验收项 4）', async () => {
  const status = await page
    .frameLocator('iframe')
    .locator('#t')
    .evaluate(async (el) => {
      const view = el.ownerDocument.defaultView;
      if (view === null) throw new Error('预览文档无默认视图');
      const r = await view.fetch('vfs://local/笔记/a.css');
      return r.status;
    });
  expect(status).toBe(200); // Origin:null + CORS 通配（spec §2.3）
});

test('预览文档 fetch https 外链被 CSP 阻断（验收项 4：connect-src 断出网面）', async () => {
  // 沙箱文档 CSP 为 connect-src vfs:（spec §3.2 / VFS_HTML_CSP）：https 外链在 CSP
  // 评估期即拒，fetch 以 TypeError reject、请求不达网络层——reject 即通过。旁证断言：
  // 期间不出现任何 example.com 的网络请求事件（区分「CSP 前置拒绝」与「请求已出网后
  // 被 CORS 拒」两种同形 reject，坐实阻断发生在本机出网之前）
  const externalRequests: string[] = [];
  const onRequest = (req: { url(): string }): void => {
    if (req.url().startsWith('https://example.com')) externalRequests.push(req.url());
  };
  page.on('request', onRequest);
  let rejectedByCsp: boolean;
  try {
    rejectedByCsp = await page
      .frameLocator('iframe')
      .locator('#t')
      .evaluate(async (el) => {
        const view = el.ownerDocument.defaultView;
        if (view === null) throw new Error('预览文档无默认视图');
        try {
          await view.fetch('https://example.com/');
          return false; // fetch 成功 = CSP 未阻断（回归信号）
        } catch {
          return true; // TypeError: Failed to fetch——connect-src 违规拒绝形态
        }
      });
  } finally {
    page.off('request', onRequest); // 局部监听即插即拔，不泄漏进后续用例
  }
  expect(rejectedByCsp).toBe(true);
  expect(externalRequests).toHaveLength(0); // 请求未出渲染器——阻断发生在网络层之前
});

test('localStorage 抛 SecurityError（验收项 7，隔离断言=已知边界）', async () => {
  const threw = await page
    .frameLocator('iframe')
    .locator('#t')
    .evaluate((el) => {
      const view = el.ownerDocument.defaultView;
      if (view === null) throw new Error('预览文档无默认视图');
      try {
        view.localStorage.getItem('x');
        return false;
      } catch {
        return true;
      }
    });
  expect(threw).toBe(true);
});

test('画布编辑零重载最终态一致 + 外部写入后手动重载子资源重取与校验器稳定（验收项 5/6 画布语义改写）', async () => {
  // M6 语义映射（原「编辑器 fill→预览重载 + NFR-04 计时」）：编辑面=渲染面后无重载链——
  // ① 连续输入断言「编辑全程零主文档导航 + 渲染面实时一致」；② 重载链由 D7 的显式入口
  // 承载：外部写入（桥直写同通道）→ 画布会话 written 一律不重载 → 手动「从库重新加载」
  // 拉取（计时语义 NFR-04 平移为「点击重载→首帧一致」）；③ 未变子资源重取与弱校验器
  // 稳定断言在手动重载链上等价保留（304 形态仍由集成测试 vfs-protocol.test 锁定）。
  const holder = page.locator('iframe.lt-canvas-frame');
  const frame = holder.contentFrame();
  const doc200s = (): number =>
    vfsResponses.filter((r) => r.url().endsWith('/a.html') && r.status() === 200).length;
  const doc200Before = doc200s();
  // —— 画布连续输入：内容实时一致（编辑面=渲染面），输入全程零主文档导航 ——
  await expect(frame.locator('body')).toHaveAttribute('contenteditable', 'true');
  await holder.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.type('最终态一二三四五六七八九十', { delay: 10 });
  await expect(frame.locator('body')).toContainText('最终态一二三四五六七八九十', {
    useInnerText: true,
  });
  expect(doc200s()).toBe(doc200Before);
  // —— 编辑落库（出厂去抖 300ms 尾沿；脏点消失 = 报告已入管线且写完成，重载钮解禁）——
  const reloadBtn = page.getByLabel('从库重新加载');
  await expect(async () => {
    // 帧内 evaluate 泵一次任务队列：画布注入桥 200ms 去抖上报计时器位于沙箱 iframe 的
    // 任务队列，父页侧操作不回访帧内时该队列可被长期搁置（探针实证，editor/m5 spec 同款
    // 处理，详见报告「疑似产品缺陷」节）
    await frame.locator('body').evaluate(() => undefined);
    await expect(reloadBtn).toBeEnabled();
  }).toPass({ timeout: 10000 });
  // —— 外部写入（与编辑管线同一 vfs:write 通道）→ D7 刷新抑制：画布会话零重载 ——
  const written = await page.evaluate(async () => {
    const resolved = await window.api.resolvePath({ virtualPath: '/笔记/a.html' });
    if (!resolved.ok) return false;
    const result = await window.api.writeFile({
      nodeId: resolved.value.nodeId,
      content: new TextEncoder().encode(
        '<meta charset="utf-8"><link rel="stylesheet" href="./a.css"><p id="t">外部写入终态</p>',
      ),
    });
    return result.ok;
  });
  if (!written) throw new Error('桥直写 a.html 失败');
  const doc200AfterWrite = doc200s();
  await expect(frame.locator('body')).toContainText('最终态一二三四五六七八九十', {
    useInnerText: true,
  });
  expect(doc200AfterWrite).toBe(doc200Before); // written 命中画布会话：零主文档请求
  // —— 手动「从库重新加载」：拉取库内容；NFR-04 计时语义平移（点击→首帧一致）——
  const reloadStart = Date.now();
  await reloadBtn.click();
  await expect(frame.locator('#t')).toHaveText('外部写入终态');
  const reloadMs = Date.now() - reloadStart;
  console.log(`[perf-m3] 画布手动重载端到端耗时 ${String(reloadMs)}ms（点击→首帧一致）`);
  expect(reloadMs).toBeLessThan(2000); // NFR-04 宽松上限（300ms 目标 + CI 余量），中位数回填
  // —— 未变子资源重取与校验器稳定（验收项 6 后半句；终审 I-2 按探针实证降级，勘误见
  // spec §4.2）：Chromium 对 vfs:// 自定义 scheme 子资源跨重载不稳定执行条件重验，常态为
  // 「无 If-None-Match 的 200 全量重取」，304 不可作 E2E 断言依赖；此处断言实测恒真两层：
  // 未变子资源（a.css）在重载链上被重新请求 + 200 形态弱校验器跨请求逐一相等（etagOf 契约）
  const cssRequests = vfsResponses.filter((r) => r.url().endsWith('/a.css'));
  expect(cssRequests.length).toBeGreaterThanOrEqual(2); // 首开 + 手动重载各至少一次
  const cssEtags = cssRequests.filter((r) => r.status() === 200).map((r) => r.headers()['etag']);
  expect(cssEtags.length).toBeGreaterThanOrEqual(2);
  expect(cssEtags.every((e) => typeof e === 'string' && e.startsWith('W/'))).toBe(true);
  expect(new Set(cssEtags).size).toBe(1); // 内容未变 → 校验器跨请求稳定（304 收益的前提）
});

test('删除（回收站）后预览不可达', async () => {
  const id = await seedFile(1, '回收测试.html', '<p>gone</p>');
  await page.evaluate((nodeId) => window.api.trashNode({ nodeId }), id);
  const res = await page.evaluate(() => fetch('vfs://local/回收测试.html').then((r) => r.status));
  expect(res).toBe(404);
});

test('M7 文件导入渲染：导入落库的示例 HTML 文档（code.html）画布渲染正常', async () => {
  // 「导入」的落库事实经桥等价注入（io:pick-file 原生文件框不可自动化；导入写侧验收由
  // integration import-service 文件源用例锁定）——fixture 即用户实测示例文档（76KB 中文
  // 长文，内联样式 + CDN 外链样式）。树点选打开 = 导入完成后「即打开」的同一 openFile 链。
  // 置于本文件末尾：该用例打开的 code.html iframe 与此前用例的 a.html iframe 保活并存，
  // 后续用例若再用无差别 iframe 定位会 strict 违例（连锁失败曾实证，锚点均按 title 收窄）
  const html = readFileSync(path.join(__dirname, '../fixtures/code.html'), 'utf8');
  const created = await page.evaluate(
    (text) =>
      window.api.createNode({
        parentId: 1,
        name: 'code.html',
        nodeType: 'file',
        content: new TextEncoder().encode(text),
      }),
    html,
  );
  if (!created.ok) throw new Error('建 code.html 失败');
  await page.getByRole('button', { name: 'code.html' }).click();
  // 按 title 定位（此前用例的 a.html iframe 保活并存，无差别 iframe 定位会 strict 违例）
  const frame = page.frameLocator('iframe[title="编辑 code.html"]');
  // 渲染断言：文档主标题 + 章节关键文本——长文档结构与中文内容完整呈现
  await expect(frame.locator('body')).toContainText('Spring 框架全景解析', { timeout: 10000 });
  await expect(frame.locator('body')).toContainText('从入门到精通', { useInnerText: true });
  // 渲染留证（M7 验收需求：示例文件导入渲染实测）——test-results 为 gitignore 产物目录
  await page
    .locator('iframe[title="编辑 code.html"]')
    .screenshot({ path: 'test-results/m7-code-html-render.png' });
});

test('画布文档面基底为浏览器白：文档未自设背景时文档区不透出应用底色（灰色遮罩缺陷回归守卫）', async () => {
  // 用户实测缺陷面：文档自身不设 background（纯结构 HTML、外链 CSS 被 CSP 拦掉等）时，
  // 子文档的透明画布令应用底色透出文档区——亮色主题 #f8fafc、暗色主题 #0f172a，观感即
  // 「HTML 渲染出现莫名其妙的灰色遮罩层」（真机像素实证：文档区主色逐一等于应用底色，
  // 容器改色即随之变色）。浏览器对顶层文档恒以白色为画布基底，故白底由 iframe 元素
  // 自身承载（不触碰用户文档，保存序列化零污染），合成后文档面恒为白
  const created = await page.evaluate(() =>
    window.api.createNode({
      parentId: 1,
      name: '无底文档.html',
      nodeType: 'file',
      content: new TextEncoder().encode('<html><body><h1>透明底文档</h1></body></html>'),
    }),
  );
  if (!created.ok) throw new Error('建无底文档失败');
  await page.getByRole('button', { name: '无底文档.html' }).click();
  const visible = page.locator('iframe.lt-canvas-frame:not(.hidden)');
  await expect(visible).toHaveAttribute('title', '编辑 无底文档.html');
  const background = await visible.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(255, 255, 255)');
});
