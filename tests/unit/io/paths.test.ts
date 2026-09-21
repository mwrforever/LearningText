// 导出路径纯函数单元测试（M5 批次⑥ Task 13，FR-IO-02）：relativeFromCommonRoot 覆盖
// brief 四类路径（共同祖先各级/跨根/引用自身目录/根引用），rewriteVfsRefs 覆盖单引用/
// 多引用/越界 # 占位/百分号编码解码兜底/非 html 不改写（由调用方门控——本函数不区分 mime）。
// 两函数均零 IO 零库依赖，纯字符串换算。
import { describe, expect, it } from 'vitest';
import { relativeFromCommonRoot, rewriteVfsRefs } from '../../../src/main/io/paths';

describe('relativeFromCommonRoot 共同祖先相对链', () => {
  it('brief 逐字样例：notes/web/index.html 引用同根 assets → ../assets/a.css（前导斜杠有无同构）', () => {
    expect(relativeFromCommonRoot('/notes/web/index.html', '/notes/assets/a.css')).toBe(
      '../assets/a.css',
    );
    expect(relativeFromCommonRoot('notes/web/index.html', 'notes/assets/a.css')).toBe(
      '../assets/a.css',
    );
  });

  it('共同祖先各级：共同目录多深一级，../ 就少一级', () => {
    // 两级共同祖先（/a/b）→ 退一级
    expect(relativeFromCommonRoot('/a/b/pages/x.html', '/a/b/lib/y.css')).toBe('../lib/y.css');
    // 三级共同祖先 → 退两级
    expect(relativeFromCommonRoot('/a/b/c/d.html', '/a/b/c/e/f.css')).toBe('e/f.css');
  });

  it('跨根引用：仅虚根为共同祖先，按引用方目录深度逐级回退', () => {
    expect(relativeFromCommonRoot('/notes/web/index.html', '/assets/a.css')).toBe(
      '../../assets/a.css',
    );
  });

  it('引用自身目录：同级资源直接文件名，无 ../ 前缀', () => {
    expect(relativeFromCommonRoot('/notes/web/index.html', '/notes/web/a.css')).toBe('a.css');
  });

  it('根引用：引用方在根层时输出纯向下路径', () => {
    expect(relativeFromCommonRoot('/index.html', '/assets/a.css')).toBe('assets/a.css');
  });
});

describe('rewriteVfsRefs vfs:// 引用改写', () => {
  it('单引用：改写为相对路径并计 rewritten，无越界', () => {
    const result = rewriteVfsRefs(
      '<link rel="stylesheet" href="vfs://local/notes/assets/a.css">',
      '/notes/web/index.html',
      '',
      (vpath) => (vpath === '/notes/assets/a.css' ? 'notes/assets/a.css' : null),
    );
    expect(result.html).toBe('<link rel="stylesheet" href="../assets/a.css">');
    expect(result.rewritten).toBe(1);
    expect(result.missing).toBe(0);
  });

  it('多引用：逐个改写累计计数，越界引用以 # 占位计 missing', () => {
    const html =
      '<link href="vfs://local/notes/web/s.css">' +
      '<img src="vfs://local/notes/pic.png">' +
      '<a href="vfs://local/outside/x.html">外部</a>';
    const result = rewriteVfsRefs(html, '/notes/web/index.html', '', (vpath) => {
      if (vpath === '/notes/web/s.css') return 'notes/web/s.css';
      if (vpath === '/notes/pic.png') return 'notes/pic.png';
      return null; // 越界（不在导出子树）
    });
    expect(result.html).toContain('href="s.css"');
    expect(result.html).toContain('src="../pic.png"');
    expect(result.html).toContain('href="#"');
    expect(result.rewritten).toBe(2);
    expect(result.missing).toBe(1);
  });

  it('无引用文档原样返回，双计数归零', () => {
    const html = '<p>正文没有 vfs:// 引用</p>';
    const result = rewriteVfsRefs(html, '/notes/index.html', '', () => null);
    expect(result.html).toBe(html);
    expect(result.rewritten).toBe(0);
    expect(result.missing).toBe(0);
  });

  it('百分号编码引用：解码后命中映射照常改写（工具产出的编码形态可达）', () => {
    const result = rewriteVfsRefs(
      '<img src="vfs://local/notes/%E7%AC%94%E8%AE%B0.png">',
      '/notes/web/index.html',
      '',
      (vpath) => (vpath === '/notes/笔记.png' ? 'notes/笔记.png' : null),
    );
    expect(result.html).toBe('<img src="../笔记.png">');
    expect(result.rewritten).toBe(1);
    expect(result.missing).toBe(0);
  });

  it('原样命中优先于解码：字面 % 文件名不受解码兜底误伤', () => {
    const result = rewriteVfsRefs(
      '<img src="vfs://local/notes/a%20b.png">',
      '/notes/index.html',
      '',
      (vpath) => (vpath === '/notes/a%20b.png' ? 'notes/a%20b.png' : null),
    );
    expect(result.html).toBe('<img src="a%20b.png">');
    expect(result.rewritten).toBe(1);
    expect(result.missing).toBe(0);
  });

  it('解码仍不命中（含截断编码序列）→ # 占位计 missing', () => {
    const result = rewriteVfsRefs(
      '<img src="vfs://local/notes/%E7%AC%94.png"><img src="vfs://local/notes/%zz.png">',
      '/notes/index.html',
      '',
      (vpath) => (vpath === '/notes/在.png' ? 'notes/在.png' : null),
    );
    expect(result.html).toBe('<img src="#"><img src="#">');
    expect(result.rewritten).toBe(0);
    expect(result.missing).toBe(2);
  });
});
