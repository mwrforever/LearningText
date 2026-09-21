/**
 * 设置服务（M3 spec §5 / M4 spec §7 / M5 批次③ / M6 v4）：userData/settings/settings.json 的
 * 独占读写——启动同步加载（几 KB JSON，A.5-4 预算内）、内存缓存、set 原子写（tmp+rename）。
 * 装载链：v4 直读 → v3 迁移（shell.layout 改型侧栏形态 + 原子回写）→ v2 静默迁移 →
 * v1 三级链式迁移（v1→v2→v3→v4）→ 损坏/版本不识别 warn 回退默认，禁止阻断启动
 * （fail-fast 仅数据库适用，A.5-1；设置属可丢弃缓存）。
 * 校验唯一闸口在 IPC 层 handleWith（A.7-5），服务侧收 typed 数据直接落盘（不留不可达死分支）。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  SettingsSchemaV1,
  SettingsSchemaV2,
  SettingsSchemaV3,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
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
   * message 由调用方给定：set 报实际写入域摘要、迁移报「已迁移」，保证每次写盘只打一条 info。
   */
  function writeSettings(data: SettingsData, message: string): void {
    const tmp = deps.settingsFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, deps.settingsFile); // 同目录 rename 原子覆盖（POSIX 与 NTFS replace 语义）
    cached = data;
    console.info(`[settings] ${message}`);
  }

  /**
   * set 侧 info 域摘要（TASK.md「set 日志域摘要化」闭环，M5 批次④）：全量写形态下逐域
   * 比对写前缓存，仅列出内容真正变化的域——shell.layout 高频写不再误报 preview 等无关域。
   * 无域变更（等值全量写）时显式报「无域变更」，不产出误导性的空清单。
   */
  function summarizeChangedDomains(previous: SettingsData, next: SettingsData): string {
    const changed = (Object.keys(next) as Array<keyof SettingsData>).filter(
      (domain) => JSON.stringify(next[domain]) !== JSON.stringify(previous[domain]),
    );
    return changed.length === 0 ? '已更新设置（无域变更）' : `已更新设置域：${changed.join('、')}`;
  }

  try {
    if (existsSync(deps.settingsFile)) {
      const raw = JSON.parse(readFileSync(deps.settingsFile, 'utf8')) as unknown;
      const asV4 = SettingsSchema.safeParse(raw);
      if (asV4.success) {
        cached = asV4.data;
      } else {
        // v4 不中先试 v3 迁移（M6）：shell.layout 改型侧栏形态，六域用户值原样保留
        const asV3 = SettingsSchemaV3.safeParse(raw);
        if (asV3.success) {
          writeSettings(migrateV3ToV4(asV3.data), '配置已从 schemaVersion 3 迁移至 4');
        } else {
          // 再试 v2 迁移（M5 批次③）：成功则补四新域默认并续迁 v4，旧域用户值原样保留
          const asV2 = SettingsSchemaV2.safeParse(raw);
          if (asV2.success) {
            writeSettings(
              migrateV3ToV4(migrateV2ToV3(asV2.data)),
              '配置已从 schemaVersion 2 迁移至 4',
            );
          } else {
            // 末试 v1 三级链式迁移：v1 补 M4 域后经 v2→v3→v4 续迁，一次落盘一条 info
            const asV1 = SettingsSchemaV1.safeParse(raw);
            if (asV1.success) {
              writeSettings(
                migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(asV1.data))),
                '配置已从 schemaVersion 1 迁移至 4',
              );
            } else {
              console.warn('[settings] 配置文件校验失败，回退默认值', asV4.error.name);
            }
          }
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
      writeSettings(request, summarizeChangedDomains(cached, request));
      return request;
    },
  };
}
