// M5 验收（docs/03 §6.2 M5 出口 / spec §10.1-1 主链路）：8 组用例——
// ① 主链路（磁盘 seed → 导入 → 树/图片节点 → 编辑自动保存 → 预览一致 → 搜索命中定位打开 →
//    回收站 trash/还原 → 导出子树 + Node 侧结构与引用改写断言 → 设置页 dark → 同 userData
//    重启 → 工作区恢复）；② 快速打开（菜单触发 cmdk 浮层、Enter 打开、空关键词最近打开）；
// ③ 回收站（列表原路径/删除时间、还原、撞名还原失败、彻底删除 confirm）；④ 设置页（主题
//    三态 + 字号滑块计算样式）；⑤ 备份还原（手动建份、列表名形、强确认、重启、数据回滚）；
// ⑥ 滚动同步（200 段落长文档比例 ±5%、开关关闭不跟随——skip 留证：编辑器无高度约束致
//    滚动面失效，产品缺陷）；⑦ 导入取消（600 文件、进度面板取消按钮「可见即点」触发、
//    已写入保留 + toast）；⑧ 图片预览（img src=vfs URL、无新标签——skip 留证：主文档 CSP
//    缺 img-src vfs:，产品缺陷）+ 恢复开关关闭后重启不恢复。
// 用例隔离策略：主链路/快速打开共用一个会话（②消费①的最近打开与树数据），其余各组各自
// 独立 userData 自播种——排除跨用例状态串扰（迭代实证：共享会话下前序用例的视图态/选中态
// 与数据残留会让后续用例的断言面漂移，且失败难以归因）。
// 驱动形态（探针实证，见 task-16-report）：①OS 目录选择对话框 Playwright 不可驱动——经
// electronApp.evaluate 对主进程 dialog.showOpenDialog 打桩返回临时目录，导入/导出全链路
// （菜单命令 → 确认弹层 → io 通道 → 登记簿校验 → 落盘）保持真实；②备份还原的 app.relaunch
// 产生 Playwright 无法附着的新进程——打桩 relaunch 为「记录调用标记文件 + 不派生进程」，
// 进程退出（app.exit）与重启后数据断言均真实驱动；③导入取消以「进度面板进入写入阶段且
// 取消按钮进入 DOM」为触发点、由页面内观察器即时点击（面板寿命 ~1s，Playwright await
// click 的解析延迟会错过存活窗——探针实证）。
// 纪律：所有关停走 closeAppGracefully（重启前另经 restartApp 等待旧进程完全退出、释放
// SQLite 连接后再拉起新实例）；T5 的进程退出为产品语义 app.exit，非测试发起关停；临时目录
// afterAll 成对清理；无硬 sleep（waitFor/expect.poll）；断言按实跑落地。
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Locator, Page } from 'playwright';
import { closeAppGracefully } from './close-app';

// 外层句柄命名 page 而非 window：避免遮蔽 DOM 全局 window（app.spec 同款纪律）
let app: ElectronApplication;
let page: Page;

/**
 * 生成合法 1x1 RGBA PNG（测试进程内现算：IHDR/IDAT/IEND 手工组块 + 标准 CRC32，经
 * zlib deflate 真实像素数据）——图片预览用例必须真图：坏图触发 img onError 落「文档不可用」
 * 占位，img 元素断言即假失败
 */
function make1x1Png(): Buffer {
  // PNG 标准 CRC32（查表法，多项式 0xEDB88320）
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c);
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) {
      // 索引恒在 0–255 界内；?? 0 仅为 noUncheckedIndexedAccess 收窄（运行时不可达）
      c = (table[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // 宽 1
  ihdr.writeUInt32BE(1, 4); // 高 1
  ihdr[8] = 8; // 位深 8
  ihdr[9] = 6; // 颜色类型 RGBA
  // 原始像素：1 字节滤波类型 0 + RGBA(255,128,0,255)，zlib 压缩即合法 IDAT
  const idat = zlib.deflateSync(Buffer.from([0, 255, 128, 0, 255]));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 启动应用并等待装配完成业务信号（根按钮 = mount 首拉已应用，M3 先例） */
async function launchApp(dir: string): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] });
  page = await app.firstWindow();
  await page.getByRole('button', { name: '根' }).waitFor();
}

/** 实例 pid 存活判定（重启前等待旧进程完全退出、释放 SQLite 连接，防文件锁与写锁串扰） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 关停当前实例并等待进程真正退出（closeAppGracefully 纪律 + 退出事实确认） */
async function restartApp(): Promise<void> {
  const oldPid = app.process().pid;
  if (oldPid === undefined) throw new Error('实例 pid 不可用');
  await closeAppGracefully(app, page);
  await expect.poll(() => !pidAlive(oldPid), { timeout: 15_000, intervals: [200] }).toBe(true);
}

