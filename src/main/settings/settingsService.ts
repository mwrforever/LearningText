/**
 * 设置服务（M3 spec §5 / M4 spec §7）：userData/settings/settings.json 的独占读写——启动同步加载
 * （几 KB JSON，A.5-4 预算内）、内存缓存、set 原子写（tmp+rename）。
 * 装载链三级：v2 直读 → v1 静默迁移（补默认域 + 原子回写）→ 损坏/版本不识别 warn 回退默认，
 * 禁止阻断启动（fail-fast 仅数据库适用，A.5-1；设置属可丢弃缓存）。
 * 校验唯一闸口在 IPC 层 handleWith（A.7-5），服务侧收 typed 数据直接落盘（不留不可达死分支）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  SettingsSchemaV1,
  migrateV1ToV2,
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

  /**
   * 原子落盘（tmp + 同目录 rename）+ 内存缓存更新 + 单条 info（调用方保证已过 zod 闸）。
   * message 由调用方给定：set 报「已更新」、迁移报「已迁移」，保证每次写盘只打一条 info。
   */
  function writeSettings(data: SettingsData, message: string): void {
    const tmp = deps.settingsFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, deps.settingsFile); // 同目录 rename 原子覆盖（POSIX 与 NTFS replace 语义）
    cached = data;
    console.info(`[settings] ${message}`);
  }

  try {
    if (existsSync(deps.settingsFile)) {
      const raw = JSON.parse(readFileSync(deps.settingsFile, 'utf8')) as unknown;
      const asV2 = SettingsSchema.safeParse(raw);
      if (asV2.success) {
        cached = asV2.data;
      } else {
        // v2 不中先试 v1 迁移（M4 spec §7）：成功则补默认域原子回写，失败才告警回退
        const asV1 = SettingsSchemaV1.safeParse(raw);
        if (asV1.success) {
          writeSettings(migrateV1ToV2(asV1.data), '配置已从 schemaVersion 1 迁移至 2');
        } else {
          console.warn('[settings] 配置文件校验失败，回退默认值', asV2.error.name);
        }
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
      writeSettings(request, `已更新 preview.debounceMs=${String(request.preview.debounceMs)}`);
      return request;
    },
  };
}
