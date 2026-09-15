// 产物目录与 base 按宪法 B.1 裁决：dist/renderer + 相对路径（适配 app:// 子路径加载）
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