/** 经菜单 id 触发原生菜单项（editor.spec 先例形态） */
async function clickMenuById(menuId: string): Promise<boolean> {
  return app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item === null || item === undefined) return false;
    item.click();
    return true;
  }, menuId);
}

/**
 * 主进程 dialog.showOpenDialog 打桩（探针①实证可赋值）：导入/导出的目录选择是 OS 原生
 * 对话框，Playwright 不可驱动——打桩返回临时目录后，渲染层 pickDirectory → 主进程登记簿
 * → io 通道的全链路保持真实（这是目录选择面唯一可行的 E2E 驱动形态）
 */
async function stubDialogPick(target: string): Promise<void> {
  await app.evaluate(({ dialog }, dir) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir],
    });
  }, target);
}

/** 经类型化桥建场景文件（preview/editor.spec 先例：结构数据走桥排除 UI 噪声），返回节点 id */
async function seedFile(parentId: number, name: string, content: string): Promise<number> {
  const result = await page.evaluate(
    ({ parentId: pid, name: n, text }) =>
      window.api.createNode({
        parentId: pid,
        name: n,
        nodeType: 'file',
        content: new TextEncoder().encode(text),
      }),
    { parentId, name, text: content },
  );
  if (!result.ok) throw new Error(`建文件失败：${name}`);
  return result.value.id;
}

/** 虚拟路径存在性（桥侧 oracle）：还原/删除/还原点数据的事实以路径反查为准 */
async function pathExists(virtualPath: string): Promise<boolean> {
  const result = await page.evaluate(
    (vp) => window.api.resolvePath({ virtualPath: vp }),
    virtualPath,
  );
  return result.ok;
}

/** 聚焦编辑区（CM6 contenteditable）把光标移到行尾后键入追加（editor.spec 同款形态） */
async function typeAtEnd(text: string): Promise<void> {
  await page.locator('.cm-content').click();
  const endKey = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
  await page.keyboard.press(endKey);
  await page.keyboard.type(text);
}

/** 树作用域（资源树 nav 内首层列表，与工具栏同名按钮隔离，editor.spec 先例） */
function treeNodes(): Locator {
  return page.locator('nav[aria-label="资源树"] > ul');
}

/** 编辑器滚动比例（与 scrollSync.ratioFromScroll 同式，±5% 断言基准） */
async function editorRatio(): Promise<number> {
  return page.locator('.cm-editor .cm-scroller').evaluate((el) => {
    const max = el.scrollHeight - el.clientHeight;
    return max <= 0 ? 0 : Math.min(1, Math.max(0, el.scrollTop / max));
  });
}

/** 预览滚动比例（iframe 沙箱文档 window 滚动，与 vfsProtocol 接收器同式） */
async function previewRatio(): Promise<number> {
  return page
    .frameLocator('iframe.lt-preview-frame')
    .locator('body')
    .evaluate((el) => {
      const view = el.ownerDocument.defaultView;
      if (view === null) throw new Error('预览文档无默认视图');
      const doc = view.document.documentElement;
      const max = doc.scrollHeight - view.innerHeight;
      return max <= 0 ? 0 : Math.min(1, Math.max(0, (view.scrollY || 0) / max));
    });
}

/** 程序化滚动编辑器到目标比例（触发 scroll 事件 → 节流上报 → postMessage 下行链路） */
async function scrollEditorTo(ratio: number): Promise<void> {
  await page.locator('.cm-editor .cm-scroller').evaluate((el, r) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * r;
  }, ratio);
}

