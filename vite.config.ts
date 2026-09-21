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
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    // D28 主 chunk 裁剪（M5 Task 17）：大体积三方库分包出主 chunk——react 系与 CodeMirror
    // 全家（含 @lezer/style-mod 等传递依赖）各成 vendor chunk，其余三方统一 vendor；
    // 口径为「渲染层主 chunk ≤ 800KB（原始体积）」，分包不减总量而是满足主 chunk 口径的手段
    rolldownOptions: {
      output: {
        codeSplitting: {
          // 组按声明序先匹配先得：codemirror/react 优先于兜底 vendor 组
          groups: [
            {
              name: 'vendor-codemirror',
              test: /[\\/]node_modules[\\/](@codemirror|@lezer|style-mod|w3c-keyname|crelt|@marijn)[\\/]/,
            },
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
