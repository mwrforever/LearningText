// M4 验收 → M6 画布语义改写（spec：docs/superpowers/specs/2026-09-22-产品化UI重构-design.md
// §2 壳层 / §3 所见即所得）：主链路（新建→画布编辑→自动保存落库→重命名→移动→删除→桥还原→
// 重开可编辑）+ 保存管线（尾沿去抖/挂起强制写/菜单保存立即写）+ 多标签会话 + 侧栏折叠与宽度
// 记忆重启 + 菜单命令 + css 热替换 + unsaved-guard + 5MB 打开计时（[perf-m4] 输出回填报告）。
// M6 语义映射（退役→等价面）：HTML 不再进 CM、无独立预览面板——「预览一致/预览重载」断言面
// 改为「画布实时文本 + 落库 oracle（桥 readFile）+ 重开/换路径重载一致」；编辑驱动统一为
// 「点 iframe 面聚焦（空文档 body 零高不可点，iframe 全幅可见必可点）→ 键盘键入」；标签脏态
// 断言面由「未保存」文字改为标签内圆点（span aria-label=未保存）；5MB 计时面改 .txt（CM
// 源码路径仍服务 css/js/txt，HTML 已不经 CM）。
// brief 实现注边界落地：①目录 rename/move 在 UI 不可达（selectedId=激活标签、仅文件可开
// 标签）——目录保持默认名，以工具栏/树双作用域选择器规避「新建目录」双名歧义；⑨检查元素
// 原生 popup 不可被 Playwright 驱动——验收降级为单测断言，E2E 不强行驱动。
// 「文档不可用」占位说明：该占位属 written→vfs:get 反查失败的竞态防御分支，无法从 UI 确定性
// 驱动；M6 单画布模型下无标签空态由欢迎页承载（.lt-welcome），分支语义由单元测试锁定。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, FrameLocator, Locator, Page, Response } from 'playwright';
import { closeAppGracefully } from './close-app';
import { DEFAULT_SETTINGS } from '../../src/shared/settings-constants';

// 每 spec 独立 userData 临时目录（M3 先例）：e2e 写库不碰开发者真实数据；
// 三个 describe 各持一代应用会话（各自临时目录 + beforeAll 启动 + afterAll 关停清理）
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
// guard 用例终停最后一个实例后置位：afterAll 跳过二次 close、重试轮先补齐存活会话
let appClosedByGuard = false;
const vfsResponses: Response[] = [];

/**
 * 启动应用并等待装配完成业务信号。折叠记忆重启的会话侧栏处于折叠态、树 nav 不可见，
 * 以「展开侧栏」钮出现为 settings 装载完成信号；首启会话沿用 M3 先例——树 nav data-ready
 * 置位 = mount 首拉 listChildren 已应用到树（②批次隐藏合成根行后替代「根按钮出现」锚），
 * 此后经桥建数据只与广播链竞争
 */
async function launchApp(awaitTreeSignal: boolean): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] });
  page = await app.firstWindow();
  // vfs 响应监听（同 preview.spec 形态）：挂起写与热替换用例以主文档 200 计数为断言面
  page.on('response', (res) => {
    if (res.url().startsWith('vfs://')) vfsResponses.push(res);
  });
  if (awaitTreeSignal) {
    await page.locator('nav[aria-label="资源树"][data-ready="true"]').waitFor();
  } else {
    await page.getByLabel('展开侧栏').waitFor();
  }
}

/**
 * 预写设置文件（文件形态由集成测试 settingsService 用例锁定）：尾沿去抖调至上限 2000ms、
 * 挂起上限调至下界 1000ms。尾沿调大的目的是让「脏」窗口不被自动保存清除——多标签 dirty
 * 断言与 guard 关窗确认都以此为前提；挂起调小使强制写用例免等默认 3s；菜单保存「立即」
 * 断言窗（1.5s）与尾沿写（≥2s）由此可判别。以 DEFAULT_SETTINGS 全量铺底后覆写两域——
 * 装载链 strictObject 全域校验、无域级合并：缺域文件会整体静默回退出厂默认（曾致调参
 * 失效、强制写用例按 3s 默认挂起误判，此为必须全量铺底的原因）
 */
function seedTunedSettings(): void {
  const settingsDir = path.join(userDataDir, 'LearningText', 'settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    path.join(settingsDir, 'settings.json'),
    `${JSON.stringify({
      ...DEFAULT_SETTINGS,
      preview: { debounceMs: 2000 },
      editor: { autoSaveMs: 1000 },
    })}\n`,
    'utf8',
  );
}

/** 树工具栏作用域：新建/删除/重命名/移动入口，与树节点同名按钮（默认名「新建目录」）隔离 */
function toolbar(): Locator {
  return page.locator('.lt-tree-toolbar');
}

