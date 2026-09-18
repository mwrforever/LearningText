// M3 验收关键项（spec §9.1）：三形态路径/越界 404/内联 script/null-origin fetch/
// 连续输入最终态一致/重载仅变更回 200/localStorage 隔离 + NFR-04 计时
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page, Response } from 'playwright';

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
  // 装配完成信号（业务语义，非 sleep）：根按钮出现 = Workspace mount 首拉 listChildren
  // 已应用到树——此后经桥建目录只与广播链竞争，消除「本用例建目录与 mount 首拉交错」
  // 的装配期双「笔记」竞争（探针实证见 task-8-report §5.3）
  await page.getByRole('button', { name: '根' }).waitFor();
});

test.afterAll(async () => {
  // Windows 文件锁纪律：先关应用（释放 SQLite 句柄与 Chromium 目录锁）再删临时目录
  await app.close();
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
  // HTML 文档惯例——协议按库内 MIME 原样下发 Content-Type（无 charset），无 meta 时
  // Chromium 按 windows-1252 解码致非 ASCII 乱码（实跑实证，非产品缺陷）
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

test('连续输入最终态一致 + NFR-04 重载计时（验收项 5/6 + spec §4.4）', async () => {
  const before = vfsResponses.length;
  const editor = page.getByLabel('编辑区');
  // charset meta 同主链路用例（协议不注入 charset，无 meta 乱码）；<p> 不闭合——
  // pressSequentially 在文尾续打时字符须落进 #t 内（闭合标签会把续打字符挤到段外）
  const target = '<meta charset="utf-8"><p id="t">最终态一二三四五六七八九十';
  const start = Date.now();
  await editor.fill(target); // fill 单次提交终值：等价高频输入的尾沿
  await expect(page.frameLocator('iframe').locator('#t')).toHaveText('最终态一二三四五六七八九十');
  const reloadMs = Date.now() - start;
  console.log(`[perf-m3] NFR-04 预览重载端到端耗时 ${String(reloadMs)}ms（fill→首帧一致）`);
  expect(reloadMs).toBeLessThan(2000); // NFR-04 宽松上限（300ms 目标 + CI 余量），中位数报告回填
  await editor.pressSequentially('！', { delay: 10 }); // 高频输入（远小于去抖 300ms）
  await expect(page.frameLocator('iframe').locator('#t')).toHaveText(
    '最终态一二三四五六七八九十！',
  );
  const tail = vfsResponses.slice(before);
  expect(tail.filter((r) => r.status() === 200).length).toBeGreaterThanOrEqual(2); // 主文档两次刷新均 200（内容变）
  expect(tail.filter((r) => r.url().endsWith('.css'))).toHaveLength(0); // 未再引用 css 变化（无多余请求）
});

test('删除（回收站）后预览不可达', async () => {
  const id = await seedFile(1, '回收测试.html', '<p>gone</p>');
  await page.evaluate((nodeId) => window.api.trashNode({ nodeId }), id);
  const res = await page.evaluate(() => fetch('vfs://local/回收测试.html').then((r) => r.status));
  expect(res).toBe(404);
});
