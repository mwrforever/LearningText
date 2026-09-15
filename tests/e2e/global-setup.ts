// E2E 全局前置构建：e2e 以生产形态（dist/ 产物）启动应用，全局前置构建保证
// 干净检出下 `npm test` 无需手动 build 即可通过，本地与 CI 语义一致（宪法 C.4「同一入口」）
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  // 完整生产构建（主进程 tsc + preload rolldown + 渲染层 vite build），失败即中止 e2e
  execSync('npm run build', { stdio: 'inherit' });
}