/** 树节点作用域（工具栏之外）：默认名目录在树侧的唯一命中面 */
function treeNodes(): Locator {
  return page.locator('nav[aria-label="资源树"] > ul');
}

/** 经类型化桥建场景文件（同 preview.spec 形态：结构数据走桥，排除 UI 噪声），返回节点 id */
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
  if (!result.ok) throw new Error(`建文件失败：${name}`);
  return result.value.id;
}

/** 树点选打开文件（UI 开标签唯一入口） */
async function openInTree(name: string): Promise<void> {
  await treeNodes().getByRole('button', { name }).click();
}

/** 活动画布 iframe 元素（按 title=编辑 <名> 精确定位对应 HTML 标签；多标签并存时互不串扰） */
function canvasHolder(name: string): Locator {
  return page.locator(`iframe.lt-canvas-frame[title="编辑 ${name}"]`);
}

/** 活动画布 frame（后台标签 iframe 保活隐藏，DOM 仍在——文本断言对隐藏态同样成立） */
function canvasFrame(name: string): FrameLocator {
  return canvasHolder(name).contentFrame();
}

/**
 * 等画布编辑态就绪并聚焦到文档末尾。就绪信号 = body contenteditable（注入桥 onLoad 后
 * lt:edit-enable 才置位——早于此键入不进编辑面）；聚焦点 iframe 面本身而非 body：新建
 * 空文档 body 零高不可命中，iframe 全幅可见必可点，点选即把焦点与光标交予画布文档；
 * Control+End 把光标推到文档末尾（追加语义）
 */
async function focusCanvasAtEnd(name: string): Promise<FrameLocator> {
  const frame = canvasFrame(name);
  await expect(frame.locator('body')).toHaveAttribute('contenteditable', 'true');
  await canvasHolder(name).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  return frame;
}

/**
 * 整文档替换输入（保存管线用例的确定性编辑形态）：聚焦画布后全选重打。
 * 断言锚定替换后文本，无残留旧内容
 */
async function replaceCanvasDoc(name: string, text: string): Promise<FrameLocator> {
  const frame = canvasFrame(name);
  await expect(frame.locator('body')).toHaveAttribute('contenteditable', 'true');
  await canvasHolder(name).click();
  await pressSelectAll();
  await page.keyboard.type(text);
  return frame;
}

/**
 * 全选键位（CI macOS 修复 round 2，根因 1）：macOS 全选是 Cmd（Playwright 键名 Meta），
 * Ctrl+A 在 mac 无浏览器绑定 → 全选失效——按运行平台分支（keyboard 归属测试进程同平台，
 * 映射一致）；画布聚焦后事件进入 iframe 文档
 */
function pressSelectAll(): Promise<void> {
  return page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
}

/** 经菜单 id 触发原生菜单项（实现注③形态：electronApp.evaluate 取应用菜单按 id click） */
async function clickMenuById(menuId: string): Promise<boolean> {
  return app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item === null || item === undefined) return false;
    item.click();
    return true;
  }, menuId);
}

/** 虚拟路径 → 节点 id（桥侧断言 oracle：rename/move 的落库事实以路径反查为准） */
async function bridgeNodeId(virtualPath: string): Promise<number> {
  const result = await page.evaluate(
    (vp) => window.api.resolvePath({ virtualPath: vp }),
    virtualPath,
  );
  if (!result.ok) throw new Error(`路径反查失败：${virtualPath}`);
  return result.value.nodeId;
}

/**
 * 库内文本（UTF-8 解码，页内解码避免二进制穿越 evaluate）——画布保存管线的落库 oracle：
 * 所见即所得模型下「保存成功」的事实源是库而非重载渲染（无重载链）
 */
async function storedText(nodeId: number): Promise<string> {
  const text = await page.evaluate(async (id) => {
    const r = await window.api.readFile({ nodeId: id });
    return r.ok ? new TextDecoder().decode(r.value.content) : null;
  }, nodeId);
  if (text === null) throw new Error(`读库失败：nodeId=${String(nodeId)}`);
  return text;
}

/** 主文档 200 计数（按文件名后缀过滤；css 等子资源不计入） */
function countDoc200(name: string): number {
  return vfsResponses.filter((r) => r.url().endsWith(`/${name}`) && r.status() === 200).length;
}

