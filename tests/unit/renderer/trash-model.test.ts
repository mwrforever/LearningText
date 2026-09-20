// filterTrashed 回收站本地过滤纯函数全分支（M5 批次②）：空关键词全量、名称/原路径
// 包含匹配、大小写不敏感、NFC 归一（分解形关键词命中组合形名称）、无命中空数组
import { describe, expect, it } from 'vitest';
import type { NodeMeta, TrashedNodeMeta } from '../../../src/shared/vfs-contract';
import { filterTrashed } from '../../../src/renderer/src/features/trash/trashModel';

function item(id: number, name: string, virtualPath: string): TrashedNodeMeta {
  const meta: NodeMeta = {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath,
    mimeType: 'text/html',
    size: 4,
    createdAt: '2026-09-20T10:00:00.000+08:00',
    updatedAt: '2026-09-20T10:00:00.000+08:00',
  };
  return { meta, deletedAt: '2026-09-21T09:30:00.000+08:00' };
}

const list: readonly TrashedNodeMeta[] = [
  item(5, '笔记.html', '/笔记/笔记.html'),
  item(6, 'Report.HTML', '/docs/Report.HTML'),
];

describe('filterTrashed 回收站本地过滤', () => {
  it('空关键词返回全量列表（原引用直返，不做复制匹配）', () => {
    expect(filterTrashed(list, '')).toBe(list);
  });

  it('名称包含匹配且大小写不敏感（ABC 命中 abc）', () => {
    const hit = filterTrashed([item(7, 'abc.html', '/x/abc.html')], 'ABC');
    expect(hit.map((t) => t.meta.id)).toEqual([7]);
  });

  it('原路径包含匹配：路径片段命中而名称不含关键词', () => {
    const hit = filterTrashed(list, '/docs');
    expect(hit.map((t) => t.meta.id)).toEqual([6]);
  });

  it('NFC 归一：分解形（NFD）关键词命中组合形（NFC）名称', () => {
    // 'が' 组合形 U+304C 与分解形 U+304B+U+3099 语义同字：过滤两侧 NFC 归一后必须互认
    const composed = filterTrashed([item(8, '\u304C.html', '/x.html')], '\u304C');
    const decomposed = filterTrashed([item(8, '\u304C.html', '/x.html')], '\u304B\u3099');
    expect(composed.map((t) => t.meta.id)).toEqual([8]);
    expect(decomposed.map((t) => t.meta.id)).toEqual([8]);
  });

  it('名称与原路径均不含关键词 → 空数组', () => {
    expect(filterTrashed(list, '不存在')).toEqual([]);
  });
});
