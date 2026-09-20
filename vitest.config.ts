// Vitest 5：projects 拆 unit/integration（宪法 A.6-1/2），禁用已废弃的 workspace 文件
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// shadcn components.json aliases 对齐的路径映射（与 vite.config.resolve.alias 同源双写）：
// 渲染层测试传导引入 shadcn 产码（内部以 @components/@lib 别名互引），vitest 运行时须能解析
const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@components': `${rendererSrc}/components`,
      '@lib': `${rendererSrc}/lib`,
    },
  },
  test: {
    // 宪法 A.6-3：覆盖率门禁与 projects 平级，对 unit + integration 合并计量
    coverage: {
      provider: 'v8',
      // 宪法 A.6-3：显式 include，漏测文件必须计入
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // 核心链路 100%（IPC 接口 / 契约 / 协议路径解析 / 存储原语）
        'src/main/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/shared/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/preload/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          // 渲染层组件测试含 JSX，需同时匹配 .test.tsx（宪法 A.6-1 命名约定不变）
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'node',
          // 全局 setup：jsdom 量测 API stub 等（node/jsdom 双环境共用，环境守卫见 setup 文件）
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
