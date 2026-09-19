// M0 验收主链路：应用以生产形态（app:// 协议）启动、界面渲染、类型化 IPC 打通
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import { closeAppGracefully } from './close-app';

// 外层句柄命名 page 而非 window：避免遮蔽 DOM 全局 window——evaluate 回调内的
// window 必须解析到页面全局（类型与运行时语义一致，tsconfig.test 已含全局声明）
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'] });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  // 关停前显式放行 guard（macOS quit 流程修复，见 close-app.ts 头注）
  await closeAppGracefully(app, page);
});

test('应用窗口渲染 LearningText 标题', async () => {
  await expect(page.locator('h1')).toHaveText('LearningText');
});

test('system:ping 全链路返回 ok(pong)', async () => {
  // window.api 类型来自 src/shared/window-api.ts 的全局声明（tsconfig.test 已包含）
  const result = await page.evaluate(() => window.api.ping());
  expect(result).toEqual({ ok: true, value: { pong: true } });
});
