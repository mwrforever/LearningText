/**
 * 快速打开浮层（M5 批次① Task 6）：cmdk 驱动的双源候选浮层。空关键词渲染「最近打开」
 * （Task 5 recentToItems 数据接口，每次展开经 settingsGet 重取保新鲜）；非空关键词经本地
 * 去抖 200ms 调 searchQuery（nodeTypes 仅 file，候选 ≤10 由服务端 limit 承载、不本地截断）。
 * 点选统一回传 onPick(NodeMeta)：搜索命中自带 meta 直传，最近打开条目经 getNode 反查补全。
 * cmdk 内建过滤关闭（shouldFilter=false）——服务端已按相关性排序，本地二次过滤会误杀
 * 正文命中；↑↓/Enter/Esc 键盘语义由 cmdk/radix 自带承载，Ctrl+P 入口归菜单 accelerator
 * （键位单一来源纪律，渲染层不自挂全局键盘监听）。组件消费 shadcn Dialog/Command 产码
 * （D26–D28 既定裁决），浮层样式走消费侧 className，不改写组件源码。
 */
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../../../shared/search-contract';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog';
import { recentToItems, type RecentItem } from './recentToItems';

/**
 * 搜索去抖窗口（brief 定值）：输入停沿 200ms 才发起查询，快速连击只落一次 IPC
 */
export const QUICKOPEN_DEBOUNCE_MS = 200;

/** 浮层候选条数上限：由 searchQuery limit 参数承载（服务端截断），不在渲染层二次截断 */
const QUICKOPEN_RESULT_LIMIT = 10;

/** palette 形态类串（shadcn CommandDialog 同款消费侧样式，取自官方模板原样） */
const PALETTE_COMMAND_CLASS =
  '**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5';

/** 浮层条目副行（虚拟路径）：12px 弱化档，右贴齐截断（设计系统文档 §四/§7.2） */
const ITEM_PATH_CLASS = 'ml-auto truncate text-xs text-muted-foreground';

export interface QuickOpenDialogProps {
  /** 浮层开关（受控）：false 时 radix 不挂载 portal 内容 */
  readonly open: boolean;
  /** 开关回传（Esc/关闭钮/点选后由浮层侧回传 false） */
  onOpenChange(open: boolean): void;
  /** 点选回传：目标文件节点 meta（已解析），Workspace 侧走 openFile 统一入口 */
  onPick(node: NodeMeta): void;
}

export function QuickOpenDialog({
  open,
  onOpenChange,
  onPick,
}: QuickOpenDialogProps): React.JSX.Element {
  const [keyword, setKeyword] = useState('');
  const [recent, setRecent] = useState<readonly RecentItem[]>([]);
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  // 请求序号守卫：清词/关闭/新输入都推进序号，过期响应（慢查询晚到）按序号丢弃，
  // 防旧结果覆盖新状态（setState 竞态仅作数据正确性防护，不影响挂载）
  const seqRef = useRef(0);

  // 展开时装载最近打开 + 重置上次会话的输入与结果（每次展开重取，保数据新鲜）
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setKeyword('');
    setHits([]);
    setSearching(false);
    void window.api.settingsGet().then((result) => {
      // 最近打开域读取失败静默回落空列表（列表源失败不阻断浮层可用性）
      if (alive && result.ok) setRecent(recentToItems(result.value.recent.opened));
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // 去抖搜索（宪法 A.4-11 的 <3 码点回退由主进程服务层承载，渲染层不重复设限）：
  // 非空关键词停沿 200ms 发起；关闭浮层/清空关键词即时作废挂起 timer 与 in-flight 响应
  useEffect(() => {
    const trimmed = keyword.trim();
    if (!open || trimmed === '') {
      seqRef.current += 1;
      setSearching(false);
      setHits([]);
      return undefined;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      void window.api
        .searchQuery({
          keyword: trimmed,
          filters: { nodeTypes: ['file'] },
          limit: QUICKOPEN_RESULT_LIMIT,
        })
        .then((result) => {
          if (seq !== seqRef.current) return; // 过期响应丢弃
          setSearching(false);
          // 查询失败（IPC/服务异常）按空结果呈现空态，与既有数据装载静默口径一致
          setHits(result.ok ? result.value.hits : []);
        });
    }, QUICKOPEN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, keyword]);

  /** 搜索命中点选：meta 已在手，直传并关闭 */
  function pickHit(nodeMeta: NodeMeta): void {
    onPick(nodeMeta);
    onOpenChange(false);
  }

  /**
   * 最近打开点选：候选只有 id 投影（RecentItem），先关闭浮层再经 getNode 反查补全
   * meta 后回传；节点已失效（广播未达的窗口期）静默放弃——trash/purge 修剪链会清条目
   */
  function pickRecent(nodeId: number): void {
    onOpenChange(false);
    void window.api.getNode({ nodeId }).then((result) => {
      if (result.ok) onPick(result.value);
    });
  }

  const trimmed = keyword.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 无障碍命名（shadcn CommandDialog 同款 sr-only 头部模式）：radix 经 context 关联 */}
      <DialogHeader className="sr-only">
        <DialogTitle>快速打开</DialogTitle>
        <DialogDescription>按名称或正文搜索文件并打开</DialogDescription>
      </DialogHeader>
      <DialogContent className="lt-quickopen overflow-hidden p-0">
        <Command shouldFilter={false} className={PALETTE_COMMAND_CLASS}>
          <CommandInput
            value={keyword}
            onValueChange={setKeyword}
            placeholder="搜索文件名或正文…"
          />
          <CommandList>
            {searching ? (
              // 加载态：去抖窗口 + 查询在途共用一态（此间无结果列表可渲染）
              <div className="py-6 text-center text-sm text-muted-foreground">搜索中…</div>
            ) : trimmed === '' ? (
              recent.length > 0 ? (
                <CommandGroup heading="最近打开">
                  {recent.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={String(item.id)}
                      onSelect={() => pickRecent(item.id)}
                    >
                      <span className="truncate text-sm">{item.name}</span>
                      <span className={ITEM_PATH_CLASS}>{item.virtualPath}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : (
                <CommandEmpty>暂无最近打开</CommandEmpty>
              )
            ) : hits.length > 0 ? (
              <CommandGroup heading="搜索结果">
                {hits.map((candidate) => (
                  <CommandItem
                    key={candidate.node.id}
                    value={String(candidate.node.id)}
                    onSelect={() => pickHit(candidate.node)}
                  >
                    <span className="truncate text-sm">{candidate.node.name}</span>
                    <span className={ITEM_PATH_CLASS}>{candidate.node.virtualPath}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>无匹配文件</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
