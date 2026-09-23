// 应用内更新能力判定单元测试（M9 批次，FR-UPDATE-01）：纯函数表驱动——
// dev 分支优先级、darwin 未签名降级、linux 非 AppImage 降级（undefined/空串）与
// win NSIS / linux AppImage 可用形态。全部为装配期环境事实的组合枚举。
import { describe, expect, it } from 'vitest';
import { resolveUpdateCapability } from '../../../src/main/update/updateCapability';

describe('resolveUpdateCapability 能力矩阵', () => {
  it('开发形态（未打包）恒降级 dev，且优先于平台判定', () => {
    expect(
      resolveUpdateCapability({ isPackaged: false, platform: 'win32', appImagePath: undefined }),
    ).toEqual({
      enabled: false,
      reason: 'dev',
    });
    // darwin/linux 的平台限制不覆盖 dev 判定（dev 分支在最前）
    expect(
      resolveUpdateCapability({ isPackaged: false, platform: 'darwin', appImagePath: undefined }),
    ).toEqual({
      enabled: false,
      reason: 'dev',
    });
  });

  it('打包 macOS 降级 platform：安装包未签名，Squirrel 替换阶段必失败', () => {
    expect(
      resolveUpdateCapability({ isPackaged: true, platform: 'darwin', appImagePath: undefined }),
    ).toEqual({
      enabled: false,
      reason: 'platform',
    });
  });

  it('打包 Linux 非 AppImage 形态降级 platform（APPIMAGE 未注入或空串）', () => {
    expect(
      resolveUpdateCapability({ isPackaged: true, platform: 'linux', appImagePath: undefined }),
    ).toEqual({
      enabled: false,
      reason: 'platform',
    });
    expect(
      resolveUpdateCapability({ isPackaged: true, platform: 'linux', appImagePath: '' }),
    ).toEqual({
      enabled: false,
      reason: 'platform',
    });
  });

  it('打包 win NSIS 形态可用', () => {
    expect(
      resolveUpdateCapability({ isPackaged: true, platform: 'win32', appImagePath: undefined }),
    ).toEqual({
      enabled: true,
    });
  });

  it('打包 linux AppImage 形态可用（APPIMAGE 指向镜像挂载路径）', () => {
    expect(
      resolveUpdateCapability({
        isPackaged: true,
        platform: 'linux',
        appImagePath: '/mnt/appimages/LearningText.AppImage',
      }),
    ).toEqual({ enabled: true });
  });
});
