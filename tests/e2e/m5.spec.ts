// M5 验收（docs/03 §6.2 M5 出口 / spec §10.1-1 主链路；M6 画布语义改写）——7 组用例：
// ① 主链路（磁盘 seed → 导入 → 树/图片节点 → 画布编辑自动保存 → 渲染一致 → 搜索命中定位
//    打开 → 回收站 trash/还原 → 导出子树 + Node 侧结构与引用改写断言 → 设置页 dark → 同
//    userData 重启 → 工作区恢复）；② 快速打开（菜单触发 cmdk 浮层、Enter 打开、空关键词
//    最近打开）；③ 回收站（列表原路径/删除时间、还原、撞名还原失败、彻底删除 confirm）；
// ④ 设置页（主题三态 + 字号滑块计算样式 + 数据与存储分区冒烟：默认 badge/根路径/更改数据
//    位置强确认弹层可开可取消）；⑤ 备份还原（手动建份、列表名形、强确认、重启、数据回滚）；
// ⑥ 导入取消（600 文件、进度面板取消按钮「可见即点」触发、已写入保留 + toast）；⑦ 图片
//    打开（媒体一律开标签 img 直载 vfs URL，M6 D4）+ 恢复开关关闭后重启不恢复。
// M6 语义映射：HTML 编辑面由 CM 平移为画布 iframe（所见即所得，输入即渲染、无重载链），
// 「预览一致」断言面改为画布 frame 文本；滚动同步用例随能力退役整体删除（spec D5）。
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
import type { ElectronApplication, FrameLocator, Locator, Page } from 'playwright';
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

/** 树作用域（资源树 nav 内首层列表，与工具栏同名按钮隔离，editor.spec 先例） */
function treeNodes(): Locator {
  return page.locator('nav[aria-label="资源树"] > ul');
}

/**
 * HTML 画布编辑（M6 所见即所得，editor.spec 同款驱动形态）：等注入桥置 contenteditable
 * 就绪 → 点 iframe 面聚焦（空文档 body 零高不可点，iframe 全幅可见必可点）→ 光标推到
 * 文档末尾 → 键入追加。返回画布 frame 供内容断言
 */
