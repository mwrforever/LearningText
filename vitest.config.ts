// Vitest 5：projects 拆 unit/integration（宪法 A.6-1/2），禁用已废弃的 workspace 文件
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // 渲染层组件测试含 JSX，需同时匹配 .test.tsx（宪法 A.6-1 命名约定不变）
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
          environment: 'node',
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
