/**
 * origin 白名单判断（宪法 B.5-4）：必须用 URL 解析器取 origin 精确比较，
 * 禁止字符串前缀判断（如 http://localhost:5173.evil.com 的前缀欺骗）。
 * 供 will-navigate 导航拦截（app.ts）消费；IPC 侧为 senderFrame 独立校验，不经本函数。
 * @param url 待校验的完整 URL（来源：webContents 导航事件 / 外部输入，不可信）
 * @param allowedOrigins 允许的 origin 白名单（形如 app://bundle，含协议、host 与端口）
 * @returns true 表示 origin 命中白名单放行；URL 不可解析或 origin 不在白名单一律 false
 */
export function isOriginAllowed(url: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 不可解析的 URL（含 javascript: 等非层次方案）一律拒绝
    return false;
  }
  // WHATWG URL 对 app:// 等非特殊方案（Chromium 侧经 standard 特权有真实 origin，
  // Node/测试侧无 scheme 注册表）把 origin 序列化为字面量 "null"，此时回退用
  // 解析结果中的 protocol + host（含端口、剔除 userinfo）组装等价 origin 参与精确
  // 比较——仍是解析器比较，不构成前缀绕过。注意：非特殊方案的 host 为 opaque host，
  // URL 不做大小写归一（如 app://BUNDLE 的 host 保持大写），大写变体与全小写白名单
  // 不相等而被拒，属有意的 fail-closed 行为（非归一缺陷）。
  const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
  return allowedOrigins.includes(origin);
}
