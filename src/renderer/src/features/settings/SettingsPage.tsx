/**
 * 设置标签页（M5 批次③ 骨架 → M6 spec §2.7/§4 重制）：不再是全屏覆盖层——作为编辑区
 * 特殊伪标签的内容面（spec 裁决 D3），关闭 = 关闭标签（TabBar 设置标签关闭钮）。
 * 左侧锚点导航（图标+文字：外观/编辑与预览/备份/数据与存储/工作区）+ 右侧表单区；
 * 表单即改即存：控件受控于 Workspace 提升的设置态，变更经钳制纯函数后上抛回调（写链
 * get→merge→set 与失败 toast 回滚由 Workspace 收口，本组件零持久化副作用）。
 * 备份区还原经 alert-dialog 强确认（将覆盖当前全部数据并重启应用）。
 * 「数据与存储」分区由批次③接入（本组件预留分区枚举位）。
 * M6 移除「重建搜索索引」disabled 占位按钮（用户需求：未实现功能不设计；TASK.md 保留接线项）。
 */
import { useState } from 'react';
import {
  DatabaseBackup,
  FolderInput,
  FolderOpen,
  HardDrive,
  History,
  Palette,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog';
import type { BackupEntry } from '../../../../shared/backup-contract';
import type { DataDirInfo } from '../../../../shared/storage-contract';
import { clampAutoSave, clampDebounce, clampFontSize } from './settingsFormModel';
import type { ThemeIntent } from './themeResolver';

export interface SettingsPageProps {
  /** 主题意图显示值（Workspace 持久化态回灌；保存失败回滚后随 props 还原） */
  readonly theme: ThemeIntent;
  /** 源码编辑器字号显示值（12–24 整数，px；M6 起仅作用 CodeMirror 源码编辑） */
  readonly editorFontSize: number;
  /** 保存/刷新去抖显示值（100–2000 ms 整数；M6 起改述，键名 preview.debounceMs 不变） */
  readonly debounceMs: number;
  /** 自动保存间隔显示值（1000–60000 ms 整数） */
  readonly autoSaveMs: number;
  /** 备份条目列表（新→旧；Workspace 在设置标签打开期间拉取与广播刷新） */
  readonly backups: readonly BackupEntry[];
  /** 每日自动备份开关显示值（backup.autoEnabled） */
  readonly backupAutoEnabled: boolean;
  /** 每日自动备份开关回调（持久化与失败回滚归 Workspace） */
  readonly onBackupAutoEnabledChange: (enabled: boolean) => void;
  /** 启动恢复工作区开关显示值（workspace.restoreOnStart，spec §3.2，默认开） */
  readonly restoreOnStart: boolean;
  /** 启动恢复工作区开关回调（持久化与失败回滚归 Workspace） */
  readonly onRestoreOnStartChange: (enabled: boolean) => void;
  /** 立即备份回调（建份与 backup:done 刷新链归 Workspace/主进程） */
  readonly onCreateBackup: () => void;
  /** 还原到指定备份回调（已经 alert-dialog 强确认；重启由主进程收场） */
  readonly onRestoreBackup: (fileName: string) => void;
  /** 主题意图变更回调（合法枚举值；持久化与失败回滚归 Workspace） */
  readonly onThemeChange: (theme: ThemeIntent) => void;
  /** 字号变更回调（入参已经 clampFontSize 钳制到 12–24 整数） */
  readonly onFontSizeChange: (fontSize: number) => void;
  /** 去抖变更回调（入参已经 clampDebounce 钳制到 100–2000 整数） */
  readonly onDebounceChange: (debounceMs: number) => void;
  /** 自动保存变更回调（入参已经 clampAutoSave 钳制到 1000–60000 整数） */
  readonly onAutoSaveChange: (autoSaveMs: number) => void;
  /** 数据目录布局（M6 批次③；设置标签打开期间装载，null = 尚未装载） */
  readonly storageInfo: DataDirInfo | null;
  /** 打开数据目录（系统文件管理器，主进程登记簿校验） */
  readonly onOpenStorageDir: () => void;
  /** 发起更改数据位置（Workspace 收口：目录选择 → 强确认 → 迁移 → 重启） */
  readonly onChangeStorageDir: () => void;
}

/** 表单分区：外观/编辑与预览/备份/数据与存储/工作区 */
type SettingsSection = 'appearance' | 'editor' | 'backup' | 'storage' | 'workspace';

/** 导航分区元数据（图标 + 中文名） */
const SECTIONS: readonly { key: SettingsSection; label: string; icon: typeof Palette }[] = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'editor', label: '编辑与预览', icon: SlidersHorizontal },
  { key: 'backup', label: '备份', icon: DatabaseBackup },
  { key: 'storage', label: '数据与存储', icon: HardDrive },
  { key: 'workspace', label: '工作区', icon: History },
];