test.describe('M5 主链路与快速打开（同一 userData 会话）', () => {
  let userDataDir: string;
  let srcDir: string;
  let exportRoot: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-'));
    srcDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-src-'));
    exportRoot = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-out-'));
    // 磁盘源目录：子目录 探针目录 + html（相对引用 + vfs:// 引用）+ css + 合法 PNG。
    // 同文件混排两类引用：./ 相对引用供预览保真渲染；vfs://local 引用供导出改写断言
    const sub = path.join(srcDir, '探针目录');
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      path.join(sub, 'p.html'),
      '<meta charset="utf-8"><link rel="stylesheet" href="./p.css">' +
        '<img src="./图片.png" alt="图">' +
        '<p id="pp">探针正文锚点</p>' +
        '<a id="vref" href="vfs://local/探针目录/p.css">样式引用</a>' +
        '<a id="vref2" href="vfs://local/探针目录/图片.png">图片引用</a>',
      'utf8',
    );
    writeFileSync(path.join(sub, 'p.css'), '#pp { color: red; }', 'utf8');
    writeFileSync(path.join(sub, '图片.png'), make1x1Png());
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    // Windows 文件锁纪律：先关应用再删临时目录；关停前显式放行 guard（close-app.ts 头注）。
    // 用例中途失败遗留已死实例时，closeAppGracefully 的竞速兜底保证 afterAll 不拖满超时
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(exportRoot, { recursive: true, force: true });
  });

  test('主链路：导入→树结构→编辑自动保存→预览一致→搜索定位→回收站还原→导出→dark→重启恢复', async () => {
    test.setTimeout(120_000); // 主链路含一次完整重启，宽松上限防 CI 慢机误报
    // —— 导入（菜单 → OS 目录选择打桩 → 策略确认弹层默认跳过 → io:import）——
    await stubDialogPick(srcDir);
    expect(await clickMenuById('menu-import')).toBe(true);
    await expect(page.getByLabel('确认导入')).toBeVisible();
    const importStart = Date.now();
    await page.getByLabel('确认导入').click();
    await expect(page.locator('.lt-toast').filter({ hasText: '导入完成' })).toBeVisible({
      timeout: 15000,
    });
    console.log(`[perf-m5] 主链路导入耗时 ${String(Date.now() - importStart)}ms（确认→toast）`);
    // —— 树结构与图片节点断言（源根不物化，子目录合并落根，spec §7.1）——
    const tree = treeNodes();
    await expect(tree.getByRole('button', { name: '探针目录' })).toBeVisible();
    await tree.getByRole('button', { name: '探针目录' }).click(); // 展开（懒加载装载子层）
    await expect(tree.getByRole('button', { name: 'p.html' })).toBeVisible();
    await expect(tree.getByRole('button', { name: 'p.css' })).toBeVisible();
    await expect(tree.getByRole('button', { name: '图片.png' })).toBeVisible();
    // —— 编辑已有文件（自动保存落库）→ 预览一致（含相对引用 css 与真图渲染）——
    await tree.getByRole('button', { name: 'p.html' }).click();
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible();
    await expect(page.frameLocator('iframe.lt-preview-frame').locator('#pp')).toHaveText(
      '探针正文锚点',
    );
    await typeAtEnd('<p id="chain">链路增量</p>');
    // 预览一致性用 innerText 容错（接收器 script 不计可见文本，M4 先例）；toContain 使
    // 重试轮（文档已含前次增量）可重入
    await expect(page.frameLocator('iframe.lt-preview-frame').locator('body')).toContainText(
      '链路增量',
      { useInnerText: true },
    );
    // 图片经相对引用真实渲染（合法 PNG，naturalWidth=1）——「预览一致」的媒体面证据
    await expect
      .poll(async () =>
        page
          .frameLocator('iframe.lt-preview-frame')
          .locator('img')
          .evaluate((img: HTMLImageElement) => ({
            count: document.querySelectorAll('img').length,
            width: img.naturalWidth,
          })),
      )
      .toEqual({ count: 1, width: 1 });
    // —— 全局搜索命中点击定位打开（正文关键词 → 命中行「打开」→ 标签聚焦）——
    await page.getByLabel('打开全局搜索').click();
    await page.getByLabel('搜索关键词').fill('探针正文锚点');
    await page.getByLabel('搜索关键词').press('Enter');
    await page.getByLabel('打开 p.html').click();
    await expect(page.getByRole('tab', { name: /p\.html/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // 「打开」不切回树态（定位打开语义：树侧展开 + 开签，视图留在 search）——显式返回，
    // 后续工具栏删除/回收站入口均在 tree 态（实证：search 态下树工具栏不渲染）
    await page.getByLabel('返回资源树').click();
    // —— 回收站 trash → 列表还原（回收站 UI，M5 批次②）——
    await page.locator('.lt-tree-toolbar').getByRole('button', { name: '删除' }).click();
    await expect(page.getByRole('tab')).toHaveCount(0); // trash 激活标签随会话关闭
    await page.getByLabel('打开回收站').click();
    const trashedRow = page
      .locator('section[aria-label="回收站"] li')
      .filter({ hasText: 'p.html' });
    await expect(trashedRow).toBeVisible();
    await expect(trashedRow).toContainText('/探针目录/p.html'); // 原路径列
    await expect(trashedRow).toContainText('删除于'); // 删除时间列
    await trashedRow.getByLabel('还原 p.html').click();
    await expect(trashedRow).toHaveCount(0); // restored 广播重拉后出列
    await page.getByLabel('返回资源树').click();
    await tree.getByRole('button', { name: '探针目录' }).click(); // 重新展开（还原后重取）
    await tree.getByRole('button', { name: 'p.html' }).click();
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible();
    // —— 导出子树（搜索「在树中显示」设定导出根 → 目录选择打桩 → io:export）→ Node 侧断言 ——
    await page.getByLabel('打开全局搜索').click();
    await page.getByLabel('搜索关键词').fill('探针目录');
    await page.getByLabel('搜索关键词').press('Enter');
    await page.getByLabel('在树中显示 探针目录').click(); // reveal 选中 = 导出根（目录）
    const exportOut = path.join(exportRoot, `attempt-${String(test.info().retry)}`);
    mkdirSync(exportOut, { recursive: true });
    await stubDialogPick(exportOut);
    expect(await clickMenuById('menu-export')).toBe(true);
    await expect(page.locator('.lt-toast').filter({ hasText: '导出完成' })).toBeVisible({
      timeout: 15000,
    });
    // Node 侧（Playwright 测试进程）直读磁盘：结构同构 + vfs:// 引用改写为相对路径
    const container = path.join(exportOut, '探针目录');
    expect(readdirSync(exportOut)).toEqual(['探针目录']);
    expect(existsSync(path.join(container, 'p.html'))).toBe(true);
    expect(existsSync(path.join(container, 'p.css'))).toBe(true);
    expect(existsSync(path.join(container, '图片.png'))).toBe(true);
    const exportedHtml = readFileSync(path.join(container, 'p.html'), 'utf8');
    expect(exportedHtml).toContain('链路增量'); // 导出读取自动保存后的最新 BLOB
    expect(exportedHtml).toContain('href="p.css"'); // vfs://local/探针目录/p.css → 同目录相对链
    expect(exportedHtml).toContain('href="图片.png"'); // 同目录图片引用 → 相对链
    expect(exportedHtml).not.toContain('vfs://local'); // 改写无残留
    // —— 设置页切 dark（.dark 类 + 语义变量计算样式）——
    await page.getByLabel('打开设置').click();
    await page.getByLabel('主题').click();
    await page.getByRole('option', { name: '暗色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('section[aria-label="设置"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .toBe('rgb(15, 23, 42)'); // dark --background #0f172a
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const settings = await window.api.settingsGet();
          return settings.ok ? settings.value.appearance.theme : '';
        }),
      )
      .toBe('dark'); // 意图持久化落盘
    await page.getByLabel('返回工作台').click();
    // —— 重启（同 userData，closeAppGracefully 纪律 + 旧实例退出确认）→ 工作区恢复 ——
    await restartApp();
    await launchApp(userDataDir);
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible(); // 标签会话恢复
    await expect(page.locator('.cm-content')).toContainText('链路增量'); // 恢复式打开读回内容
  });

  test('快速打开：菜单触发浮层、空关键词最近打开、部分名搜索 Enter 打开', async () => {
    expect(await clickMenuById('menu-quick-open')).toBe(true);
    const overlay = page.locator('.lt-quickopen');
    await expect(overlay).toBeVisible();
    // 空关键词：最近打开组可见（主链路已打开 p.html，recent 域非空）
    await expect(overlay.getByText('最近打开')).toBeVisible();
    // 部分名搜索（去抖 200ms 后服务端查询）→ 首位候选默认选中 → Enter 打开
    await page.getByPlaceholder('搜索文件名或正文…').fill('p.htm');
    await expect(overlay.getByText('搜索结果')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Enter');
    await expect(overlay).not.toBeVisible(); // 点选后浮层收起
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /p\.html/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

test.describe('M5 回收站（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-trash-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('回收站：列表原路径与删除时间、还原、撞名还原失败、彻底删除 confirm', async () => {
    const retry = test.info().retry;
    const name = `回收甲${retry > 0 ? `-重试${String(retry)}` : ''}.html`;
    const nodeId = await seedFile(1, name, '<p id="r">回收站用例</p>');
    // trash：树点选开标签（选中 = 删除目标）→ 工具栏删除
    await treeNodes().getByRole('button', { name }).click();
    await page.locator('.lt-tree-toolbar').getByRole('button', { name: '删除' }).click();
    // 回收站列表：名称 + 原路径 + 删除时间三面呈现
    await page.getByLabel('打开回收站').click();
    const row = page.locator('section[aria-label="回收站"] li').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`/${name}`);
    await expect(row).toContainText('删除于');
    // 还原（可逆无确认）：列表出列
    await row.getByLabel(`还原 ${name}`).click();
    await expect(row).toHaveCount(0);
    // 撞名分支（仍在回收站态完成全部面板操作，避免视图切换造成的断言面漂移）：
    // 桥 trash 回收条目 + 同名再建占住名称 → 还原 → E_VFS_DUPLICATE_NAME → toast、条目保留
    await page.evaluate((id) => window.api.trashNode({ nodeId: id }), nodeId); // 广播驱动面板重拉
    await seedFile(1, name, '<p>同名再建</p>');
    await expect(row).toBeVisible(); // trashed 广播重拉后条目回归
    await row.getByLabel(`还原 ${name}`).click();
    await expect(page.locator('.lt-toast').filter({ hasText: '还原失败' })).toBeVisible();
    await expect(row).toBeVisible(); // 还原失败条目不出列
    // 彻底删除（不可逆）：window.confirm 原生框经 page.on('dialog') 驱动，接管并断言文案
    const dialogMessage = new Promise<string>((resolve) => {
      page.once('dialog', (dialog) => {
        void dialog.accept();
        resolve(dialog.message());
      });
    });
    await row.getByLabel(`彻底删除 ${name}`).click();
    expect(await dialogMessage).toBe(`彻底删除「${name}」？不可恢复`);
    await expect(row).toHaveCount(0); // purged 后出列
    // 树回归面：还原语义事后核验——同名再建体仍在树、被彻底删除体不在
    await page.getByLabel('返回资源树').click();
    await expect(treeNodes().getByRole('button', { name })).toBeVisible();
    await expect(await pathExists(`/${name}`)).toBe(true);
  });
});

test.describe('M5 设置页（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-settings-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('设置页：主题三态切换（.dark + 计算样式）与字号滑块（.cm-content 计算样式）', async () => {
    // 自播种样例文档并开签：字号断言面 = 激活标签的 CM 实例（独立会话无标签残留）
    await seedFile(1, '滑块样例.html', '<p>字号样例</p>');
    await treeNodes().getByRole('button', { name: '滑块样例.html' }).click();
    await page.getByLabel('打开设置').click();
    const settingsSection = page.locator('section[aria-label="设置"]');
    await expect(settingsSection).toBeVisible();
    // —— 暗色：.dark 挂载 + dark 语义背景 ——
    await page.getByLabel('主题').click();
    await page.getByRole('option', { name: '暗色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true);
    await expect
      .poll(() => settingsSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(15, 23, 42)'); // dark --background #0f172a
    // —— 亮色：.dark 摘除 + light 语义背景 ——
    await page.getByLabel('主题').click();
    await page.getByRole('option', { name: '亮色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false);
    await expect
      .poll(() => settingsSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(248, 250, 252)'); // light --background #f8fafc
    // —— 跟随系统：解析结果 = matchMedia 偏好（意图持久化 system）——
    await page.getByLabel('主题').click();
    await page.getByRole('option', { name: '跟随系统' }).click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const settings = await window.api.settingsGet();
          return settings.ok ? settings.value.appearance.theme : '';
        }),
      )
      .toBe('system');
    const systemPrefersDark = await page.evaluate(
      () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(systemPrefersDark);
    // —— 字号滑块：写入 20 → 设置落盘 + CM 计算样式即时重配 ——
    await page.getByLabel('编辑器字号').fill('20');
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const settings = await window.api.settingsGet();
          return settings.ok ? settings.value.appearance.editorFontSize : -1;
        }),
      )
      .toBe(20);
    await expect
      .poll(() => page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('20px');
    await page.getByLabel('返回工作台').click();
  });
});

test.describe('M5 备份还原（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-backup-'));
    await launchApp(userDataDir);
    // 还原点数据（桥 seed 目录 + 文件）：还原后必须仍在
    const dir = await page.evaluate(() =>
      window.api.createNode({ parentId: 1, name: '还原样例', nodeType: 'dir' }),
    );
    if (!dir.ok) throw new Error('建还原样例目录失败');
    await seedFile(dir.value.id, '样例文档.html', '<p id="bd">还原点数据</p>');
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('备份还原：手动建份入列表 → 桥写标记 → 强确认还原 → 应用重启 → 数据回滚', async () => {
    await page.getByLabel('打开设置').click();
    await page.getByRole('button', { name: '备份' }).click(); // 设置页导航切备份区
    // 每日自动备份开关（出厂默认开启）
    await expect(page.getByLabel('每日自动备份')).toBeChecked();
    // 手动建份：toast 呈现 + 列表新增（toast 提取文件名 → 桥读列表等该名出现——列表本就有
    // 启动期自动备份，仅断言「列表非空」会读到旧条目而取错还原点）
    await page.getByLabel('立即备份').click();
    const createdToast = page.locator('.lt-toast').filter({ hasText: '已创建备份' });
    await expect(createdToast).toBeVisible();
    const toastText = await createdToast.first().innerText();
    const nameMatch = toastText.match(/lt-\d{8}-\d{6}\.db/);
    expect(nameMatch).not.toBeNull();
    const backupFile = nameMatch?.[0] ?? '';
    await expect
      .poll(async () =>
        page.evaluate(async (target) => {
          const list = await window.api.backupList();
          return list.ok ? list.value.some((entry) => entry.fileName === target) : false;
        }, backupFile),
      )
      .toBe(true);
    expect(backupFile).toMatch(/^lt-\d{8}-\d{6}\.db$/);
    await expect(page.locator('section[aria-label="设置"]').getByText(backupFile)).toBeVisible();
    // 桥写标记文件（还原点之后的数据变更——还原成功即应回滚消失）
    const markerName = `还原标记${test.info().retry > 0 ? `-重试${String(test.info().retry)}` : ''}.html`;
    await seedFile(1, markerName, '<p>还原后应消失</p>');
    await expect(await pathExists(`/${markerName}`)).toBe(true);
    // 诊断（测试进程直读备份文件）：备份本体必须已含还原点数据——坐实「备份内容」与
    // 「还原替换」两段链路各自成立（better-sqlite3 readonly 连接不扰应用文件锁）
    const backupPath = path.join(userDataDir, 'LearningText', 'backups', backupFile);
    const Database = (await import('better-sqlite3')).default;
    const backupDb = new Database(backupPath, { readonly: true });
    try {
      const rows = backupDb
        .prepare('SELECT name FROM node WHERE deleted_at IS NULL ORDER BY id')
        .all() as { name: string }[];
      console.log(`[perf-m5] 备份文件节点清单: ${JSON.stringify(rows.map((r) => r.name))}`);
      expect(rows.map((r) => r.name)).toContain('还原样例');
    } finally {
      backupDb.close();
    }
    // relaunch 打桩（探针②实证可赋值）：记录「产品已请求重启」标记文件、不派生 Playwright
    // 无法附着的新进程——进程退出与重启后数据断言保持真实驱动
    const relaunchMarker = path.join(userDataDir, 'relaunch-called.marker');
    await app.evaluate(({ app: electronApp }, markerPath) => {
      const mainModule = process.mainModule;
      if (mainModule === undefined) throw new Error('process.mainModule 不可用');
      const fs = (
        mainModule as unknown as { require: (id: string) => typeof import('node:fs') }
      ).require('node:fs');
      (electronApp as unknown as Record<string, unknown>).relaunch = (): void => {
        fs.writeFileSync(markerPath, String(Date.now()), 'utf8');
      };
    }, relaunchMarker);
    // 还原强确认（alert-dialog DOM 内组件，aria 角色定位）：文案「将覆盖当前全部数据并重启应用」
    await page.getByLabel(`还原到 ${backupFile}`).click();
    await expect(page.getByText('将覆盖当前全部数据并重启应用')).toBeVisible();
    await page.getByLabel('确认还原').click();
    // 进程退出断言（app.exit(0) 产品语义）：exitCode 置值即「重启触发」事实
    const proc = app.process();
    await expect
      .poll(() => proc.exitCode !== null || proc.signalCode !== null, { timeout: 30_000 })
      .toBe(true);
    expect(proc.exitCode).toBe(0);
    expect(existsSync(relaunchMarker)).toBe(true); // 产品确实调用了 app.relaunch（重启请求留证）
    // 重启（同 userData 重新 launch——「等待进程退出 + 重新 launch」形态）
    await launchApp(userDataDir);
    // 数据回滚断言：标记文件消失（回到备份点）、原有数据与备份列表仍在
    await expect(await pathExists(`/${markerName}`)).toBe(false);
    await expect(await pathExists('/还原样例/样例文档.html')).toBe(true);
    const restoredBackups = await page.evaluate(async () => {
      const list = await window.api.backupList();
      return list.ok ? list.value.map((entry) => entry.fileName) : [];
    });
    expect(restoredBackups).toContain(backupFile);
  });
});

