// 产物目录与 base 按宪法 B.1 裁决：dist/renderer + 相对路径（适配 app:// 子路径加载）
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// shadcn components.json aliases 对齐的路径映射（与 tsconfig.renderer.json paths 双写，
// 宪法 A.7-6/short：@components/@lib 指向渲染层 src，供 shadcn add 产码与业务 import 共用）
const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url));

export default defineConfig({
  // Tailwind v4 CSS-first 装配（M5 Task 1）：插件扫描渲染层源码按需产出工具类
  plugins: [tailwindcss()],
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@components': `${rendererSrc}/components`,
      '@lib': `${rendererSrc}/lib`,
    },
  },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