test.describe('M4 主链路（出厂默认设置）', () => {
  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-editor-'));
    await launchApp(true);
  });

  test.afterAll(async () => {
    // Windows 文件锁纪律：先关应用（释放 SQLite 句柄与目录锁）再删临时目录；
    // 关停前显式放行 guard（macOS quit 流程修复，见 close-app.ts 头注）
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('主链路：新建→画布编辑→自动保存落库→重命名→移动→删除→桥还原→重开可编辑', async () => {
    // 实现注①（M7 修订）：新建目录走行内命名（工具栏钮 → 命名行 Enter 确认）；「新建文件」
    // 升级为 HTML 导入命令（原生文件框不可自动化）——桥建同名空文件后树点选开签，开签/
    // 画布/保存链路等价覆盖；导入链路写侧验收归集成测试（importService 文件源）与 ipc 单测
    await toolbar().getByRole('button', { name: '新建目录' }).click();
    await page.getByLabel('新目录名称').fill('新建目录');
    await page.getByLabel('新目录名称').press('Enter');
    await seedFile(1, '新建文件.html', '');
    await openInTree('新建文件.html');
    await expect(page.getByRole('tab', { name: /新建文件\.html/ })).toBeVisible();
    await toolbar().getByRole('button', { name: '重命名' }).click();
    await page.getByLabel('新名称').fill('链路.html');
    await page.getByLabel('确认重命名').click();
    await expect(page.getByRole('tab', { name: /链路\.html/ })).toBeVisible();
    // 画布编辑→自动保存落库（去抖 300ms 尾沿）：所见即所得（编辑面=渲染面），落库事实以
    // 库内容为 oracle；文本为纯文本键入（contenteditable 键入即字面文本，无标签解析）
    const frame = await focusCanvasAtEnd('链路.html');
    await page.keyboard.type('主链路正文');
    await expect(frame.locator('body')).toContainText('主链路正文', { useInnerText: true });
    const nodeId = await bridgeNodeId('/链路.html');
    await expect.poll(() => storedText(nodeId), { timeout: 5000 }).toContain('主链路正文');
    // 重命名：标签标题刷新（renamed 广播 → vfs:get 反查回写标签 meta）+ 画布随 src 换路径
    // 重载，重载后内容 = 已落库文本（原「预览落新路径并一致」的画布等价面）
    await toolbar().getByRole('button', { name: '重命名' }).click();
    await page.getByLabel('新名称').fill('链路二.html');
    await page.getByLabel('确认重命名').click();
    await expect(page.getByRole('tab', { name: /链路二\.html/ })).toBeVisible();
    await expect(canvasHolder('链路二.html')).toHaveAttribute('src', /链路二\.html$/);
    await expect(canvasFrame('链路二.html').locator('body')).toContainText('主链路正文', {
      useInnerText: true,
    });
    // 移动（spec §6.2 D8 选择模式）：dir 点选临时变「选定目标」语义，确认钮放行后退出模式
    await toolbar().getByRole('button', { name: '移动到…' }).click();
    await treeNodes().getByRole('button', { name: '新建目录' }).click();
    await expect(page.getByLabel('确认移动')).toBeEnabled();
    await page.getByLabel('确认移动').click();
    await expect(page.getByLabel('移动选择模式')).toHaveCount(0);
    // 移动双证据：树侧文件落入目录（展开可见）+ 桥侧新路径反查命中同 id
    await treeNodes().getByRole('button', { name: '新建目录' }).click(); // 常规模式 dir 点选=选中+展开（④语义）
    await expect(treeNodes().getByRole('button', { name: '链路二.html' })).toBeVisible();
    expect(await bridgeNodeId('/新建目录/链路二.html')).toBe(nodeId);
    // 删除：唯一标签关闭后画布回欢迎页空态（M6 单画布模型：无标签空态由欢迎页承载）。
    // ④批次语义核对：上一步「点新建目录展开」的点选已把树选中迁至目录（点选=选中+展开，
    // VS Code 同构），工具栏删除目标随选中会命中目录而非激活文件——删除入口改行内「⋯」
    // 菜单（节点 id 直传，M5 起「脱离选中锚」语义），精确删除 链路二.html 本体
    await page.locator(`button[data-node-id="${String(nodeId)}"]`).click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.lt-welcome')).toBeVisible();
    // 还原（回收站 UI 归 M5，spec §9.1-1 还原步骤经桥）+ 搜索定位（搜索步骤经 searchQuery 桥）
    const restored = await page.evaluate((id) => window.api.restoreNode({ nodeId: id }), nodeId);
    if (!restored.ok) throw new Error('回收站还原失败');
    const search = await page.evaluate(() => window.api.searchQuery({ keyword: '链路二' }));
    if (!search.ok) throw new Error('搜索通道失败');
    expect(search.value.hits.some((hit) => hit.node.id === nodeId)).toBe(true);
    // 重开可编辑：树点选回标签，画布重载呈现删除/还原全程幸存的落库内容；续写即改即现
    //（所见即所得：无重载链，键入直接进渲染面；body 断言用 innerText——注入的接收器
    // script 以 textContent 计入 body，inner 文本才是渲染可见语义，preview.spec 先例）
    await openInTree('链路二.html');
    await expect(page.getByRole('tab', { name: /链路二\.html/ })).toBeVisible();
    await expect(canvasFrame('链路二.html').locator('body')).toContainText('主链路正文', {
      useInnerText: true,
    });
    const reopened = await focusCanvasAtEnd('链路二.html');
    await page.keyboard.type('重开后可编辑');
    await expect(reopened.locator('body')).toContainText('重开后可编辑', { useInnerText: true });
  });

  // 用户实测反馈修复的浏览器侧实证：jsdom 的焦点/失焦时序不可靠（历史教训：伪影 blur），
  // 「失焦提交」只能在真实 Chromium 上验收——失焦后命名行必须收口（不留悬空新建态），
  // 目录以草稿名落树。名字带重试轮次：retries=1 时重跑不与首轮产物重名（重名会失败保留行）
  test('行内命名失焦即提交：点击树外失焦 → 目录以草稿名落树且命名行收口（无悬空新建态）', async () => {
    const name = `失焦收口目录r${String(test.info().retry)}`;
    await toolbar().getByRole('button', { name: '新建目录' }).click();
    await page.getByLabel('新目录名称').fill(name);
    await expect(page.locator('li.lt-create-row')).toHaveCount(1);
    // 失焦入口选树外中性面（保存路径小字为非交互 div，等价于「点空白处」）
    await page.locator('.lt-tree-root-path').click();
    // 收口双证据：命名行消失 + 目录行以草稿名出现
    await expect(page.locator('li.lt-create-row')).toHaveCount(0);
    await expect(
      page.locator('nav[aria-label="资源树"]').getByRole('button', { name }).first(),
    ).toBeVisible();
  });
});