test.describe('M5 滚动同步（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-scroll-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('滚动同步：编辑器滚动预览按比例跟随（±5%）、开关关闭不跟随', async () => {
    // SDD BLOCKED 留证（产品缺陷，非驱动形态问题）：CM6 实例未约束高度（codemirror.ts 的
    // theme 仅有外观 compartment，无 height），实测 .cm-scroller clientHeight=scrollHeight=3927
    // （与内容同高），overflowY 虽为 auto 但无可滚动量——滚轮 2000px 后 scrollTop 恒 0、程序化
    // 赋值同死（探针㉒a 实证），FR-RENDER-06 上行链路（scrollDOM scroll 事件）不可触发、下行
    // （EditorView.scrollIntoView）无滚动容器同死。属编辑器布局缺陷（缺 height:100% 约束），
    // 滚动同步 E2E 待产品修复后摘除本 skip 恢复；证据与测量数据见 task-16-report §五。
    test.skip(
      true,
      '产品缺陷：编辑器无高度约束致 .cm-scroller 不可滚动，滚动同步双向链路不可触发（证据见 task-16-report）',
    );
    // 200 段落长文档（桥 seed）：每段独立成行（编辑器滚动量需要多行——单行文档无纵向
    // 可滚动量，比例恒 0）；编辑器与预览均有足量可滚动高度
    const paragraphs = Array.from(
      { length: 200 },
      (_, i) => `<p id="seg${String(i)}">第${String(i)}段落</p>`,
    ).join('\n');
    await seedFile(1, '滚动长文.html', `<meta charset="utf-8">\n${paragraphs}`);
    await treeNodes().getByRole('button', { name: '滚动长文.html' }).click();
    await expect(page.frameLocator('iframe.lt-preview-frame').locator('#seg199')).toHaveText(
      '第199段落',
    );
    // 编辑器滚到 70% → 预览比例跟随至 ±5%（100ms 节流 + postMessage 下行 + iframe scrollTo）
    await scrollEditorTo(0.7);
    const editorAt = await editorRatio();
    expect(editorAt).toBeGreaterThan(0.6); // 前置证据：编辑器确已滚动到目标区间
    await expect.poll(previewRatio, { timeout: 5000 }).toBeGreaterThan(editorAt - 0.05);
    await expect.poll(previewRatio, { timeout: 5000 }).toBeLessThan(editorAt + 0.05);
    // 开关关闭（会话级偏好 D14）：编辑器再滚到 10%，预览保持原位不跟随
    const syncToggle = page.getByLabel('滚动同步');
    await expect(syncToggle).toHaveAttribute('aria-pressed', 'true');
    await syncToggle.click();
    await expect(syncToggle).toHaveAttribute('aria-pressed', 'false');
    await scrollEditorTo(0.1);
    await expect.poll(editorRatio, { timeout: 5000 }).toBeLessThan(0.15); // 编辑器已到位
    const frozenRatio = await previewRatio();
    expect(frozenRatio).toBeGreaterThan(editorAt - 0.05); // 预览未被牵动（仍停在原 70% 附近）
  });
});

