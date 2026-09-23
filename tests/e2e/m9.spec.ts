// M9 交互增强验收（docs/03 §4.9 FR-TREE-01/02、FR-IO-03、FR-RENDER-08 修订版、FR-UPDATE-01；
// 设计依据 `docs/design/2026-09-23-M9交互蓝图.md`）——四组用例：
// ① 树焦点与根目录入口（面 B）：目录点选后点树列表空白区清除选中（落点回落根）；路径条
//    点击＝选中根目录（aria-current 点亮，新建落点随根）；pick 模式空白区 no-op（目标只由
//    显式点选改变）。
// ② 树内拖拽移动（面 C，真机指针链）：file 行按下 → 分步位移越阈 → 幽灵出现且合法落点
//    data-drop-target 点亮 → 落下后子树迁移（路径反查同 id）；Esc 中途取消不留残态
//    （幽灵消失、body.lt-tree-dragging 摘除、结构不变）；非法落点（文件行）data-drop-invalid。
// ③ 粘贴导入（FR-IO-03）：剪贴板无文件 → 菜单「粘贴导入」→ toast 克制提示（非错误）；
//    OS 剪贴板可写文件清单的平台（Electron 44 统一映射 text/uri-list）走全链路（写入 →
//    Ctrl+V → 导入计数 toast + 库内路径反查命中），不可写平台 skip（写侧已由集成测试锁定）。
// ④ HTML 画布交互/编辑双态（面 A）：交互态文档自带脚本可用（onclick 生效）；编辑态脚本
//    屏蔽 + 点击表单控件退出编辑（不触发文档 onclick）；就地编辑逐输入落库 + Esc 退出；
//    交互态双击文本直达编辑态；更新入口（FR-UPDATE-01）开发形态：标题栏无标签、设置页
//    「关于」呈开发形态说明且无动作钮。
// 纪律：每 describe 独立 userData 临时目录（mkdtempSync）+ closeAppGracefully 关停 + afterAll
// 成对清理；无硬 sleep；菜单触发走原生 menu id（E2E 既有触发面）；锚点契约见蓝图 §六.3。
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import { closeAppGracefully } from './close-app';

let app: ElectronApplication;
let page: Page;