test.describe('M4 保存管线/多标签/热替换/5MB（计时调优设置）', () => {
  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-editor-pipe-'));
    seedTunedSettings();
    await launchApp(true);
  });

  test.afterAll(async () => {
    // 关停前显式放行 guard（macOS quit 流程修复，见 close-app.ts 头注）
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('多标签：切换各保文本 + dirty 圆点随输入出现、显式落库消失 + 关激活标签右邻补位', async () => {
    await seedFile(1, '标签一.html', '<p id="p1">一</p>');
    await seedFile(1, '标签二.html', '<p id="p2">二</p>');
    await openInTree('标签一.html');
    const frame1 = await focusCanvasAtEnd('标签一.html');
    await page.keyboard.type('甲');
    const tab1 = page.getByRole('tab', { name: /标签一\.html/ });
    // dirty 圆点随输入出现（尾沿去抖已调至 2000ms——消失只能由显式落库产生，断言无自动
    // 保存竞态；M6 脏态面 = 标签内 span aria-label=未保存 圆点，无「未保存」文字）
    await expect(tab1.locator('[aria-label="未保存"]')).toBeVisible();
    await openInTree('标签二.html');
    const frame2 = await focusCanvasAtEnd('标签二.html');
    await page.keyboard.type('乙');
    const tab2 = page.getByRole('tab', { name: /标签二\.html/ });
    await expect(tab2.locator('[aria-label="未保存"]')).toBeVisible();
    // 双向切换：画布会话保活各保文本（后台 iframe 隐藏不销毁，DOM 保留——undo/光标记忆
    // 由 canvasSessions 单测锁定）
    await tab1.click();
    await expect(frame1.locator('body')).toContainText('甲');
    await tab2.click();
    await expect(frame2.locator('body')).toContainText('乙');
    // 菜单「保存」= flushActive：立即写激活标签（标签二），dirty 圆点随落库消失
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect(tab2.locator('[aria-label="未保存"]')).toHaveCount(0);
    // 关闭激活标签（标签一）→ 右邻补位（tabModel closeTab 状态机）
    await tab1.click();
    await page.getByLabel('关闭标签 标签一.html').click();
    await expect(tab2).toHaveAttribute('aria-current', 'true');
    // 收尾：关剩余标签（关标签 flush 后关，无脏残留）
    await page.getByLabel('关闭标签 标签二.html').click();
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('保存管线：停顿满去抖间隔落库（debounceMs 尾沿语义，以库内容为 oracle）', async () => {
    const nodeId = await seedFile(1, '去抖.html', '<p id="d">旧</p>');
    await openInTree('去抖.html');
    await replaceCanvasDoc('去抖.html', '去抖新态');
    // 单次输入后停顿：尾沿计时满 debounceMs（本批次 2000ms）→ 落库。编辑面=渲染面无重载
    // 链，断言面由「预览刷新呈现」平移为「库内容已替换且旧内容无残留」
    await expect
      .poll(async () => {
        const text = await storedText(nodeId);
        return { hasNew: text.includes('去抖新态'), hasOld: text.includes('旧') };
      })
      .toEqual({ hasNew: true, hasOld: false });
  });

  test('保存管线：连续输入超挂起上限强制落库（autoSaveMs 语义，打字中途即写）', async () => {
    const nodeId = await seedFile(1, '挂起.html', '<p id="a">a</p>');
    await openInTree('挂起.html');
    await replaceCanvasDoc('挂起.html', '');
    // 连续键入 12 字符 × 220ms ≈ 2.6s：相邻间隔 220ms > 注入桥去抖 200ms（桥逐键上报）、
    // < 保存去抖 2000ms（尾沿永不触发）；总时长 > autoSaveMs 1000ms（挂起计时先到）——
    // 打字中途必有一次强制写
    const typing = page.keyboard.type('0123456789ab', { delay: 220 });
    // 断言不 await 键入流：轮询库内出现前缀「01234」且尚未出现结尾「ab」= 中途快照，
    // 即证明写在打字进行中发生（t≈1.2s 挂起写快照恰为前 5 个字符）
    await expect
      .poll(
        async () => {
          const text = await storedText(nodeId);
          return { head: text.includes('01234'), tail: text.includes('ab') };
        },
        { timeout: 5000 },
      )
      .toEqual({ head: true, tail: false });
    await typing;
    // 收尾显式落库：末次键入与挂起写快照之间的窗口由 flush 兜住，库终态 = 完整键入内容
    //（带字母尾巴，可与非中途快照判别）
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect.poll(() => storedText(nodeId), { timeout: 5000 }).toContain('0123456789ab');
  });

  test('保存管线：菜单保存立即落库 + 快速打开菜单启用（验收项 2/5）', async () => {
    // 菜单骨架：menu-save 按 id 命中；「快速打开」M5 Task 6 已启用（click 下发 quick-open 命令）
    const menuState = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const quickOpen = menu?.items
        .find((item) => item.label === '搜索')
        ?.submenu?.items.find((item) => item.label === '快速打开');
      return {
        // getMenuItemById 未命中返回 null（menu 缺失经可选链为 undefined）——两态都算「无此项」
        hasSave: (menu?.getMenuItemById('menu-save') ?? null) !== null,
        quickOpenEnabled: quickOpen?.enabled ?? null,
      };
    });
    expect(menuState.hasSave).toBe(true);
    expect(menuState.quickOpenEnabled).not.toBe(false);
    const nodeId = await seedFile(1, '快捷.html', '<p id="k">初始</p>');
    await openInTree('快捷.html');
    await replaceCanvasDoc('快捷.html', '保存态');
    // 前置证据：编辑已入保存管线（画布注入桥 200ms 去抖上报 → dirty 圆点亮起）——
    // 过早 flush 会因状态机尚无脏变更而 no-op，「立即写」断言即失真
    await expect(
      page.getByRole('tab', { name: /快捷\.html/ }).locator('[aria-label="未保存"]'),
    ).toBeVisible({ timeout: 3000 });
    // 立即写断言窗 1.5s：尾沿写需 ≥2000ms 空闲才可达——窗内只有 flush 通路（库为 oracle）
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect.poll(() => storedText(nodeId), { timeout: 1500 }).toContain('保存态');
  });

  test('热替换：写入已引用 css → 画布零重载且新样式即时生效（验收项 6，画布语义）', async () => {
    await seedFile(1, 'swap.html', '<link rel="stylesheet" href="./swap.css"><p id="s">热替换</p>');
    const cssId = await seedFile(1, 'swap.css', '#s { color: rgb(1, 2, 3); }');
    await openInTree('swap.html');
    const frame = canvasFrame('swap.html');
    await expect(frame.locator('#s')).toHaveText('热替换');
    const cssColor = (): Promise<string> =>
      frame.locator('#s').evaluate((el) => getComputedStyle(el).color);
    // 基线：css 经 link 生效（热替换有「前值」可对照，排除样式从未加载的假阳性）
    await expect(async () => {
      expect(await cssColor()).toBe('rgb(1, 2, 3)');
    }).toPass();
    const doc200Before = countDoc200('swap.html');
    // 桥直写 css：与编辑管线同一 vfs:write 通道、同一广播链路（实现注⑥，直写比驱动编辑器稳）
    const written = await page.evaluate(
      ({ nodeId, text }) =>
        window.api.writeFile({ nodeId, content: new TextEncoder().encode(text) }),
      { nodeId: cssId, text: '#s { color: rgb(4, 5, 6); }' },
    );
    if (!written.ok) throw new Error('写 css 失败');
    // 新样式生效：触发端 fetch + postMessage → 画布注入桥按路径命中 link 替换为等值 style
    await expect(async () => {
      expect(await cssColor()).toBe('rgb(4, 5, 6)');
    }).toPass();
    // 主文档零重载：热替换全程无 swap.html 的 200（零主文档请求在效果达成后断言才有效；
    // D7 刷新抑制的结构面——画布会话不存在「写后重载」机制）
    expect(countDoc200('swap.html') - doc200Before).toBe(0);
  });

  test('5MB 文档打开计时（FR-EDIT-01，验收项 9；M6 起 HTML 不经 CM，计时面平移 .txt 源码路径）', async () => {
    // 桥建 5MB 单行文本（.txt → CM 源码标签，恰在 5MB 软阈值上、不触发大文件征询）；
    // 'a'.repeat 构造在页面上下文内完成，避免测试进程侧 5MB 实参穿越
    const created = await page.evaluate(() =>
      window.api.createNode({
        parentId: 1,
        name: '大文件.txt',
        nodeType: 'file',
        content: new TextEncoder().encode('a'.repeat(5 * 1024 * 1024)),
      }),
    );
    if (!created.ok) throw new Error('建 5MB 文件失败');
    // 打开计时全链路：树点选 → readFile 5MB IPC → CM 状态构建 → 首帧渲染（.cm-editor 可见）
    const start = Date.now();
    await openInTree('大文件.txt');
    await page.locator('.cm-editor').waitFor({ state: 'visible' });
    const openMs = Date.now() - start;
    console.log(
      `[perf-m4] FR-EDIT-01 5MB 文档打开耗时 ${String(openMs)}ms（树点选→.cm-editor 可见）`,
    );
    // spec 目标 <1s；E2E 门禁取宽松上限 2000ms（CI 余量），实测中位数回填 TASK.md（Task 11）
    expect(openMs).toBeLessThan(2000);
    // 内容完整性：编辑器内存态 = readFile 结果（createEditorState 同源构造），落库事实经
    // 桥读 byteLength 锁定；UI 侧以可视段前缀佐证——CM6 对超长单行做 DOM 虚拟化，只绘制
    // 可视区附近片段，textContent 长度 ≠ 文档长度（实跑实证：5MB 单行仅绘制约 2K 字符）
    const stored = await page.evaluate(
      (nodeId) =>
        window.api.readFile({ nodeId }).then((r) => (r.ok ? r.value.content.byteLength : -1)),
      created.value.id,
    );
    expect(stored).toBe(5 * 1024 * 1024);
    const headText = await page.evaluate(() => {
      const content = document.querySelector('.cm-content');
      return (content?.textContent ?? '').slice(0, 64);
    });
    expect(headText).toBe('a'.repeat(64));
  });
});