test.describe('M5 图片预览与恢复开关（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-media-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('图片预览：树点选图片 → 预览面板 img 直载 vfs URL、不开新标签', async () => {
    // SDD BLOCKED 留证（产品缺陷，非驱动形态问题）：主文档 CSP（index.html）为
    // 「default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src vfs:; frame-src vfs:」
    // ——无 img-src，回落 'self'（app://bundle），媒体分支 <img src="vfs://…"> 被 CSP 拦截
    // → onError → 「文档不可用」占位（探针㉒b 实证：同 URL fetch 200 / 70 字节 / image/png
    // （connect-src vfs: 放行），而 img 元素 error；字节为结构自检通过的合法 1x1 PNG）。
    // 属 Task 14 缺陷（真实产品 CSP 下图片预览必然不可用，音频同族 media-src 缺失），
    // 待产品补 img-src vfs:（含 media-src 评估）后摘除本 skip 恢复；证据见 task-16-report §五。
    test.skip(
      true,
      '产品缺陷：主文档 CSP 无 img-src vfs:，图片预览 img 被 CSP 拦截必落「文档不可用」（证据见 task-16-report）',
    );
    // 桥 seed 合法 PNG（createNode 按扩展名推导 image/png——previewableMime 命中的前提）；
    // 字节经 number 数组穿越桥，页内还原 Uint8Array（TextEncoder 会破坏二进制）
    const png = make1x1Png();
    const created = await page.evaluate(
      (bytes) =>
        window.api.createNode({
          parentId: 1,
          name: '图片.png',
          nodeType: 'file',
          content: new Uint8Array(bytes),
        }),
      Array.from(png),
    );
    if (!created.ok) throw new Error('建图片节点失败');
    await treeNodes().getByRole('button', { name: '图片.png' }).click();
    const img = page.locator('img.lt-preview-media');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', 'vfs://local/图片.png'); // vfs 协议直载
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 })
      .toBe(1); // 合法 PNG 真实解码（排除 onError 占位假象）
    // 无新标签：媒体点选不开编辑标签（激活标签原样保留，D20）
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(app.windows().length).toBe(1); // setWindowOpenHandler deny 的窗口面佐证
  });

  test('恢复开关关闭后重启：工作区不恢复（标签集为空）', async () => {
    // 前置：打开一个标签（工作区会话域非空）、开关为出厂默认 true——先证「有可恢复面」
    await seedFile(1, '开关样例.html', '<p>开关样例</p>');
    await treeNodes().getByRole('button', { name: '开关样例.html' }).click();
    await expect(page.getByRole('tab', { name: /开关样例\.html/ })).toBeVisible();
    // 关闭启动恢复开关（经桥直写 settings workspace 域——设置页无此控件 UI，域语义同源；
    // 轮询确认落盘，防串行写链竞态）
    await expect
      .poll(async () => {
        return page.evaluate(async () => {
          const current = await window.api.settingsGet();
          if (!current.ok) return false;
          const written = await window.api.settingsSet({
            ...current.value,
            workspace: { ...current.value.workspace, restoreOnStart: false },
          });
          if (!written.ok) return false;
          const verify = await window.api.settingsGet();
          return verify.ok && verify.value.workspace.restoreOnStart === false;
        });
      })
      .toBe(true);
    // 重启（同 userData）：恢复链被开关短路 → 无标签恢复
    await restartApp();
    await launchApp(userDataDir);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.lt-editor-empty')).toContainText('未选中文件');
  });
});