/** 启动应用并等待装配完成业务信号（树 nav data-ready 置位，M3 先例） */
async function launchApp(dir: string): Promise<void> {
  app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`] });
  page = await app.firstWindow();
  await page.locator('nav[aria-label="资源树"][data-ready="true"]').waitFor();
}

/** 经菜单 id 触发原生菜单项（editor.spec 同款：electronApp.evaluate 取应用菜单按 id click） */
async function clickMenuById(menuId: string): Promise<boolean> {
  return app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (item === null || item === undefined) return false;
    item.click();
    return true;
  }, menuId);
}

/** 虚拟路径 → 节点 id（桥侧落库事实以路径反查为准） */
async function bridgeNodeId(virtualPath: string): Promise<number | null> {
  const result = await page.evaluate(
    (vp) => window.api.resolvePath({ virtualPath: vp }),
    virtualPath,
  );
  return result.ok ? result.value.nodeId : null;
}

test.describe('M9 面 B：树焦点与根目录入口', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m9-tree-'));
    await launchApp(userDataDir);
    // 播种：目录 笔记 + 文件 a.html（桥直建，导入链路已有专测）
    await page.evaluate(() =>
      window.api.createNode({ parentId: 1, name: '笔记', nodeType: 'dir' }),
    );
    await page.evaluate(() =>
      window.api.createNode({
        parentId: 1,
        name: 'a.html',
        nodeType: 'file',
        content: new TextEncoder().encode('<p>甲</p>'),
      }),
    );
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('目录点选后点树列表空白区清除选中（落点回落根），路径条不被误亮', async () => {
    const dirRow = page.getByRole('button', { name: '笔记' });
    await dirRow.click();
    await expect(dirRow).toHaveAttribute('aria-current', 'true');
    const strip = page.locator('button.lt-tree-root-path');
    await expect(strip).not.toHaveAttribute('aria-current', 'true');
    // 点击列表顶部内边距带（p-2 上沿，命中介质=列表自身）
    await page.locator('ul.lt-tree-list').click({ position: { x: 120, y: 4 } });
    await expect(dirRow).not.toHaveAttribute('aria-current', 'true');
    await expect(strip).not.toHaveAttribute('aria-current', 'true');
  });

  test('点击路径条＝选中根目录：aria-current 点亮，新建目录落在根（顶层可见）', async () => {
    const strip = page.locator('button.lt-tree-root-path');
    await strip.click();
    await expect(strip).toHaveAttribute('aria-current', 'true');
    // 树选中=根：行内新建经工具栏进入（上下文父=根），命名提交后目录落在顶层
    await page.getByRole('button', { name: '新建目录' }).click();
    await page.getByLabel('新目录名称').fill('根下新目录');
    await page.getByLabel('新目录名称').press('Enter');
    const created = await bridgeNodeId('/根下新目录');
    expect(created).not.toBeNull();
    await expect(
      page.locator('nav[aria-label="资源树"]').getByRole('button', { name: '根下新目录' }),
    ).toBeVisible();
    await expect(strip).toHaveAttribute('aria-current', 'true');
  });

  test('pick 模式（移动到…）中空白区 no-op：模式保持、目标不被清除，Esc 退出', async () => {
    await page.locator('button[data-node-id]').first().click();
    await page.getByRole('menuitem', { name: '移动到…' }).click();
    await expect(page.getByLabel('移动选择模式')).toBeVisible();
    // pick 模式空白区：不清除、不改变目标（蓝图 B.1/B.6）
    await page.locator('ul.lt-tree-list').click({ position: { x: 120, y: 4 } });
    await expect(page.getByLabel('移动选择模式')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('移动选择模式')).toHaveCount(0);
  });
});

test.describe('M9 面 C：树内拖拽移动', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m9-drag-'));
    await launchApp(userDataDir);
    await page.evaluate(() =>
      window.api.createNode({ parentId: 1, name: '素材', nodeType: 'dir' }),
    );
    await page.evaluate(() =>
      window.api.createNode({
        parentId: 1,
        name: '拖拽文件.html',
        nodeType: 'file',
        content: new TextEncoder().encode('<p>拖拽正文</p>'),
      }),
    );
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('合法拖拽：幽灵出现、落点 data-drop-target 点亮、落下后子树迁移（同 id 换路径）', async () => {
    const source = page.getByRole('button', { name: '拖拽文件.html' });
    const target = page.getByRole('button', { name: '素材' });
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (sourceBox === null || targetBox === null) throw new Error('行包围盒不可用');
    const nodeId = await bridgeNodeId('/拖拽文件.html');
    expect(nodeId).not.toBeNull();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    // 分步位移越阈（≥5px 起拖），幽灵与落点反馈随指针推进
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 - 30, sourceBox.y - 10, { steps: 4 });
    await expect(page.locator('.lt-drag-ghost')).toBeVisible();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 8,
    });
    const targetRow = page.locator('[data-tree-node-id]').filter({ has: target });
    await expect(targetRow).toHaveAttribute('data-drop-target', 'true');
    await page.mouse.up();
    // 落定：同 id 换路径（子树迁移）+ 幽灵收场后卸载 + 全局接管态摘除
    expect(await bridgeNodeId('/素材/拖拽文件.html')).toBe(nodeId);
    expect(await bridgeNodeId('/拖拽文件.html')).toBeNull();
    await expect(page.locator('.lt-drag-ghost')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/lt-tree-dragging/);
  });

  test('Esc 中途取消：幽灵收场、接管态摘除、结构零变更', async () => {
    const source = page.getByRole('button', { name: '素材' });
    const box = await source.boundingBox();
    if (box === null) throw new Error('行包围盒不可用');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + 30, { steps: 4 });
    await expect(page.locator('.lt-drag-ghost')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lt-drag-ghost')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/lt-tree-dragging/);
    // 结构零变更：素材仍在根层
    expect(await bridgeNodeId('/素材')).not.toBeNull();
    expect(await bridgeNodeId('/素材/素材')).toBeNull();
  });
});

test.describe('M9 FR-IO-03：粘贴导入', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m9-paste-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('剪贴板无文件：菜单「粘贴导入」toast 克制提示，不发起导入', async () => {
    // 真机剪贴板内容不可假设：先清空再触发（Electron clipboard.clear）
    await app.evaluate(({ clipboard }) => {
      clipboard.clear();
    });
    expect(await clickMenuById('menu-paste-import')).toBe(true);
    await expect(page.locator('.lt-toast').last()).toContainText('剪贴板中没有可导入的文件');
    // 未发生任何导入：根层无新增节点（树 data-ready 之外无行）
    await expect(page.locator('ul.lt-tree-list [data-tree-node-id]')).toHaveCount(0);
  });

  test('真实系统剪贴板（PowerShell FileDropList）：Ctrl+V 全链路导入；非 Windows skip（写侧由集成测试锁定）', async () => {
    // Electron 44 无法从主进程写文件清单（bookmarks 写入不产生可读 uri-list，探针实证），
    // 改经 OS 原生通道写入真实文件复制格式（Windows: CF_HDROP/uri-list）——与用户在资源
    // 管理器复制文件完全同源；非 Windows 平台 skip（清单解析与导入写链由集成测试覆盖）
    test.skip(process.platform !== 'win32', '真实系统剪贴板写入仅 Windows 驱动');
    const sourcePath = path.join(tmpdir(), 'lt-e2e-paste-source.html');
    writeFileSync(sourcePath, '<p>粘贴正文</p>');
    execSync(`powershell -NoProfile -Command "Set-Clipboard -Path '${sourcePath}'"`);
    await page.keyboard.press('Control+v');
    await expect(page.locator('.lt-toast').last()).toContainText('粘贴导入完成：新增 1');
    await expect(
      page
        .locator('nav[aria-label="资源树"]')
        .getByRole('button', { name: 'lt-e2e-paste-source.html' }),
    ).toBeVisible();
    rmSync(sourcePath, { force: true });
  });
});

test.describe('M9 面 A：HTML 画布交互/编辑双态', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m9-canvas-'));
    await launchApp(userDataDir);
    // 文档自带脚本按钮（CSP script-src 'unsafe-inline' 允许内联脚本，M4 spec §3.2 取舍）
    await page.evaluate(() =>
      window.api.createNode({
        parentId: 1,
        name: '交互.html',
        nodeType: 'file',
        content: new TextEncoder().encode(
          '<button id="doc-btn" type="button">原始</button>' +
            '<p id="doc-p">双击我进入编辑</p>' +
            '<script>document.getElementById("doc-btn").addEventListener("click", function () { this.textContent = "点过了"; });</' +
            'script>',
        ),
      }),
    );
    await page
      .locator('nav[aria-label="资源树"]')
      .getByRole('button', { name: '交互.html' })
      .click();
    await expect(page.locator('iframe.lt-canvas-frame:not(.hidden)')).toHaveAttribute(
      'data-lt-canvas-mode',
      'interact',
    );
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('交互态：文档自带脚本可用，编辑钮 aria-pressed=false 且无提示条', async () => {
    const frame = page.frameLocator('iframe[title="文档 交互.html"]');
    await frame.locator('#doc-btn').click();
    await expect(frame.locator('#doc-btn')).toHaveText('点过了');
    await expect(page.locator('button.lt-canvas-edit-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.locator('.lt-canvas-edit-banner')).toHaveCount(0);
  });

  test('编辑态：脚本屏蔽（点表单控件退出编辑且不触发文档 onclick），Esc/工具条可退出', async () => {
    await page.locator('button.lt-canvas-edit-toggle').click();
    const holder = page.locator('iframe[title="文档 交互.html"]');
    await expect(holder).toHaveAttribute('data-lt-canvas-mode', 'edit');
    await expect(page.locator('.lt-canvas-edit-banner')).toBeVisible();
    const frame = page.frameLocator('iframe[title="文档 交互.html"]');
    await expect(frame.locator('body')).toHaveAttribute('contenteditable', 'true');
    // 编辑态点击文档按钮：onclick 被闸门屏蔽（文本不变），且表单控件命中=退出编辑
    await frame.locator('#doc-btn').click();
    await expect(page.locator('button.lt-canvas-edit-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.locator('.lt-canvas-edit-banner')).toHaveCount(0);
    await expect(frame.locator('#doc-btn')).toHaveText('点过了'); // 交互态首次点击的结果，未被再次改写
  });

  test('就地编辑：body 落笔键入逐输入落库；Esc 退出还原交互态（无提示条）', async () => {
    await page.locator('button.lt-canvas-edit-toggle').click();
    const holder = page.locator('iframe[title="文档 交互.html"]');
    await expect(holder).toHaveAttribute('data-lt-canvas-mode', 'edit');
    // body 为工具条进入的落笔目标（已聚焦），不点击画布——编辑态点击空白=退出编辑
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.keyboard.type('编辑落库正文');
    const nodeId = await bridgeNodeId('/交互.html');
    if (nodeId === null) throw new Error('节点反查失败：/交互.html');
    await expect
      .poll(async () => {
        const stored = await page.evaluate(async (id) => {
          const r = await window.api.readFile({ nodeId: id });
          return r.ok ? new TextDecoder().decode(r.value.content) : null;
        }, nodeId);
        return stored;
      })
      .toContain('编辑落库正文');
    // 落库序列化剥净注入痕迹（蓝图 R2）
    const stored = await page.evaluate(async (id) => {
      const r = await window.api.readFile({ nodeId: id });
      return r.ok ? new TextDecoder().decode(r.value.content) : '';
    }, nodeId);
    expect(stored).not.toContain('data-lt-');
    expect(stored).not.toContain('contenteditable');
    // Esc 退出（桥内判定 → 回执同步工具条）
    await page.keyboard.press('Escape');
    await expect(page.locator('button.lt-canvas-edit-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.locator('.lt-canvas-edit-banner')).toHaveCount(0);
  });

  test('交互态双击文本直达编辑态（桥内判定 → 回执同步工具条）', async () => {
    const frame = page.frameLocator('iframe[title="文档 交互.html"]');
    await frame.locator('#doc-p').dblclick();
    await expect(page.locator('button.lt-canvas-edit-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('button.lt-canvas-edit-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

test.describe('M9 FR-UPDATE-01：更新入口（开发形态降级）', () => {
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'lt-e2e-m9-update-'));
    await launchApp(userDataDir);
  });

  test.afterAll(async () => {
    await closeAppGracefully(app, page);
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('开发形态：标题栏无更新标签（静默零存在感），设置页「关于」呈开发形态说明且无动作钮', async () => {
    await expect(page.locator('.lt-update-chip')).toHaveCount(0);
    await page.getByRole('button', { name: '设置' }).first().click();
    await page.getByRole('button', { name: '关于' }).click();
    expect(page.locator('.lt-settings-about')).not.toBeNull();
    await expect(page.locator('.lt-settings-version')).toContainText('v');
    await expect(page.locator('.lt-settings-update')).toContainText('开发形态不支持应用内更新');
    await expect(page.getByRole('button', { name: '检查更新' })).toHaveCount(0);
  });
});
