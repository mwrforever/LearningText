// vfs:// 解析纯函数（spec §2.2/§2.3/§3.2 D1/D6/D7）：越界无 clamp、%2F 不作分隔、
// 单区间 Range 语义（多区间忽略）、ETag 弱比较含逗号列表与 *
import { describe, expect, it } from 'vitest';
import { etagOf, ifNoneMatch, parseRange, parseVfsUrl } from '../../../src/main/protocol/vfsParse';

describe('parseVfsUrl', () => {
  it('普通虚拟路径还原：去前导根标记后逐段拼接', () => {
    expect(parseVfsUrl('vfs:///笔记/web/index.html')).toEqual({
      kind: 'file',
      virtualPath: '/笔记/web/index.html',
    });
  });

  it('query 与 fragment 剥离不参与身份（spec §2.1）', () => {
    expect(parseVfsUrl('vfs:///a.html?v=1#top')).toEqual({ kind: 'file', virtualPath: '/a.html' });
  });

  it('规范编码点段被解析器归一为根内路径（WHATWG path state 单机制，与字面点段同规则）', () => {
    // %2E 与 %2e%2e 属 single/double-dot path segment（ASCII 大小写不敏感），解析器
    // 先行归一且不越根——越界形态到不了处理器，无 clamp 无逃逸（Node 24 探针实证）
    expect(parseVfsUrl('vfs:///%2E%2E/a')).toEqual({ kind: 'file', virtualPath: '/a' });
    expect(parseVfsUrl('vfs:///a/%2e%2e/b')).toEqual({ kind: 'file', virtualPath: '/b' });
    expect(parseVfsUrl('vfs:///a/%2E/b')).toEqual({ kind: 'file', virtualPath: '/a/b' });
  });

  it('空段形态（连续斜杠/尾斜杠/根请求）解析器不归一，处理器残防线一律 invalid，不 clamp', () => {
    for (const u of ['vfs:///a//b', 'vfs:///a/', 'vfs:///']) {
      expect(parseVfsUrl(u).kind).toBe('invalid');
    }
  });

  it('残防线可达非死代码：解析器不归一的残缺编码段（URIError）仍被处理器拒绝', () => {
    // 混合字面点与编码点且编码残缺（.%2e%）——解析器原样保留该段，逐段 decode 抛
    // URIError → invalid（残防线「非法百分号编码」分支可达性的实证形态；点段检查已因
    // 穷举不可达移除，见 vfsParse 函数 doc）
    expect(parseVfsUrl('vfs:///a/.%2e%/b').kind).toBe('invalid');
    // 探针实证对照：良构混合点段 .%2e. 解码为 `...`（三点，非 '.'/'..'），按普通段名
    // 放行为 file——查库不中由调用侧 404，属根内路径无逃逸
    expect(parseVfsUrl('vfs:///a/.%2e./b')).toEqual({ kind: 'file', virtualPath: '/a/.../b' });
  });

  it('字面点段在到达处理器前已被 standard scheme 解析器 remove-dot-segments 归一且不越根（浏览器同款，无逃逸面）', () => {
    expect(parseVfsUrl('vfs:///a/../b.html')).toEqual({ kind: 'file', virtualPath: '/b.html' });
    expect(parseVfsUrl('vfs:///../../b.html')).toEqual({ kind: 'file', virtualPath: '/b.html' });
  });

  it('%2F 保持段内字面量不作分隔符：decode 后含斜杠仍 file（查库不中由调用侧 404）', () => {
    expect(parseVfsUrl('vfs:///a%2Fb.txt')).toEqual({ kind: 'file', virtualPath: '/a/b.txt' });
  });

  it('host 形态与非法编码拒绝（standard scheme 身份只认路径）', () => {
    expect(parseVfsUrl('vfs://evil/a.html').kind).toBe('invalid');
    expect(parseVfsUrl('vfs:///%E4%A').kind).toBe('invalid'); // 截断的 UTF-8 序列
    expect(parseVfsUrl('not-a-url').kind).toBe('invalid');
  });

  it('不透明路径（vfs:x）与裸 scheme 空路径（vfs://）无根标记段，一律 invalid', () => {
    // vfs:x 经 URL 解析为不透明路径（pathname='x' 不以 '/' 开头），首段非根标记 → invalid
    expect(parseVfsUrl('vfs:x').kind).toBe('invalid');
    // vfs:// 的 pathname 为空串，弹出根标记后无任何剩余段 → invalid（注意 vfs:/// 的
    // pathname 为 '/'，死于上方空段检查，与本例走的是不同分支）
    expect(parseVfsUrl('vfs://').kind).toBe('invalid');
  });
});

describe('parseRange', () => {
  it('无头/多区间/非 bytes 单位/语法残缺 → full（忽略 Range 按 200，RFC 7233 允许的降级）', () => {
    expect(parseRange(null, 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=0-1,3-4', 100)).toEqual({ kind: 'full' });
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=-', 100)).toEqual({ kind: 'full' }); // 无意义空双端，按无 Range
    expect(parseRange('bytes=', 100)).toEqual({ kind: 'full' }); // 无连字符，区间语法残缺
    expect(parseRange('bytes=a-b', 100)).toEqual({ kind: 'full' }); // 端点含非数字
    expect(parseRange('bytes=1-2-3', 100)).toEqual({ kind: 'full' }); // 多连字符，超区间语法
  });

  it('单区间：有界/开放端/后缀三形态，end 钳到 size-1', () => {
    expect(parseRange('bytes=10-20', 100)).toEqual({ kind: 'partial', start: 10, end: 20 });
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'partial', start: 90, end: 99 });
    expect(parseRange('bytes=-30', 100)).toEqual({ kind: 'partial', start: 70, end: 99 });
    expect(parseRange('bytes=50-999', 100)).toEqual({ kind: 'partial', start: 50, end: 99 });
  });

  it('语法合法但不满足 → unsatisfiable（416）；start≥size、start>end、空文档全区间与后缀', () => {
    expect(parseRange('bytes=100-120', 100).kind).toBe('unsatisfiable');
    expect(parseRange('bytes=20-10', 100).kind).toBe('unsatisfiable');
    expect(parseRange('bytes=0-10', 0).kind).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100).kind).toBe('unsatisfiable');
    expect(parseRange('bytes=-30', 0).kind).toBe('unsatisfiable'); // 空文档后缀区间：钳长 min(30, 0)=0 不可满足
  });
});

describe('ETag 弱比较（spec §2.3 D6）', () => {
  it('etagOf 生成 W/"hash" 弱校验器', () => {
    expect(etagOf('abc123')).toBe('W/"abc123"');
  });

  it('If-None-Match：null 不匹配、* 匹配、列表与强/弱标签混合均可命中', () => {
    expect(ifNoneMatch(null, 'W/"abc123"')).toBe(false);
    expect(ifNoneMatch('*', 'W/"abc123"')).toBe(true);
    expect(ifNoneMatch('"x", W/"abc123"', 'W/"abc123"')).toBe(true);
    expect(ifNoneMatch('"abc123"', 'W/"abc123"')).toBe(true); // 弱比较忽略强弱标签（RFC 7232 §2.3.2）
    expect(ifNoneMatch('"x"', 'W/"abc123"')).toBe(false);
  });
});
