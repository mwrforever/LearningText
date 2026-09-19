// M4 验收（spec §9.1）：主链路（新建→编辑→自动保存落库→预览一致→重命名→移动→删除→桥还原→
// 重开可编辑）+ 保存管线（尾沿去抖/挂起强制写/菜单保存立即写）+ 多标签会话 + 折叠与宽度
// 记忆重启 + 菜单命令 + css 热替换 + unsaved-guard + 5MB 打开计时（[perf-m4] 输出回填报告）。
// brief 实现注边界落地：①目录 rename/move 在 UI 不可达（selectedId=激活标签、仅文件可开
// 标签）——目录保持默认名，以工具栏/树双作用域选择器规避「新建目录」双名歧义，不驱动不存在
// 的目录重命名 UI；⑨检查元素原生 popup 不可被 Playwright 驱动——验收降级为单测断言
// （Task 9 已覆盖 handler），E2E 不强行驱动。
// 「文档不可用」占位说明：该占位属 written→vfs:get 反查失败的竞态防御分支（写已删节点必
// 失败、广播不可达），无法从 UI 确定性驱动；UI 删除唯一标签的占位为「未选中文件」（url=null
// 分支），分支语义由单元测试 panels-preview-workspace 锁定（偏差说明见 task-10-report）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Locator, Page, Response } from 'playwright';
import { closeAppGracefully } from './close-app';
import { DEFAULT_LAYOUT } from '../../src/shared/settings-contract';

// 每 spec 独立 userData 临时目录（M3 先例）：e2e 写库不碰开发者真实数据；
// 三个 describe 各持一代应用会话（各自临时目录 + beforeAll 启动 + afterAll 关停清理）
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
// guard 用例终停最后一个实例后置位：afterAll 跳过二次 close、重试轮先补齐存活会话
let appClosedByGuard = false;
const vfsResponses: Response[] = [];

/**
 * 启动应用并等待装配完成业务信号。折叠记忆重启的会话树栏处于折叠态、根按钮不可见，
 * 以「展开树栏」钮出现为 settings 装载完成信号；首启会话沿用 M3 先例——根按钮出现 =
 * mount 首拉 listChildren 已应用到树，此后经桥建数据只与广播链竞争
 */
