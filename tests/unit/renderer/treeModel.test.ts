// 广播→树最小同步集（spec §4.3）：created/restored 插入、trashed/purged 移除、
// written 刷新 meta、renamed/moved 标记受影响子树 stale（懒重取）
import { describe, expect, it } from 'vitest';
import type { NodeMeta, VfsChangedBroadcast } from '../../../src/shared/vfs-contract';
import {
  applyBroadcast,
  collectStaleExpanded,
  findNode,
  isDescendant,
  makeTreeRoot,
  withChildren,
  canDropOn,
} from '../../../src/renderer/src/features/tree/treeModel';

function meta(id: number, parentId: number, name: string): NodeMeta {
  return {
    id,
    parentId,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType: 'text/html',
    size: 1,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}
const bcast = (event: VfsChangedBroadcast['event'], rev = 1): VfsChangedBroadcast => ({
  rev,
  event,
});
const dirNode = (
  id: number,
  parentId: number,
  name: string,
  children: readonly NodeMeta[] = [],
) => {
  let t = makeTreeRoot({ ...meta(id, parentId, name), nodeType: 'dir' });
  t = withChildren(
    t,
    children.map((c) => makeTreeRoot(c)),
  );
  return t;
};

describe('treeModel applyBroadcast', () => {
  it('created 且父已加载→插入；父未加载→不动（懒加载语义）', () => {
    const tree = [dirNode(2, 1, '笔记')];
    const after = applyBroadcast(tree, bcast({ type: 'created', node: meta(3, 2, 'a.html') }));
    expect(findNode(after, 3)).not.toBeNull();
    const miss = applyBroadcast(tree, bcast({ type: 'created', node: meta(4, 99, 'x.html') }));
    expect(findNode(miss, 4)).toBeNull();
  });

  it('written 刷新命中节点 meta；trashed 移除；restored 插入', () => {
    let tree: ReturnType<typeof applyBroadcast> = [dirNode(2, 1, '笔记', [meta(3, 2, 'a.html')])];
    tree = applyBroadcast(
      tree,
      bcast({ type: 'written', node: { ...meta(3, 2, 'a.html'), size: 99 } }),
    );
    expect(findNode(tree, 3)?.meta.size).toBe(99);
    tree = applyBroadcast(tree, bcast({ type: 'trashed', nodeId: 3, affectedCount: 1 }));
    expect(findNode(tree, 3)).toBeNull();
    tree = applyBroadcast(tree, bcast({ type: 'restored', node: meta(3, 2, 'a.html') }));
    expect(findNode(tree, 3)).not.toBeNull();
  });

  it('renamed/moved 标记该节点及子孙 stale；purged 移除整子树', () => {
    const tree = [dirNode(2, 1, '笔记', [meta(3, 2, 'a.html')])];
    const after = applyBroadcast(tree, bcast({ type: 'renamed', nodeId: 2, affectedCount: 2 }));
    const node = findNode(after, 2);
    expect(node?.stale).toBe(true);
    expect(collectStaleExpanded(after, new Set([1, 2]))).toEqual([2]); // 已展开的 stale 节点待重取
    const purged = applyBroadcast(tree, bcast({ type: 'purged', nodeId: 2, purgedCount: 2 }));
    expect(purged).toHaveLength(0);
  });

  it('moved/renamed 连带树内直父 stale（旧父层重取清除已移走/旧名副本），无直父（顶层）只标自身', () => {
    // 结构：根层 [笔记(2){a.html(3)}, 兄弟(5)]——moved(3) 时直父 笔记(2) 与自身 3 同批 stale，
    // 兄弟(5) 与更上层不波及
    const tree = [
      withChildren(makeTreeRoot({ ...meta(2, 1, '笔记'), nodeType: 'dir' }), [
        makeTreeRoot(meta(3, 2, 'a.html')),
      ]),
      makeTreeRoot({ ...meta(5, 1, '兄弟'), nodeType: 'dir' }),
    ];
    const after = applyBroadcast(tree, bcast({ type: 'moved', nodeId: 3, affectedCount: 1 }));
    expect(findNode(after, 3)?.stale).toBe(true); // 自身（子孙路径展示重取）
    expect(findNode(after, 2)?.stale).toBe(true); // 树内直父（旧落点副本清除依赖父层重取）
    expect(findNode(after, 5)?.stale).toBe(false); // 兄弟分支不波及
    // 顶层节点（合成根不rendered 但可能在树中）无直父：只标自身不误标同层
    const topAfter = applyBroadcast(tree, bcast({ type: 'renamed', nodeId: 5, affectedCount: 1 }));
    expect(findNode(topAfter, 5)?.stale).toBe(true);
    expect(findNode(topAfter, 2)?.stale).toBe(false);
    expect(collectStaleExpanded(topAfter, new Set([2]))).toEqual([]); // 未展开的重取门不收集
  });
});

// move 目标合法性判定（M4 spec §6.2 D8）：后代（含多级）命中为真、自身/兄弟/祖先为假、
// 祖先不存在为假——Workspace 确认移动钮禁用态的唯一判定来源
describe('treeModel isDescendant', () => {
  it('直接子级与多级后代命中为真；自身、兄弟、祖先为假；祖先缺失为假', () => {
    // 结构：根(1) → 笔记(2) → 年度(4) → a.html(3)；兄弟目录(5)——dirNode 助手仅一层，
    // 多级结构用 makeTreeRoot/withChildren 显式构造
    const tree = [
      withChildren(makeTreeRoot({ ...meta(2, 1, '笔记'), nodeType: 'dir' }), [
        withChildren(makeTreeRoot({ ...meta(4, 2, '年度'), nodeType: 'dir' }), [
          makeTreeRoot(meta(3, 4, 'a.html')),
        ]),
      ]),
      makeTreeRoot({ ...meta(5, 1, '兄弟'), nodeType: 'dir' }),
    ];
    expect(isDescendant(tree, 2, 4)).toBe(true); // 直接子级
    expect(isDescendant(tree, 2, 3)).toBe(true); // 多级后代
    expect(isDescendant(tree, 2, 2)).toBe(false); // 自身不算后代（自移判定在调用方另判）
    expect(isDescendant(tree, 2, 5)).toBe(false); // 兄弟
    expect(isDescendant(tree, 4, 2)).toBe(false); // 祖先非后代
    expect(isDescendant(tree, 99, 3)).toBe(false); // 祖先 id 不存在
  });
});

// 拖拽落点合法性（M9 FR-TREE-01，canDropOn）：目录且非自身/非当前父/非后代为合法；
// 文件行、自身、同父（无动作不伪装可放置）、后代、目标类型缺失均非法——TreePanel
// 拖拽落点高亮与放行落库的唯一判定来源（与 isDescendant 同树结构复用）
describe('treeModel canDropOn', () => {
  it('目录兄弟目标合法；文件行/自身/当前父/后代/类型缺失非法；根父兜底判同父', () => {
    // 结构：根(1) → 笔记(2) → 年度(4) → a.html(3)；兄弟目录(5)；根层文件 b.html(6)。
    // dirMeta 局部助手：注解 NodeMeta 使字面量收敛（nodeType 不放宽为 string）
    const dirMeta = (id: number, parentId: number, name: string): NodeMeta => ({
      ...meta(id, parentId, name),
      nodeType: 'dir',
    });
    const tree = [
      withChildren(makeTreeRoot(dirMeta(2, 1, '笔记')), [
        withChildren(makeTreeRoot(dirMeta(4, 2, '年度')), [makeTreeRoot(meta(3, 4, 'a.html'))]),
      ]),
      makeTreeRoot(dirMeta(5, 1, '兄弟')),
      makeTreeRoot(meta(6, 1, 'b.html')),
    ];
    const source = dirMeta(4, 2, '年度');
    // 合法：兄弟目录（非自身/非后代/非当前父）
    expect(canDropOn(tree, source, 5, 'dir')).toBe(true);
    // 非法：文件行（targetType file）
    expect(canDropOn(tree, source, 6, 'file')).toBe(false);
    // 非法：自身
    expect(canDropOn(tree, source, 4, 'dir')).toBe(false);
    // 非法：当前父（source.parentId=2 → 同父移动=无动作）
    expect(canDropOn(tree, source, 2, 'dir')).toBe(false);
    // 非法：自身后代
    expect(canDropOn(tree, source, 3, 'dir')).toBe(false);
    // 非法：类型锚缺失（命中未携带 data-tree-node-type）
    expect(canDropOn(tree, source, 5, undefined)).toBe(false);
    // 根父兜底：parentId 为 null 的源（构造性不可拖，契约兜底分支）以根(1)为目标=同父非法
    const rootLevel: NodeMeta = { ...meta(6, 1, 'b.html'), parentId: null };
    expect(canDropOn(tree, rootLevel, 1, 'dir')).toBe(false);
    // 根父兜底合法侧：根层文件拖入兄弟目录仍合法
    expect(canDropOn(tree, rootLevel, 5, 'dir')).toBe(true);
  });
});