async function typeAtCanvasEnd(name: string, text: string): Promise<FrameLocator> {
  const holder = page.locator(`iframe.lt-canvas-frame[title="编辑 ${name}"]`);
  const frame = holder.contentFrame();
  await expect(frame.locator('body')).toHaveAttribute('contenteditable', 'true');
  await holder.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.type(text);
  return frame;
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
    // —— 编辑已有文件（画布所见即所得：输入即渲染；自动保存落库供导出与重启恢复读回）——
    await tree.getByRole('button', { name: 'p.html' }).click();
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible();
    // 初始渲染证据：正文锚点已呈现（charset utf-8 正确解码，M4 Task 8 语义）
    await expect(
      page.locator('iframe.lt-canvas-frame[title="编辑 p.html"]').contentFrame().locator('#pp'),
    ).toHaveText('探针正文锚点');
    const canvas = await typeAtCanvasEnd('p.html', '链路增量');
    // 所见即所得：输入即渲染（编辑面=渲染面零重载）；innerText 容错（接收器 script 不计
    // 可见文本，M4 先例）；toContain 使重试轮（文档已含前次增量）可重入
    await expect(canvas.locator('body')).toContainText('链路增量', { useInnerText: true });
    // 编辑上报入管线证据（脏点亮起）：画布注入桥的 200ms 去抖上报计时器位于沙箱 iframe 的
    // 任务队列，探针实证该队列在无帧内活动时可被渲染器长期搁置（帧可见有焦点仍不派发，
    // 计时器延迟至秒级以上甚至不触发，直至下一次帧内任务）——以帧内 evaluate 泵一次任务
    // 队列再等脏点，保证「已上报」先于 trash 关签 flush 与导出读库发生（详见报告
    // 「疑似产品缺陷」节：真实用户任意后续交互都会唤醒该队列，自动化长驱动父页侧才暴露）
    await expect(async () => {
      await canvas.locator('body').evaluate(() => undefined);
      await expect(
        page.getByRole('tab', { name: /p\.html/ }).locator('[aria-label="未保存"]'),
      ).toBeVisible();
    }).toPass({ timeout: 10000 });
    // 落库完成证据（库为 oracle）：自动保存写落库后才推进 trash/导出/重启断言面
    const pHtmlId = await page.evaluate(async () => {
      const r = await window.api.resolvePath({ virtualPath: '/探针目录/p.html' });
      return r.ok ? r.value.nodeId : -1;
    });
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const r = await window.api.readFile({ nodeId: id });
            return r.ok ? new TextDecoder().decode(r.value.content).includes('链路增量') : false;
          }, pHtmlId),
        { timeout: 10000, intervals: [200] },
      )
      .toBe(true);
    // 图片经相对引用真实渲染（合法 PNG，naturalWidth=1）——「渲染一致」的媒体面证据
    await expect
      .poll(async () =>
        page
          .locator('iframe.lt-canvas-frame[title="编辑 p.html"]')
          .contentFrame()
          .locator('img')
          .evaluate((img: HTMLImageElement) => ({
            count: document.querySelectorAll('img').length,
            width: img.naturalWidth,
          })),
      )
      .toEqual({ count: 1, width: 1 });
    // —— 全局搜索命中点击定位打开（正文关键词 → 命中行「打开」→ 标签聚焦）——
    await page.getByLabel('全局搜索').click();
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
    await page.getByLabel('回收站').click();
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
    await page.getByLabel('全局搜索').click();
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
    await page.getByRole('combobox', { name: '主题' }).click();
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
    await page.getByLabel('关闭设置').click();
    // —— 重启（同 userData，closeAppGracefully 纪律 + 旧实例退出确认）→ 工作区恢复 ——
    await restartApp();
    await launchApp(userDataDir);
    await expect(page.getByRole('tab', { name: /p\.html/ })).toBeVisible(); // 标签会话恢复
    // 恢复式打开读回内容：p.html 为画布标签（M6 三分流），内容断言平移到画布 frame
    await expect(
      page.locator('iframe.lt-canvas-frame[title="编辑 p.html"]').contentFrame().locator('body'),
    ).toContainText('链路增量', { useInnerText: true });
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
    await page.getByLabel('回收站').click();
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

  test('设置页：主题三态切换（.dark + 计算样式）、字号滑块（.cm-content 计算样式）与数据目录分区冒烟', async () => {
    // 自播种源码样例（.css → CM 标签：M6 起 HTML 走画布无 CM 实例，字号断言面必须 CM）
    // 并开签：字号断言面 = 激活标签的 CM 实例（独立会话无标签残留）
    await seedFile(1, '滑块样例.css', '.demo { color: red; }');
    await treeNodes().getByRole('button', { name: '滑块样例.css' }).click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await page.getByLabel('打开设置').click();
    const settingsSection = page.locator('section[aria-label="设置"]');
    await expect(settingsSection).toBeVisible();
    // —— 暗色：.dark 挂载 + dark 语义背景 ——
    await page.getByRole('combobox', { name: '主题' }).click();
    await page.getByRole('option', { name: '暗色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true);
    await expect
      .poll(() => settingsSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(15, 23, 42)'); // dark --background #0f172a
    // —— 亮色：.dark 摘除 + light 语义背景 ——
    await page.getByRole('combobox', { name: '主题' }).click();
    await page.getByRole('option', { name: '亮色' }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false);
    await expect
      .poll(() => settingsSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(248, 250, 252)'); // light --background #f8fafc
    // —— 跟随系统：解析结果 = matchMedia 偏好（意图持久化 system）——
    await page.getByRole('combobox', { name: '主题' }).click();
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
    // —— 字号滑块：写入 20 → 设置落盘（意图持久化证据）——
    await page.getByLabel('编辑器字号').fill('20');
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const settings = await window.api.settingsGet();
          return settings.ok ? settings.value.appearance.editorFontSize : -1;
        }),
      )
      .toBe(20);
    // —— 数据与存储分区冒烟（M6 批次③）：默认 badge + 根路径展示 + 更改数据位置强确认弹层可开可取消 ——
    await page.getByRole('button', { name: '数据与存储' }).click();
    await expect(page.locator('.lt-storage-badge')).toHaveText('默认'); // 未自定义：出厂数据根
    const storageRoot = page.locator('.lt-storage-root');
    await expect(storageRoot).toBeVisible();
    expect((await storageRoot.innerText()).trim().length).toBeGreaterThan(0); // 根路径已呈现
    // 更改数据位置：目录选择打桩（OS 对话框不可驱动，探针先例）→ 强确认弹层呈现 → 取消收场
    //（迁移动作留集成层，E2E 不做 relaunch，spec §8 测试策略）
    const migrateTarget = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-storage-'));
    try {
      await stubDialogPick(migrateTarget);
      await page.getByLabel('更改数据位置').click();
      await expect(page.getByText('将把数据库、设置与备份迁移到')).toBeVisible();
      await expect(page.getByText(/完成后应用将自动重启/)).toBeVisible();
      await page.getByLabel('取消迁移').click();
      await expect(page.getByText('将把数据库、设置与备份迁移到')).toHaveCount(0);
    } finally {
      rmSync(migrateTarget, { recursive: true, force: true });
    }
    await page.getByLabel('关闭设置').click();
    // 字号持久化值在 CM 实例上生效：设置为编辑区伪标签（M6 D3），打开期间 CM 卸载——
    // 「计算样式即时重配」断言移至关设置后的编辑器面（激活补位回落最后一个 doc 标签）
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect
      .poll(() => page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize))
      .toBe('20px');
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

test.describe('M5 图片打开与恢复开关（独立 userData）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m5-media-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('图片打开：树点选图片 → 开媒体标签 img 直载 vfs URL（D4：媒体一律开标签）', async () => {
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
    // M6 D4/D6：点击一律开标签——媒体文件开媒体 doc 标签（D20 弱选中双源已退役），
    // MediaCanvas 原生 img 直载（无 iframe、无 CM）
    await treeNodes().getByRole('button', { name: '图片.png' }).click();
    await expect(page.getByRole('tab', { name: /图片\.png/ })).toBeVisible();
    const img = page.locator('img.lt-media-content');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', 'vfs://local/图片.png'); // vfs 协议直载
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 5000 })
      .toBe(1); // 合法 PNG 真实解码（排除 onError 占位假象）
    expect(app.windows().length).toBe(1); // setWindowOpenHandler deny 的窗口面佐证
  });

  test('恢复开关关闭后重启：工作区不恢复（标签集为空）', async () => {
    // 前置：打开一个标签（工作区会话域非空）、开关为出厂默认 true——先证「有可恢复面」
    await seedFile(1, '开关样例.html', '<p>开关样例</p>');
    await treeNodes().getByRole('button', { name: '开关样例.html' }).click();
    await expect(page.getByRole('tab', { name: /开关样例\.html/ })).toBeVisible();
    // 关闭启动恢复开关（设置页 → 维护区 → 开关，UI 真实驱动——spec §3.2 控件交付后
    // 弃原「桥直写 settings」绕 UI 形态；写链经产品通道 get→merge→set 异步串行落盘，
    // 以只读 settingsGet 轮询确认持久化完成，防重启早于落盘的竞态）
    await page.getByLabel('打开设置').click();
    await page.getByRole('button', { name: '工作区' }).click();
    const restoreSwitch = page.getByLabel('启动时恢复工作区');
    await expect(restoreSwitch).toBeChecked(); // 出厂默认开（spec §3.2）
    await restoreSwitch.click();
    await expect(restoreSwitch).not.toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const verify = await window.api.settingsGet();
          return verify.ok && verify.value.workspace.restoreOnStart === false;
        }),
      )
      .toBe(true);
    // 重启（同 userData）：恢复链被开关短路 → 无标签恢复（空态由欢迎页承载，M6 壳层）
    await restartApp();
    await launchApp(userDataDir);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.lt-welcome')).toBeVisible();
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