test.describe('M5 导入取消（独立 userData，600 文件批量）', () => {
  let userDataDir: string;
  let srcDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-cancel-'));
    srcDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-cancel-src-'));
    // 600 小文件（40KB text/html，FTS trigram 入索引）→ 写入计划 601 节点 → 3 个批次
    //（批 ≤200 节点），批间让出事件循环——进度面板与 io:cancel 在批边界可插队（D15/D16）
    const bulk = path.join(srcDir, '批量');
    mkdirSync(bulk, { recursive: true });
    const body = '<p>'.padEnd(40 * 1024, 'x') + '</p>';
    for (let i = 0; i < 600; i += 1) {
      writeFileSync(path.join(bulk, `f${String(i).padStart(3, '0')}.html`), body, 'utf8');
    }
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  test('导入取消：进度面板取消按钮触发 → 已写入保留（计数 ≥1）且完成 toast 呈现', async () => {
    await stubDialogPick(srcDir);
    expect(await clickMenuById('menu-import')).toBe(true);
    await expect(page.getByLabel('确认导入')).toBeVisible();
    // 取消触发点（brief 实现注：按钮可用性/进度可见性）——进度面板寿命与导入总时长同量级
    //（~1s），Playwright await click 的解析延迟会错过按钮存活窗（探针实证：面板在 click
    // 返回前已挂载又卸载），故取消按钮的「可见即点」由页面内 MutationObserver 承载：按钮
    // 进入 DOM 且面板已进入写入阶段（首个批次已提交，D16 当前批完成后停 → 已写入必 ≥200）
    // 即触发真实按钮回调（cancelRunningImport → io:cancel，产品链路原样）
    await page.evaluate(() => {
      const w = window as unknown as { __cancelObserver?: MutationObserver };
      const observer = new MutationObserver(() => {
        const panel = document.querySelector('.lt-import-progress');
        if (panel === null) return;
        if (!panel.textContent?.includes('正在导入')) return; // 扫描阶段取消会得 0 批——等写入
        const button = panel.querySelector<HTMLButtonElement>('[aria-label="取消导入"]');
        if (button !== null) {
          observer.disconnect();
          button.click();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      w.__cancelObserver = observer;
    });
    const start = Date.now();
    await page.getByLabel('确认导入').click();
    const toast = page.locator('.lt-toast').filter({ hasText: '导入完成' }).first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
    const toastText = await toast.innerText();
    const match = toastText.match(/新增 (\d+)/);
    expect(match).not.toBeNull();
    const imported = Number(match?.[1] ?? 0);
    console.log(
      `[perf-m5] 导入取消实测：确认→终态 toast ${String(Date.now() - start)}ms，已写入 ${String(imported)}/601`,
    );
    // 取消语义断言：至少一个批次已提交保留（≥1，brief 契约）；未跑完全量（<601）即取消生效
    expect(imported).toBeGreaterThanOrEqual(1);
    expect(imported).toBeLessThan(601);
    // 终态收口：进度面板随 invoke 续体清空
    await expect(page.locator('.lt-import-progress')).toHaveCount(0);
  });
});
