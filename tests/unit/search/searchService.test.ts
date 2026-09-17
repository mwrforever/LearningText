// 搜索服务参数拒绝 warn 审计（终审修复波）：buildSearchQuery 真实实现仅抛
// AppError(E_IPC_BAD_PAYLOAD)（见其 JSDoc），catch 分支中「非 AppError」「其他错误码」
// 两条排除路径在真实实现下不可达，故以模块级 mock 制造异常形态验证 warn 判断的完备性
// 与「原样重抛不吞错」语义（A.6-5：vi.mock / vi.hoisted 必须模块顶层）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

const { buildSearchQueryMock } = vi.hoisted(() => ({ buildSearchQueryMock: vi.fn() }));
vi.mock('../../../src/main/search/queryBuilder', () => ({
  buildSearchQuery: buildSearchQueryMock,
}));

import { createSearchService } from '../../../src/main/search/searchService';
import { AppError } from '../../../src/shared/result';
import { E_IPC_BAD_PAYLOAD, E_VFS_NOT_FOUND } from '../../../src/shared/errors';

// 库桩：拒绝路径在语句执行前抛出，工厂期 db.prepare 返回空壳语句即可（vi.fn 桩与接口的测试期适配）
const dbStub = {
  prepare: () => ({ get: () => undefined }),
} as unknown as Database.Database;

const search = createSearchService(dbStub);

describe('搜索服务参数拒绝 warn 审计', () => {
  beforeEach(() => {
    buildSearchQueryMock.mockReset();
  });

  it('E_IPC_BAD_PAYLOAD 拒绝 → warn 含原因形态描述且不含关键词原文，原样重抛同一实例', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = new AppError(E_IPC_BAD_PAYLOAD, '搜索查询不合法：空查询');
    buildSearchQueryMock.mockImplementation(() => {
      throw original;
    });
    try {
      try {
        search.query({ keyword: '用户输入原文' });
        expect.unreachable('应重抛');
      } catch (e) {
        expect(e).toBe(original); // 原样重抛（同一实例），不吞错不改码
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const log = String(warnSpy.mock.calls[0]?.[0]);
      expect(log).toContain('查询参数被拒绝');
      expect(log).toContain('空查询'); // 拒绝原因的形态描述在消息中
      expect(log).not.toContain('用户输入原文'); // 关键词原文不得落日志（docs/03 §7.4）
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('其他错误码 AppError → 不记 warn，原样重抛（E_VFS_NOT_FOUND 抛出语义不受影响）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = new AppError(E_VFS_NOT_FOUND, '子树过滤路径不存在或已在回收站');
    buildSearchQueryMock.mockImplementation(() => {
      throw original;
    });
    try {
      try {
        search.query({ keyword: '指数' });
        expect.unreachable('应重抛');
      } catch (e) {
        expect(e).toBe(original);
      }
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('非 AppError 意外异常 → 不记 warn，原样重抛', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const original = new Error('意外异常');
    buildSearchQueryMock.mockImplementation(() => {
      throw original;
    });
    try {
      try {
        search.query({ keyword: '指数' });
        expect.unreachable('应重抛');
      } catch (e) {
        expect(e).toBe(original);
      }
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
