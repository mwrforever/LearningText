// vfs:// 解析纯函数（spec §2.2/§2.3/§3.2 D1/D6/D7）：越界无 clamp、%2F 不作分隔、
// 单区间 Range 语义（多区间忽略）、ETag 弱比较含逗号列表与 *
import { describe, expect, it } from 'vitest';
import { etagOf, ifNoneMatch, parseRange, parseVfsUrl } from '../../../src/main/protocol/vfsParse';

describe('parseVfsUrl', () => {
  it('普通虚拟路径还原：固定 host 身份下去根标记后逐段拼接', () => {
    expect(parseVfsUrl('vfs://local/笔记/web/index.html')).toEqual({
      kind: 'file',
      virtualPath: '/笔记/web/index.html',
    });
  });

  it('query 与 fragment 剥离不参与身份（spec §2.1）', () => {
    expect(parseVfsUrl('vfs://local/a.html?v=1#top')).toEqual({
      kind: 'file',
      virtualPath: '/a.html',
    });
  });

  it('身份门只认约定 host local：伪造 host 与空 host 形态一律 invalid（拒绝语义保留）', () => {
    expect(parseVfsUrl('vfs://evil/a.html').kind).toBe('invalid');
    // 空 host 路径式：Node 侧 hostname 为空串即拒；Task 8 探针实证 Blink 发起侧会把同形态
    // 变形为「首段提 host」（vfs:///probe.html → vfs://probe.html/），到达侧同型同拒——两侧闭环
    expect(parseVfsUrl('vfs:///a.html').kind).toBe('invalid');
  });

  it('约定 host 大小写不敏感放行（GURL 对 standard scheme host 规范化为小写，防御性归一锚定）', () => {
    expect(parseVfsUrl('vfs://LOCAL/a.html')).toEqual({ kind: 'file', virtualPath: '/a.html' });
  });

  it('规范编码点段被解析器归一为根内路径（WHATWG path state 单机制，与字面点段同规则）', () => {
    // %2E 与 %2e%2e 属 single/double-dot path segment（ASCII 大小写不敏感），解析器
    // 先行归一且不越根——越界形态到不了处理器，无 clamp 无逃逸（Node 24 探针实证）
    expect(parseVfsUrl('vfs://local/%2E%2E/a')).toEqual({ kind: 'file', virtualPath: '/a' });
    expect(parseVfsUrl('vfs://local/a/%2e%2e/b')).toEqual({ kind: 'file', virtualPath: '/b' });
    expect(parseVfsUrl('vfs://local/a/%2E/b')).toEqual({ kind: 'file', virtualPath: '/a/b' });
  });

  it('空段形态（连续斜杠/尾斜杠/根请求）解析器不归一，处理器残防线一律 invalid，不 clamp', () => {
    for (const u of ['vfs://local/a//b', 'vfs://local/a/', 'vfs://local/']) {
      expect(parseVfsUrl(u).kind).toBe('invalid');
    }
  });

  it('残防线可达非死代码：解析器不归一的残缺编码段（URIError）仍被处理器拒绝', () => {
    // 混合字面点与编码点且编码残缺（.%2e%）——解析器原样保留该段，逐段 decode 抛
    // URIError → invalid（残防线「非法百分号编码」分支可达性的实证形态；点段检查已因
    // 穷举不可达移除，见 vfsParse 函数 doc）
    expect(parseVfsUrl('vfs://local/a/.%2e%/b').kind).toBe('invalid');
    // 截断的 UTF-8 序列，同一 URIError 分支
    expect(parseVfsUrl('vfs://local/%E4%A').kind).toBe('invalid');
    // 探针实证对照：良构混合点段 .%2e. 解码为 `...`（三点，非 '.'/'..'），按普通段名
    // 放行为 file——查库不中由调用侧 404，属根内路径无逃逸
    expect(parseVfsUrl('vfs://local/a/.%2e./b')).toEqual({ kind: 'file', virtualPath: '/a/.../b' });
  });

  it('字面点段在到达处理器前已被 standard scheme 解析器 remove-dot-segments 归一且不越根（浏览器同款，无逃逸面）', () => {
    expect(parseVfsUrl('vfs://local/a/../b.html')).toEqual({
      kind: 'file',
      virtualPath: '/b.html',
    });
    expect(parseVfsUrl('vfs://local/../../b.html')).toEqual({
      kind: 'file',
      virtualPath: '/b.html',
    });
  });

  it('%2F 保持段内字面量不作分隔符：decode 后含斜杠仍 file（查库不中由调用侧 404）', () => {
    expect(parseVfsUrl('vfs://local/a%2Fb.txt')).toEqual({ kind: 'file', virtualPath: '/a/b.txt' });
  });

  it('非 URL 串与 host 缺失形态在身份门拒绝：不透明路径/裸 scheme/裸 host', () => {
    expect(parseVfsUrl('not-a-url').kind).toBe('invalid');
    // 以下两者 hostname 均为空串（host 缺失），身份门即拒——旧口径 vfs:x/vfs:// 走
    // 「首段非根标记」分支，host 门收口后该分支不可达，已按无死分支纪律移除
    expect(parseVfsUrl('vfs:x').kind).toBe('invalid');
    expect(parseVfsUrl('vfs://').kind).toBe('invalid');
    // 裸 host 形态（hostname=local、pathname 空串）：弹出根标记后无任何段 → invalid，
    // 是「decoded 为空」末道检查的唯一可达入口（防该检查沦为死分支）
    expect(parseVfsUrl('vfs://local').kind).toBe('invalid');
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
