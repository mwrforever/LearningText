// 导入节点计划纯函数单元测试（M5 批次⑥ Task 12，FR-IO-01）：
// 根层计划（文件/目录、目录字节归零）与重名三策略（skip/rename/overwrite）全分支——
// (2)(3) 递增、扩展名保留、无扩展名与点开头条目形态。真实 fs 读取由 service 注入抽象，
// 本文件零 IO（纯函数契约，spec D15/D16 前置）。
import { describe, expect, it } from 'vitest';
import { planImportRoots, resolveConflict } from '../../../src/main/io/importPlanner';

describe('planImportRoots 根层计划', () => {
  it('文件与目录均产出 PlannedNode：relPath 即根层名；目录字节归零（目录无内容语义）', () => {
    const plan = planImportRoots([
      { name: 'a.txt', isDir: false, sizeBytes: 10 },
      { name: 'sub', isDir: true, sizeBytes: 4096 },
    ]);
    expect(plan).toEqual([
      { relPath: 'a.txt', name: 'a.txt', isDir: false, sizeBytes: 10 },
      { relPath: 'sub', name: 'sub', isDir: true, sizeBytes: 0 },
    ]);
  });

  it('空目录清单产出空计划（不产生任何写入节点）', () => {
    expect(planImportRoots([])).toEqual([]);
  });
});

describe('resolveConflict 重名三策略', () => {
  it('skip：同名存在即 skip（名字原样返回供计数归因），不存在则 write 原名', () => {
    expect(resolveConflict('a.txt', new Set(['a.txt']), 'skip')).toEqual({
      action: 'skip',
      name: 'a.txt',
    });
    expect(resolveConflict('a.txt', new Set<string>(), 'skip')).toEqual({
      action: 'write',
      name: 'a.txt',
    });
  });

  it('overwrite：存在与否一律 write 原名（覆盖由服务层 trash 旧节点实现，D15）', () => {
    expect(resolveConflict('a.txt', new Set(['a.txt']), 'overwrite')).toEqual({
      action: 'write',
      name: 'a.txt',
    });
    expect(resolveConflict('a.txt', new Set<string>(), 'overwrite')).toEqual({
      action: 'write',
      name: 'a.txt',
    });
  });

  it('rename：无冲突 write 原名；冲突递增 name (2).ext；(2) 亦被占继续递增 (3)', () => {
    expect(resolveConflict('a.txt', new Set<string>(), 'rename')).toEqual({
      action: 'write',
      name: 'a.txt',
    });
    expect(resolveConflict('a.txt', new Set(['a.txt']), 'rename')).toEqual({
      action: 'write',
      name: 'a (2).txt',
    });
    expect(resolveConflict('a.txt', new Set(['a.txt', 'a (2).txt']), 'rename')).toEqual({
      action: 'write',
      name: 'a (3).txt',
    });
  });

  it('rename：扩展名保留（最后一段点为扩展名），无扩展名追加 (2)，点开头文件整体作主名', () => {
    expect(resolveConflict('report.final.md', new Set(['report.final.md']), 'rename')).toEqual({
      action: 'write',
      name: 'report.final (2).md',
    });
    expect(resolveConflict('README', new Set(['README']), 'rename')).toEqual({
      action: 'write',
      name: 'README (2)',
    });
    // 首字符点（.gitignore）不属于扩展名分隔：整体为主名，避免 ". (2)gitignore" 形态劣化
    expect(resolveConflict('.gitignore', new Set(['.gitignore']), 'rename')).toEqual({
      action: 'write',
      name: '.gitignore (2)',
    });
  });

  it('rename：目录条目同名同样递增（无扩展名路径），与文件同一策略语义', () => {
    expect(resolveConflict('sub', new Set(['sub']), 'rename')).toEqual({
      action: 'write',
      name: 'sub (2)',
    });
  });
});
