/**
 * 设置服务（spec §5）：userData/settings/settings.json 的独占读写——启动同步加载
 * （几 KB JSON，A.5-4 预算内）、内存缓存、set 原子写（tmp+rename）。
 * 文件缺失/损坏/schemaVersion 不识别 → warn + 回退默认值，禁止阻断启动
 * （fail-fast 仅数据库适用，A.5-1；设置属可丢弃缓存）。
 * 校验唯一闸口在 IPC 层 handleWith（A.7-5），服务侧收 typed 数据直接落盘（不留不可达死分支）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type SettingsData,
} from '../../shared/settings-contract';

export interface SettingsService {
  /** 当前设置（启动加载后缓存；get 永不抛——损坏已回退） */
  get(): SettingsData;
  /** 全量写入（IPC 层已 zod 校验）：原子落盘 + 更新缓存，返回持久化后设置 */
  set(request: SettingsData): SettingsData;
}

export function createSettingsService(deps: { settingsFile: string }): SettingsService {
  let cached: SettingsData = DEFAULT_SETTINGS;
  try {
    if (existsSync(deps.settingsFile)) {
      const parsed = SettingsSchema.safeParse(
        JSON.parse(readFileSync(deps.settingsFile, 'utf8')) as unknown,
      );
      if (parsed.success) {
        cached = parsed.data;
      } else {
        console.warn('[settings] 配置文件校验失败，回退默认值', parsed.error.name);
      }
    }
  } catch (e: unknown) {
    // 读/JSON 解析异常同属损坏态：warn 回退，不阻断启动
    console.warn('[settings] 读取配置文件失败，回退默认值', e);
  }
  return {
    get(): SettingsData {
      return cached;
    },
    set(request: SettingsData): SettingsData {
      const tmp = deps.settingsFile + '.tmp';
      writeFileSync(tmp, JSON.stringify(request, null, 2), 'utf8');
      renameSync(tmp, deps.settingsFile); // 同目录 rename 原子覆盖（POSIX 与 NTFS replace 语义）
      cached = request;
      console.info(`[settings] 已更新 preview.debounceMs=${String(request.preview.debounceMs)}`);
      return request;
    },
  };
}
