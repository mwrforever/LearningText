// preload 产物守卫：断言 dist/preload/index.js 是 rolldown 单文件捆绑
// （不含相对 require——sandbox 下多文件 CJS 必坏，M0-Task 11 实测缺陷回归防护）
import { readFileSync } from 'node:fs';

const code = readFileSync('dist/preload/index.js', 'utf8');
if (/require\("\.\.\//.test(code) || /require\('\.\.\//.test(code)) {
  console.error('preload 产物含相对 require：被 tsc 多文件产物覆盖（sandbox 下必坏）');
  process.exit(1);
}
console.log('preload 产物为单文件捆绑，守卫通过');
