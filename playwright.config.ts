// E2E 稳定性基线（宪法 A.6-4）：retries + 首次重试留痕；CI 禁 .only
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // e2e 验证生产形态 dist/ 产物，全局前置构建保证干净检出下 npm test 语义与 CI 一致
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  trace: 'on-first-retry',
  forbidOnly: process.env.CI === 'true',
  reporter: [['list'], ['html', { open: 'never' }]],
});
