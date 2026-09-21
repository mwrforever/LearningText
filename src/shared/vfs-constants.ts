/**
 * VFS 域纯常量（宪法 A.7-5 单一来源）：无 zod 依赖的独立模块。
 * 拆分原因（M5 D28 主 chunk 裁剪）：渲染层仅消费本文件常量——常量与 zod schema 同文件时，
 * 渲染层任一运行时值导入都会把整链 schema（连带 zod 运行时）拖入渲染端 bundle；
 * 常量落 zod-free 模块后渲染层零 schema 运行时（渲染端不校验，契约校验归主进程 handler，A.7）。
 */

/** 50MB 单文件上限（docs/03 §3.2-3），服务层写入前校验 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * vfs:// URL 固定 host 约定（三端共享单一来源）：`vfs://local/<虚拟路径>` 是唯一合法身份。
 * 为什么必须固定 host：Task 8 E2E 探针实证 Blink（GURL）对 standard scheme 的空 authority
 * 形态做「首段提为 host」规范化（`vfs:///probe.html` → `vfs://probe.html/`，与 Node
 * WHATWG URL 不同构），空 host 路径式在导航链路不可达——渲染层产出与主进程解析两侧
 * 都以本常量为身份锚（证据见 .superpowers task-8-report §五）。
 */
export const VFS_URL_HOST = 'local';