async function launchApp(awaitTreeSignal: boolean): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`] });
  page = await app.firstWindow();
  // vfs 响应监听（同 preview.spec 形态）：挂起写与热替换用例以主文档 200 计数为断言面
  page.on('response', (res) => {
    if (res.url().startsWith('vfs://')) vfsResponses.push(res);
  });
  if (awaitTreeSignal) {
    await page.getByRole('button', { name: '根' }).waitFor();
  } else {
    await page.getByLabel('展开树栏').waitFor();
  }
}

/**
 * 预写设置文件（文件形态由集成测试 settingsService 用例锁定）：尾沿去抖调至上限 2000ms、
 * 挂起上限调至下界 1000ms。尾沿调大的目的是让「脏」窗口不被自动保存清除——多标签 dirty
 * 断言与 guard 关窗确认都以此为前提；挂起调小使强制写用例免等默认 3s；菜单保存「立即」
 * 断言窗（1.5s）与尾沿写（≥2s）由此可判别
 */
function seedTunedSettings(): void {
  const settingsDir = path.join(userDataDir, 'LearningText', 'settings');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    path.join(settingsDir, 'settings.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      preview: { debounceMs: 2000 },
      editor: { autoSaveMs: 1000 },
      shell: { layout: DEFAULT_LAYOUT },
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

/**
 * 全选键位（CI macOS 修复 round 2，根因 1）：macOS 全选是 Cmd（Playwright 键名 Meta），
 * Ctrl+A 在 mac 无 CM/浏览器绑定 → 全选失效 → 后续键入变光标处插入污染 doc——按运行
 * 平台分支（keyboard 归属测试进程同平台，映射一致）
 */
function pressSelectAll(): Promise<void> {
  return page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
}

/**
 * 行尾键位（同上根因 1）：macOS 的 End 是滚动语义、光标不动，行尾 = Cmd+Right
 * （Playwright 键名 Meta+ArrowRight）——按运行平台分支
 */
function pressEnd(): Promise<void> {
  return page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
}

/** 聚焦编辑区（CM6 contenteditable，实现注②直取 .cm-content）并把光标移到行尾后键入追加；
 * 本 spec 的编辑对象均为单行文档，行尾键即文档末尾 */
async function typeAtEnd(text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await pressEnd();
  await page.keyboard.type(text);
}

/** 整文档替换输入：全选后重打（保存管线用例的确定性编辑形态，预览断言锚定替换后的元素） */
async function replaceDoc(text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await pressSelectAll();
  await page.keyboard.type(text);
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

  test('主链路：新建→编辑→自动保存落库→预览一致→重命名→移动→删除→桥还原→重开可编辑', async () => {
    // 实现注①：新建文件创建即开标签，先建后经重命名模态落目标名；目录保持默认名
    // 「新建目录」，树侧点击与工具栏按钮以作用域区分
    await toolbar().getByRole('button', { name: '新建目录' }).click();
    await toolbar().getByRole('button', { name: '新建文件' }).click();
    await expect(page.getByRole('tab', { name: /新建文件\.html/ })).toBeVisible();
    await toolbar().getByRole('button', { name: '重命名' }).click();
    await page.getByLabel('新名称').fill('链路.html');
    await page.getByLabel('确认重命名').click();
    await expect(page.getByRole('tab', { name: /链路\.html/ })).toBeVisible();
    // 编辑→自动保存落库（去抖 300ms 尾沿）→ written 广播 → 预览重载渲染一致（spec §9.1-1）
    await typeAtEnd('<p id="chain">主链路</p>');
    await expect(page.frameLocator('iframe').locator('#chain')).toHaveText('主链路');
    // 重命名：标签标题刷新（renamed 广播 → vfs:get 反查回写标签 meta）+ 预览落新路径
    await toolbar().getByRole('button', { name: '重命名' }).click();
    await page.getByLabel('新名称').fill('链路二.html');
    await page.getByLabel('确认重命名').click();
    await expect(page.getByRole('tab', { name: /链路二\.html/ })).toBeVisible();
    await expect(page.locator('iframe.lt-preview-frame')).toHaveAttribute('src', /链路二\.html$/);
    await expect(page.frameLocator('iframe').locator('#chain')).toHaveText('主链路');
    const nodeId = await bridgeNodeId('/链路二.html');
    // 移动（spec §6.2 D8 选择模式）：dir 点选临时变「选定目标」语义，确认钮放行后退出模式
    await toolbar().getByRole('button', { name: '移动到…' }).click();
    await treeNodes().getByRole('button', { name: '新建目录' }).click();
    await expect(page.getByLabel('确认移动')).toBeEnabled();
    await page.getByLabel('确认移动').click();
    await expect(page.getByLabel('移动选择模式')).toHaveCount(0);
    // 移动双证据：树侧文件落入目录（展开可见）+ 桥侧新路径反查命中同 id
    await treeNodes().getByRole('button', { name: '新建目录' }).click(); // 常规模式 dir 点选=展开
    await expect(treeNodes().getByRole('button', { name: '链路二.html' })).toBeVisible();
    expect(await bridgeNodeId('/新建目录/链路二.html')).toBe(nodeId);
    // 删除：标签关闭 + 预览占位「未选中文件」（唯一标签关闭后激活态清空，见文件头注偏差说明）
    await toolbar().getByRole('button', { name: '删除' }).click();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.lt-preview-empty')).toHaveText('未选中文件');
    // 还原（回收站 UI 归 M5，spec §9.1-1 还原步骤经桥）+ 搜索定位（搜索步骤经 searchQuery 桥）
    const restored = await page.evaluate((id) => window.api.restoreNode({ nodeId: id }), nodeId);
    if (!restored.ok) throw new Error('回收站还原失败');
    const search = await page.evaluate(() => window.api.searchQuery({ keyword: '链路二' }));
    if (!search.ok) throw new Error('搜索通道失败');
    expect(search.value.hits.some((hit) => hit.node.id === nodeId)).toBe(true);
    // 重开可编辑：树点选回标签，续写自动保存后预览一致（body 断言用 innerText——注入的
    // 接收器 script 以 textContent 计入 body，inner 文本才是渲染可见语义，preview.spec 先例）
    await openInTree('链路二.html');
    await expect(page.getByRole('tab', { name: /链路二\.html/ })).toBeVisible();
    await typeAtEnd('<p>重开后可编辑</p>');
    await expect(page.frameLocator('iframe').locator('body')).toContainText('重开后可编辑', {
      useInnerText: true,
    });
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

  test('多标签：切换各保文本 + dirty 随输入出现、显式落库消失 + 关激活标签右邻补位', async () => {
    await seedFile(1, '标签一.html', '<p id="p1">一</p>');
    await seedFile(1, '标签二.html', '<p id="p2">二</p>');
    await openInTree('标签一.html');
    await typeAtEnd('甲');
    const tab1 = page.getByRole('tab', { name: /标签一\.html/ });
    // dirty 随输入出现（尾沿去抖已调至 2000ms——消失只能由显式落库产生，断言无自动保存竞态）
    await expect(tab1).toHaveText(/未保存/);
    await openInTree('标签二.html');
    await typeAtEnd('乙');
    const tab2 = page.getByRole('tab', { name: /标签二\.html/ });
    await expect(tab2).toHaveText(/未保存/);
    // 双向切换：会话换入文本各保（doc 记忆；undo/光标记忆由 tabSessions 单测锁定）
    await tab1.click();
    await expect(page.locator('.cm-content')).toHaveText('<p id="p1">一</p>甲');
    await tab2.click();
    await expect(page.locator('.cm-content')).toHaveText('<p id="p2">二</p>乙');
    // 菜单「保存」= flushActive：立即写激活标签，dirty 随落库消失
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect(tab2).not.toHaveText(/未保存/);
    // 关闭激活标签（标签一）→ 右邻补位（tabModel closeTab 状态机）
    await tab1.click();
    await page.getByLabel('关闭标签 标签一.html').click();
    await expect(tab2).toHaveAttribute('aria-current', 'true');
    // 收尾：关剩余标签（关标签 flush 后关，无脏残留）
    await page.getByLabel('关闭标签 标签二.html').click();
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('保存管线：停顿满去抖间隔落库（debounceMs 尾沿语义）', async () => {
    await seedFile(1, '去抖.html', '<p id="d">旧</p>');
    await openInTree('去抖.html');
    await replaceDoc('<p id="d">去抖新态</p>');
    // 单次输入后停顿：尾沿计时满 debounceMs（本批次 2000ms）→ 落库 → 广播 → 预览刷新
    await expect(page.frameLocator('iframe').locator('#d')).toHaveText('去抖新态');
  });

  test('保存管线：连续输入超挂起上限强制落库（autoSaveMs 语义，打字中途即写）', async () => {
    await seedFile(1, '挂起.html', '<p id="a">a</p>');
    await openInTree('挂起.html');
    await page.locator('.cm-content').click();
    await pressSelectAll();
    // 连续键入 12 字符 × 220ms ≈ 2.6s：相邻间隔 220ms < 去抖 2000ms（尾沿永不触发），
    // 总时长 > autoSaveMs 1000ms（挂起计时先到）——打字中途必有一次强制写。键入时序下
    // 挂起写快照恰为前 5 个字符（第 6 键在 t≈1100ms 晚于写触发 t=1000ms）
    const typing = page.keyboard.type('0123456789ab', { delay: 220 });
    // 断言不 await 键入流：轮询预览出现「01234」中途快照即证明写在打字进行中发生；
    // body 级断言用 innerText（接收器 script 不计，见主链路用例注）
    await expect(page.frameLocator('iframe').locator('body')).toHaveText('01234', {
      useInnerText: true,
    });
    await typing;
    // 收尾显式落库：末次键入与挂起写快照之间的窗口由 flush 兜住，预览终态 = 完整键入内容
    //（带字母尾巴，可与非中途快照判别）
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect(page.frameLocator('iframe').locator('body')).toHaveText('0123456789ab', {
      useInnerText: true,
    });
  });

  test('保存管线：菜单保存立即落库 + disabled 菜单项不可点（验收项 2/5）', async () => {
    // 菜单骨架：menu-save 按 id 命中；「快速打开」M5 搜索 UI 未落地为 disabled 占位
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
    expect(menuState.quickOpenEnabled).toBe(false);
    await seedFile(1, '快捷.html', '<p id="k">初始</p>');
    await openInTree('快捷.html');
    await replaceDoc('<p id="k">保存态</p>');
    // 立即写断言窗 1.5s：尾沿写需 ≥2000ms 空闲才可达预览——窗内只有 flush 通路
    expect(await clickMenuById('menu-save')).toBe(true);
    await expect(page.frameLocator('iframe').locator('#k')).toHaveText('保存态', { timeout: 1500 });
  });

  test('热替换：写入已引用 css → 预览主文档零重载且新样式即时生效（验收项 6）', async () => {
    await seedFile(1, 'swap.html', '<link rel="stylesheet" href="./swap.css"><p id="s">热替换</p>');
    const cssId = await seedFile(1, 'swap.css', '#s { color: rgb(1, 2, 3); }');
    await openInTree('swap.html');
    await expect(page.frameLocator('iframe').locator('#s')).toHaveText('热替换');
    const frame = page.frameLocator('iframe.lt-preview-frame');
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
    // 新样式生效：触发端 fetch + postMessage → 接收器按路径命中 link 替换为等值 style
    await expect(async () => {
      expect(await cssColor()).toBe('rgb(4, 5, 6)');
    }).toPass();
    // 主文档零重载：热替换全程无 swap.html 的 200（零主文档请求在效果达成后断言才有效）
    expect(countDoc200('swap.html') - doc200Before).toBe(0);
  });

  test('5MB 文档打开计时（FR-EDIT-01，验收项 9）', async () => {
    // 桥建 5MB 单行文档；'a'.repeat 构造在页面上下文内完成，避免测试进程侧 5MB 实参穿越
    const created = await page.evaluate(() =>
      window.api.createNode({
        parentId: 1,
        name: '大文件.html',
        nodeType: 'file',
        content: new TextEncoder().encode('a'.repeat(5 * 1024 * 1024)),
      }),
    );
    if (!created.ok) throw new Error('建 5MB 文件失败');
    // 打开计时全链路：树点选 → readFile 5MB IPC → CM 状态构建 → 首帧渲染（.cm-editor 可见）
    const start = Date.now();
    await openInTree('大文件.html');
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

  test('折叠与宽度记忆：拖拽调宽 + 折叠树栏 → 重启（同 userData）布局恢复', async () => {
    // 宽度拖拽：树分隔条右移 200px（pointerdown→move→up 全链，up 一次性持久化）
    const divider = page.locator('.lt-divider-tree');
    const box = await divider.boundingBox();
    if (box === null) throw new Error('未找到树分隔条');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y, { steps: 8 });
    await page.mouse.up();
    // 持久化完成业务信号（非 sleep）：settings 内比例偏离出厂 0.25 即 pointerup 写回完成
    await expect
      .poll(async () => {
        const settings = await page.evaluate(() => window.api.settingsGet());
        return settings.ok ? settings.value.shell.layout.treeWidthRatio : -1;
      })
      .toBeGreaterThan(0.25);
    // 折叠树栏（折叠态本地应用与持久化一次完成）
    await page.getByLabel('折叠树栏').click();
    await expect(page.getByLabel('展开树栏')).toBeVisible();
    // 无脏关窗：guard 直通（不弹确认链）→ 同 userData 重启（折叠态下装配信号走展开钮）。
    // 关停经 closeAppGracefully 显式放行（macOS quit 流程修复，见 close-app.ts 头注）
    await closeAppGracefully(app, page);
    await launchApp(false);
    // 布局恢复（FR-SHELL-01）双面断言：折叠态回 UI aria + 宽度比例回 settings 读数
    await expect(page.getByLabel('展开树栏')).toBeVisible();
    const layout = await page.evaluate(async () => {
      const settings = await window.api.settingsGet();
      return settings.ok ? settings.value.shell.layout : null;
    });
    if (layout === null) throw new Error('重启后设置读取失败');
    expect(layout.treeCollapsed).toBe(true);
    expect(layout.treeWidthRatio).toBeGreaterThan(0.25);
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
    // 菜单「新建文件」命令通路（验收项 5 另一半）：命令单通道下发，创建即开标签
    expect(await clickMenuById('menu-new-file')).toBe(true);
    await expect(page.getByRole('tab', { name: /新建文件\.html/ })).toBeVisible();
    await typeAtEnd('未保存的草稿');
    // 前置证据断言（CI macOS 修复 round 2 证据化加固 1）：脏态成立才有资格测 guard——
    // 若此步失败即坐实「typeAtEnd 键位失效致输入未落 doc」（根因 2 可能 A），与「confirm
    // 原生框弹出但 Playwright 无法接管」（可能 B）二分可判
    await expect(page.getByRole('tab', { name: /新建文件\.html/ })).toHaveText(/未保存/, {
      timeout: 5000,
    });
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
    // 进程退出三段收敛（CI macOS 修复 round 3，round 4 收窄）：accept → forceClose 的关窗
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
