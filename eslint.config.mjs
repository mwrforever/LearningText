// ESLint 10 仅 flat config（宪法 C.6-4）；Prettier 集成只用 eslint-config-prettier
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'release/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // vitest 缓存产物目录，与其他测试产物目录一并排除
      '.vitest/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TS 编译器已接管未定义变量检查，关闭 no-undef 防止 DOM 全局误报
      'no-undef': 'off',
      // 宪法 A.1-3 / A.1-5：禁 any、禁非空断言
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // scripts/ 下为 Node 运行环境的构建守卫脚本（.mjs），需补充 Node 全局，
    // 否则 js.configs.recommended 的 no-undef 会误报 console / process
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  prettier,
);
