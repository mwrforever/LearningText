/**
 * 导出路径纯函数（M5 批次⑥ Task 13，FR-IO-02）：VFS 虚拟路径间的相对链换算与
 * html 内 vfs:// 引用改写。零 IO 零库依赖，供 exportService 消费（宪法 A.7：纯函数
 * 无副作用，测试面与主链路解耦）。
 *
 * relativeFromCommonRoot 的锚定语义：fromVPath/toVPath 为任意同根虚拟路径（前导 '/'
 * 可有可无），输出「引用方所在目录 → 被引用资源」的 POSIX 相对链——共同祖先越深，
 * ../ 越少；跨根引用按引用方目录深度逐级回退。磁盘导出结构与虚拟路径结构同构，
 * 故虚拟路径相对链即磁盘相对链。
 *
 * rewriteVfsRefs 的组合语义：rewrite 回调产出「被引用资源相对导出容器目录的路径」
 * （不在导出子树返回 null），本函数以 relativeFromCommonRoot(selfVPath, 容器 vPath +
 * '/' + 相对路径) 组合出最终写入 html 的相对链接——selfVPath 与 exportedRootVPath
 * 由此参与换算，rewrite 只需做子树内映射查表。
 */

/** 按 '/' 切段并剔除空段（兼容前导 '/' 与根路径 '' 形态） */
function segments(vpath: string): readonly string[] {
  return vpath.split('/').filter((segment) => segment !== '');
}

/**
 * 计算引用方文件到被引用资源的相对路径（共同祖先相对链）。
 * @param fromVPath 引用方文件的虚拟路径（如 '/notes/web/index.html'）
 * @param toVPath 被引用资源的虚拟路径（如 '/notes/assets/a.css'）
 * @returns 相对链：同目录 'a.css'；祖先回退 '../assets/a.css'；向下 'sub/b.css'
 */
export function relativeFromCommonRoot(fromVPath: string, toVPath: string): string {
  const fromDir = segments(fromVPath).slice(0, -1); // 引用方所在目录 = 文件路径去末段
  const to = segments(toVPath);
  const max = Math.min(fromDir.length, to.length);
  let common = 0;
  // 逐段比较求共同祖先深度（虚拟路径无 '.'/'..' 段——validateNodeName 已拒绝，无需点段处理）
  while (common < max && fromDir[common] === to[common]) common += 1;
  const ups = fromDir.length - common;
  const tail = to.slice(common).join('/');
  return ups === 0 ? tail : '../'.repeat(ups) + tail;
}

/** vfs:// 引用字面形态（固定 host `local`，shared VFS_URL_HOST 约定）：捕获路径段，
 *  终止于引号/空白/尖括号/圆括号（attr 引值、CSS url(...) 与未加引号属性三类产出形态） */
const VFS_REF_PATTERN = /vfs:\/\/local\/([^"'\s<>)]+)/g;

/**
 * vfs:// 引用解码兜底：原样查表未命中时按百分号解码再查一次（浏览器与工具常对 CJK
 * 引用做百分号编码，而库内引用以原样为主）；截断编码序列（URIError）回退原串。
 */
function decodeVfsRef(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 改写 html 内全部 vfs://local/<path> 引用为相对路径。
 * @param html 原始 html 文本（text/html 节点 BLOB 按 UTF-8 解码）
 * @param selfVPath 该 html 节点自身的虚拟路径（相对链起点）
 * @param exportedRootVPath 导出容器目录的虚拟路径（rewrite 回调返回值的锚定根）
 * @param rewrite 子树内映射：虚拟路径 → 相对导出容器的路径；不在导出子树返回 null
 * @returns html 改写后文本与双计数：rewritten 成功改写数；missing 越界占位数
 */
export function rewriteVfsRefs(
  html: string,
  selfVPath: string,
  exportedRootVPath: string,
  rewrite: (vpath: string) => string | null,
): { readonly html: string; readonly rewritten: number; readonly missing: number } {
  let rewritten = 0;
  let missing = 0;
  const next = html.replace(VFS_REF_PATTERN, (_match: string, rawPath: string) => {
    // 捕获段补回前导 '/' 还原为规范虚拟路径（URL 形态 vfs://local<virtualPath>，
    // virtualPath 恒以 '/' 开头——vfsParse/vfsUrl 同一约定），rewrite 回调统一收规范路径
    const vpath = `/${rawPath}`;
    // 先原样查表（库内引用主形态），未命中且解码有变化再按解码形态查一次（编码兜底）
    let rel = rewrite(vpath);
    if (rel === null) {
      const decoded = decodeVfsRef(vpath);
      if (decoded !== vpath) rel = rewrite(decoded);
    }
    // 不在导出子树（或子树内映射缺失）：'#' 占位保证 html 结构完整，计数供结果汇总
    if (rel === null) {
      missing += 1;
      return '#';
    }
    rewritten += 1;
    // 还原绝对虚拟路径后走统一相对链换算（磁盘结构与虚拟路径同构，见文件头注）
    return relativeFromCommonRoot(selfVPath, `${exportedRootVPath}/${rel}`);
  });
  return { html: next, rewritten, missing };
}