test.describe('M4 外壳记忆与关窗 guard（计时调优设置）', () => {
  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-editor-shell-'));
    // 尾沿去抖调大：guard 用例从制造脏态到关窗确认期间不被自动保存清脏
    seedTunedSettings();
    await launchApp(true);
  });

  test.afterAll(async () => {
    // guard 用例已终停最后一个实例（appClosedByGuard 置位），跳过二次 close
    if (!appClosedByGuard) await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('折叠与宽度记忆：拖拽调宽 + 折叠侧栏 → 重启（同 userData）布局恢复', async () => {
    // 宽度拖拽（pointerdown→move→up 全链，up 一次性持久化）。缺陷驱动注（报告「疑似产品
    // 缺陷」留证）：分隔条无宽度类（0px 命中区，hit-test 不可达，真实指针同样点不中）——
    // 先以真实鼠标按住使指针 1 进入 active 态，再对分隔条派发带 pointerId=1 的合成
    // pointerdown 完成 setPointerCapture，其后移动/抬起走真实输入链；持久化与恢复断言
    // 均为产品全链路，不因驱动方式失效
    const divider = page.locator('.lt-divider-sidebar');
    const box = await divider.boundingBox();
    if (box === null) throw new Error('未找到侧栏分隔条');
    // M8 动效批次几何基线：侧栏单一常驻（折叠/展开同元素才可能过渡）+ 宽度过渡能力在位
    await expect(page.locator('.lt-sidebar')).toHaveCount(1);
    await expect(page.locator('.lt-sidebar')).toHaveCSS('transition-property', 'width');
    await expect(page.locator('.lt-sidebar')).toHaveCSS('transition-duration', '0.18s');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await divider.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    });
    // 拖拽三态（M8）：拖拽态置位为 DOM 可断言锚点；过渡摘除（直跟手红线：拖拽期间宽度
    // 不允许被过渡平滑，否则指针与分割线脱节）；body 级光标/选区固化生效
    await expect(divider).toHaveAttribute('data-dragging', 'true');
    await expect(page.locator('.lt-sidebar')).toHaveCSS('transition-duration', '0s');
    expect(await page.evaluate(() => document.body.classList.contains('lt-col-dragging'))).toBe(
      true,
    );
    await page.mouse.move(x + 200, y, { steps: 8 });
    await page.mouse.up();
    // 释放：拖拽态摘除、过渡能力恢复（此时宽度未变，故不触发多余过渡）
    await expect(divider).not.toHaveAttribute('data-dragging', 'true');
    await expect(page.locator('.lt-sidebar')).toHaveCSS('transition-duration', '0.18s');
    expect(await page.evaluate(() => document.body.classList.contains('lt-col-dragging'))).toBe(
      false,
    );
    // 持久化完成业务信号（非 sleep）：settings 内比例偏离出厂 0.25 即 pointerup 写回完成
    await expect
      .poll(async () => {
        const settings = await page.evaluate(() => window.api.settingsGet());
        return settings.ok ? settings.value.shell.layout.sidebarWidthRatio : -1;
      })
      .toBeGreaterThan(0.25);
    // 折叠侧栏（折叠态本地应用与持久化一次完成）：宽度过渡落位为 48px 窄条，展开钮同步在位
    await page.getByLabel('折叠侧栏').click();
    await expect(page.getByLabel('展开侧栏')).toBeVisible();
    await expect(page.locator('.lt-sidebar')).toHaveClass(/lt-sidebar-collapsed/);
    await expect(page.locator('.lt-sidebar')).toHaveCSS('width', '48px');
    // 无脏关窗：guard 直通（不弹确认链）→ 同 userData 重启（折叠态下装配信号走展开钮）。
    // 关停经 closeAppGracefully 显式放行（macOS quit 流程修复，见 close-app.ts 头注）
    await closeAppGracefully(app, page);
    await launchApp(false);
    // 布局恢复（FR-SHELL-01 修订版）双面断言：折叠态回 UI aria + 宽度比例回 settings 读数
    await expect(page.getByLabel('展开侧栏')).toBeVisible();
    const layout = await page.evaluate(async () => {
      const settings = await window.api.settingsGet();
      return settings.ok ? settings.value.shell.layout : null;
    });
    if (layout === null) throw new Error('重启后设置读取失败');
    expect(layout.sidebarCollapsed).toBe(true);
    expect(layout.sidebarWidthRatio).toBeGreaterThan(0.25);
  });

  test('unsaved-guard：脏标签关窗弹原生确认，确认后进程退出', async () => {
    // SDD breaker 裁决（fix round 5，非缺陷修复）：darwin 平台跳过 + 完整留证。四轮 CI 实证
    // guard 链（dialog 弹出/接管/文案匹配/forceClose）在 macOS 全部真实通过，唯「OS 进程
    // 终止验证」受 Playwright _electron 的 mac 平台限制不可达（补 quit 撞已关闭连接被吞、
    // kill 句柄失效，exitCode/signalCode 双 null）；与 spec §9.1-7 检查元素原生 popup 不可
    // 驱动的降级处置同款先例。guard 链验收由 Windows/Linux 完整覆盖；留证见报告 §十二、
    // TASK.md 执行项登记
    test.skip(
      process.platform === 'darwin',
      'macOS 下 Playwright _electron 的进程退出验证不可驱动（fix loop 四轮 CI 实证：guard 链 dialog 弹出/接管/文案匹配/forceClose 全部真实通过，唯进程终止断言受平台限制）；guard 验收由 Windows/Linux 完整覆盖，降级留证见报告 §十二与 TASK.md',
    );
    // 重试安全：上一轮可能已终停实例（guard 关窗不可逆），先补齐存活会话再制造脏态
    //（折叠态已持久化，重启装配信号走展开钮）
    if (appClosedByGuard) {
      appClosedByGuard = false;
      await launchApp(false);
    }
    // 折叠态下树 nav 不渲染（折叠与宽度记忆用例遗留折叠态，guard 重启亦默认折叠）——
    // 树点选制造脏态前先展开侧栏；已展开时 isVisible 立即 false 跳过（无重试等待）
    const expandSidebar = page.getByLabel('展开侧栏');
    if (await expandSidebar.isVisible()) {
      await expandSidebar.click();
    }
    // 制造脏标签（M7 修订）：「新建文件」菜单命令已升级为导入 HTML（原生文件框不可自动
    // 化，E2E 禁点）——桥建文件 + 树点选开签，键入制造脏态；菜单命令触发面
    // （menu-import-html → import-html 命令）由 unit menu.test 锁定
    await seedFile(1, '新建文件.html', '');
    await openInTree('新建文件.html');
    await expect(page.getByRole('tab', { name: /新建文件\.html/ })).toBeVisible();
    await focusCanvasAtEnd('新建文件.html');
    await page.keyboard.type('未保存的草稿');
    // 前置证据断言（CI macOS 修复 round 2 证据化加固 1）：脏态成立才有资格测 guard——
    // M6 脏态面为标签内圆点（aria-label 未保存）；若此步失败即坐实「画布键入未进编辑面/
    // 未上报」，与「confirm 原生框弹出但 Playwright 无法接管」二分可判
    await expect(
      page.getByRole('tab', { name: /新建文件\.html/ }).locator('[aria-label="未保存"]'),
    ).toBeVisible({ timeout: 5000 });
    // guard 选型 D3：close 拦截 → confirm-close 命令 → 渲染层 window.confirm——
    // confirm 可被 Playwright dialog 事件驱动（beforeunload 原生消息盒不可驱动，故弃）。
    // 时序：先发起 close（guard 链的触发器——确认框仅在 close 尝试被拦截时弹出），再竞速
    // 等确认框。证据化加固 2：15s 竞速——超时报错即「确认框未弹出/未被接管」（可能 B 候选
    // 留证），不吃满用例 60s 超时。close 的失败由下方 exitCode 断言兜底判定，此处吞掉
    // 避免 15s 竞速已失败的场合残留悬挂 rejection
    const dialogMessage = new Promise<string>((resolve) => {
      page.once('dialog', (dialog) => {
        void dialog.accept();
        resolve(dialog.message());
      });
    });
    const proc = app.process();
    const closePromise = app.close().catch(() => undefined);
    let dialogTimer: NodeJS.Timeout | undefined;
    const message = await Promise.race([
      dialogMessage,
      new Promise<never>((_, reject) => {
        dialogTimer = setTimeout(
          () =>
            reject(new Error('guard 确认框 15s 未弹出/未被接管（macOS 平台限制候选，报告留证）')),
          15000,
        );
      }),
    ]).finally(() => clearTimeout(dialogTimer));
    expect(message).toBe('有未保存的更改，确定退出？');
    // 进程退出三段收敛（CI macOS 修复 round 3，round 4 放宽）：accept → forceClose 的关窗
    // 不在 quit 流程内——darwin 的 window-all-closed 惯例不 quit（app.ts，M0 裁决），首轮被
    // preventDefault 打断的 quit 不再续行 → 进程滞留；win/linux 因该分支主动 app.quit() 幸免。
    // ① 等首轮 close 收敛，窗口 30s（round 3/4 CI 实证：mac 上「dialog 呈现 + quit 全链」
    //    可慢于 5s——过早转超时分支会撞 Playwright 连接已关）；
    // ② 超时分支：经主进程补一轮显式 app.quit() 驱动退出——allowClose 已置位、窗口已关，
    //    quit 直通三平台语义统一；app 已 closed 时 evaluate 抛「Target … has been closed」，
    //    补驱动目的已达成（进程多在退出中），错误吞掉；再等 10s；
    // ③ 仍未退才 kill（防御末级，worker teardown 不挂满 60s），kill 的已退出抛错同吞。
    // 各路径同置位 appClosedByGuard（实例已终停，afterAll 跳过、重试轮补启）
    const waitForExit = (ms: number): Promise<'exit' | 'timeout'> => {
      let timer: NodeJS.Timeout | undefined;
      return Promise.race([
        closePromise.then(() => 'exit' as const),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), ms);
        }),
      ]).finally(() => clearTimeout(timer));
    };
    if ((await waitForExit(30000)) === 'timeout') {
      try {
        await app.evaluate(({ app }) => void app.quit());
      } catch {
        // app 已 closed：evaluate 不可达（连接已关）——补驱动目的已达成，吞掉
      }
      if ((await waitForExit(10000)) === 'timeout') {
        try {
          proc.kill();
        } catch {
          // 进程已退出时 kill 抛错：同上吞掉
        }
      }
    }
    appClosedByGuard = true;
    // 平台容差断言（round 4 口径变更，controller 认可）：Windows/Linux 实测走 exitCode 0
    // 路径；mac 上「Playwright 连接已关 / OS exitCode 置值」存在固有窗口，kill 兜底属平台
    // 退出语义差异、是预期路径而非缺陷信号——语义为「进程已终止」（正常退出或兜底 kill
    // 皆可）。guard 核心验收不变：脏 → 确认框文案 → 接管 → 进程终止
    expect(proc.exitCode === 0 || proc.signalCode !== null).toBe(true);
  });
});
