/**
 * E2E 关停辅助（CI macOS 修复，run 35467593381）：app.close() 内部走 app.quit()、逐窗触发
 * close 事件——M4 close guard（menu.ts attachWindowCloseGuard）对未放行的 close 一律
 * preventDefault，中止 quit 流程并转 confirm-close 确认链；渲染层应答 forceClose 后窗口
 * 虽经重入关闭，但 darwin 的 window-all-closed 惯例不 quit（app.ts，M0 裁决），被中止的
 * quit 不再续行 → 进程滞留 → Playwright close 超时（Windows/Linux 因该分支主动 quit 幸免）。
 * 故关停前先经桥显式放行：forceClose 置 allowClose 标记并直接关窗，其后 app.close() 发起的
 * quit 无窗可拦、三平台一致退出（darwin 由 close() 的新一轮 quit 收尾）。产品语义零改动——
 * 仅测试基建绕开「关闭动作本身被 guard 当作待确认关闭」的形态差。
 * evaluate 以 5s 竞速 + 吞错兜底：用例已失败的场合页面/进程可能早死（evaluate reject 或
 * 悬挂），不拖长 afterAll——此时 app.close() 照常收尾，用例本体失败信息不受影响。
 */
import type { ElectronApplication, Page } from 'playwright';

export async function closeAppGracefully(app: ElectronApplication, page: Page): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      page.evaluate(() => window.api.forceClose()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('guard 放行超时')), 5000);
      }),
    ]);
  } catch {
    // 页面/进程早死或 5s 超时：吞掉后仍走 close 收尾（失败场合只避免拖时，不改判定）
  } finally {
    clearTimeout(timer);
  }
  // close 10s 竞速 + 吞错（CI macOS 修复 round 4 teardown 防护）：用例已终停实例的场合
  // （如 guard 用例已自行驱动退出），app.close() 对已 closed 的 ElectronApplication 等待
  // 永不到来的退出事件而挂起（round 4 CI 实证 afterAll 拖满 60s 的挂点）——竞速上界保证
  // afterAll 不拖时；进程终止事实由用例内断言与进程自身退出兜底
  let closeTimer: NodeJS.Timeout | undefined;
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise<void>((resolve) => {
      closeTimer = setTimeout(() => resolve(), 10000);
    }),
  ]).finally(() => clearTimeout(closeTimer));
}