/** 导航项标准类串（树行同款形态：整行可点 + aria-current 高亮，图标 + 文字） */
const NAV_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground aria-current:bg-accent aria-current:font-medium aria-current:text-accent-foreground';

/** 滑块行标准类串：原生 range（jsdom/真实浏览器同语义）+ 值回显，accent 走语义主色 */
const RANGE_CLASS = 'h-1 w-48 accent-primary';

/** 滑块值回显类串：12px 弱化档 + tabular-nums（拖动时数字宽度不抖动，M5 打磨） */
const RANGE_VALUE_CLASS = 'text-xs text-muted-foreground tabular-nums';

/** 次级按钮标准类串（导航同源的 hover/disabled 纪律） */
const BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40';

/** 备份文件大小展示格式：<1KB 按字节，其余按 KB（一位小数） */
function formatBackupSize(sizeBytes: number): string {
  return sizeBytes >= 1024 ? `${(sizeBytes / 1024).toFixed(1)}KB` : `${String(sizeBytes)}B`;
}

export function SettingsPage({
  theme,
  editorFontSize,
  debounceMs,
  autoSaveMs,
  backups,
  backupAutoEnabled,
  onBackupAutoEnabledChange,
  restoreOnStart,
  onRestoreOnStartChange,
  onCreateBackup,
  onRestoreBackup,
  onThemeChange,
  onFontSizeChange,
  onDebounceChange,
  onAutoSaveChange,
  storageInfo,
  onOpenStorageDir,
  onChangeStorageDir,
}: SettingsPageProps): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>('appearance');
  // 还原强确认目标（备份文件名）：null=浮层收起；确认/取消均收起，确认侧才上抛还原
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  return (
    // 画布内嵌面（M6 spec D3）：占满画布区，不再 fixed 覆盖；lt-settings 保留为测试锚点
    <section aria-label="设置" className="lt-settings flex min-h-0 flex-1 bg-background">
      <div className="flex min-h-0 flex-1">
        {/* 左侧锚点导航（图标 + 文字） */}
        <nav aria-label="设置导航" className="w-40 shrink-0 border-r border-border p-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  className={NAV_ITEM_CLASS}
                  aria-current={section === key ? 'true' : undefined}
                  onClick={() => setSection(key)}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {/* 右侧表单区：即改即存（受控值 + 钳制后回调上抛） */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {section === 'appearance' ? (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">主题</p>
                <Select
                  value={theme}
                  onValueChange={(value) => {
                    // 运行时收窄替代 as 断言（A.1-5）：SelectItem 值域即 ThemeIntent 全集
                    if (value === 'light' || value === 'dark' || value === 'system') {
                      onThemeChange(value);
                    }
                  }}
                >
                  <SelectTrigger size="sm" aria-label="主题" className="w-32 rounded-sm text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="light" className="text-xs">
                      亮色
                    </SelectItem>
                    <SelectItem value="dark" className="text-xs">
                      暗色
                    </SelectItem>
                    <SelectItem value="system" className="text-xs">
                      跟随系统
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="m-0 mb-1 text-sm font-medium">源码编辑器字号</p>
                <p className="m-0 mb-1 text-xs text-muted-foreground">
                  作用于 CSS/JS 等源码编辑视图
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={12}
                    max={24}
                    step={1}
                    value={editorFontSize}
                    aria-label="编辑器字号"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      // 越界原始值经钳制纯函数收口后再上抛（写入值恒过契约 schema）
                      onFontSizeChange(clampFontSize(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className={RANGE_VALUE_CLASS}>{editorFontSize}px</span>
                </div>
              </div>
            </>
          ) : section === 'editor' ? (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">保存/刷新去抖</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={100}
                    max={2000}
                    step={100}
                    value={debounceMs}
                    aria-label="预览去抖"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      onDebounceChange(clampDebounce(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className={RANGE_VALUE_CLASS}>{debounceMs}ms</span>
                </div>
              </div>
              <div>
                <p className="m-0 mb-1 text-sm font-medium">自动保存间隔</p>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1000}
                    max={60000}
                    step={1000}
                    value={autoSaveMs}
                    aria-label="自动保存间隔"
                    className={RANGE_CLASS}
                    onChange={(event) => {
                      onAutoSaveChange(clampAutoSave(Number(event.currentTarget.value)));
                    }}
                  />
                  <span className={RANGE_VALUE_CLASS}>{autoSaveMs}ms</span>
                </div>
              </div>
            </>
          ) : section === 'backup' ? (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">每日自动备份</p>
                {/* 原生 checkbox（滑块同款原生控件纪律）：受控 + 即改即存回调上抛 */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    aria-label="每日自动备份"
                    checked={backupAutoEnabled}
                    className="accent-primary"
                    onChange={(event) => {
                      onBackupAutoEnabledChange(event.currentTarget.checked);
                    }}
                  />
                  每日首次启动自动备份一次，滚动保留最近 7 份
                </label>
              </div>
              <div className="mb-4">
                <div className="mb-1 flex items-center gap-2">
                  <p className="m-0 text-sm font-medium">备份列表</p>
                  <button
                    type="button"
                    aria-label="立即备份"
                    className={BUTTON_CLASS}
                    onClick={onCreateBackup}
                  >
                    立即备份
                  </button>
                </div>
                {backups.length === 0 ? (
                  <p className="lt-backup-empty m-0 text-xs text-muted-foreground">
                    暂无备份，点击「立即备份」创建第一份
                  </p>
                ) : (
                  <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                    {backups.map((backup) => (
                      <li
                        key={backup.fileName}
                        className="lt-backup-item flex items-center justify-between gap-2 py-1"
                      >
                        <span className="truncate text-xs text-foreground">{backup.fileName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatBackupSize(backup.sizeBytes)} · {backup.modifiedAt}
                        </span>
                        <button
                          type="button"
                          aria-label={`还原到 ${backup.fileName}`}
                          className={`${BUTTON_CLASS} shrink-0`}
                          onClick={() => {
                            setRestoreTarget(backup.fileName);
                          }}
                        >
                          还原到此点
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* 还原强确认（radix alert-dialog 手工落模板）：数据覆盖级操作专用 */}
              {restoreTarget !== null ? (
                <AlertDialog
                  open
                  onOpenChange={(open) => {
                    // 关闭面（Esc/取消/确认后的自动收起）统一清目标
                    if (!open) setRestoreTarget(null);
                  }}
                >
                  {/* 消费侧类覆写对齐设计系统标尺（M5 打磨口径）：浮层 p-4、标题 text-base */}
                  <AlertDialogContent className="p-4">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-base">
                        还原备份：{restoreTarget}
                      </AlertDialogTitle>
                      <AlertDialogDescription>将覆盖当前全部数据并重启应用</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel aria-label="取消还原" className="h-8 text-xs">
                        取消
                      </AlertDialogCancel>
                      <AlertDialogAction
                        aria-label="确认还原"
                        className="h-8 text-xs"
                        onClick={() => {
                          onRestoreBackup(restoreTarget);
                          setRestoreTarget(null);
                        }}
                      >
                        确认还原
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </>
          ) : section === 'storage' ? (
            <>
              {/* 数据与存储（M6 spec §4/FR-AUX-03 修订版）：布局展示 + 打开/更改迁移入口 */}
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">当前数据位置</p>
                {storageInfo === null ? (
                  <p className="m-0 text-xs text-muted-foreground">正在读取…</p>
                ) : (
                  <>
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`lt-storage-badge inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs ${
                          storageInfo.custom
                            ? 'bg-accent text-accent-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {storageInfo.custom ? '自定义' : '默认'}
                      </span>
                      <span className="lt-storage-root truncate font-mono text-xs text-foreground">
                        {storageInfo.root}
                      </span>
                    </div>
                    <p className="m-0 mb-2 text-xs text-muted-foreground">
                      数据库、设置与备份均保存在该目录下；更改后自动迁移并重启生效
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="打开数据目录"
                        className={BUTTON_CLASS}
                        onClick={onOpenStorageDir}
                      >
                        <FolderOpen aria-hidden="true" className="mr-1 inline size-3.5" />
                        打开目录
                      </button>
                      <button
                        type="button"
                        aria-label="更改数据位置"
                        className={BUTTON_CLASS}
                        onClick={onChangeStorageDir}
                      >
                        <FolderInput aria-hidden="true" className="mr-1 inline size-3.5" />
                        更改数据位置…
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <p className="m-0 mb-1 text-sm font-medium">启动时恢复工作区</p>
                {/* 原生 checkbox（备份区自动开关同款原生控件纪律）：受控 + 即改即存回调上抛 */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    aria-label="启动时恢复工作区"
                    checked={restoreOnStart}
                    className="accent-primary"
                    onChange={(event) => {
                      onRestoreOnStartChange(event.currentTarget.checked);
                    }}
                  />
                  启动时按上次关闭前的标签集自动恢复工作区
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
