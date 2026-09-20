/**
 * 全局搜索面板（M5 批次① Task 7）：树栏 search 态视图（spec §2.2）。顶部关键词输入 +
 * 类型过滤 select（全部/HTML/目录 → filters.nodeTypes 三态），回车发起 searchQuery
 * （Enter 显式提交，无去抖——用户显式动作语义，区别于快速打开的输入即查）；结果列表按
 * 片段区间着色（mark[data-hl]，sliceWithHighlights 纯函数承载，零 HTML 注入），名称片段
 * 全量展示（FULL_TEXT_WINDOW），正文片段按首命中 ±36 码元裁窗。分页不做虚拟化：每页
 * SEARCH_LIMIT_DEFAULT（50）条，truncated 时「加载更多」按当前 hits 长度递增 offset 追加
 * （D24 策略），total 精确计数展示。点选回传 onOpen（消费侧走 openFile 统一入口）、
 * 「在树中显示」回传 onReveal（消费侧退出搜索态回树）。过期响应按请求序号丢弃（防慢查询
 * 回写覆盖新状态）；样式走设计系统规范类串模板字面量，不消费 cn()（D28 体积红线）。
 */
import { useRef, useState } from 'react';
import { SEARCH_LIMIT_DEFAULT } from '../../../../shared/search-contract';
import type { SearchHit, Snippet } from '../../../../shared/search-contract';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { Input } from '@components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select';
import { showToast } from '../ui/Toast';
import {
  FULL_TEXT_WINDOW,
  nodeTypesForFilter,
  sliceWithHighlights,
  type HighlightSpan,
  type SearchTypeFilter,
} from './searchModel';

/** 工具钮标准类串（设计系统文档 §7.2 唯一规范形态，模板字面量、禁体外发挥） */
const TOOL_BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40';

/** 结果条目主钮类串：整行可点（打开），内部片段按块排布 */
const HIT_ROW_CLASS =
  'block w-full min-w-0 rounded-sm px-2 py-1 text-left text-sm text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground';

/** 命中着色类串：语义 token 承载（mark 浏览器默认黄底在双主题下不受控，显式覆盖） */
const HIT_MARK_CLASS = 'bg-primary/15 text-foreground rounded-xs';

export interface SearchPanelProps {
  /** 点选命中：打开目标节点（文件走 openFile 统一入口，大文件/二进制拦截一并生效） */
  onOpen(node: NodeMeta): void;
  /** 「在树中显示」：消费侧树侧定位（祖先链展开 + 选中）并退出搜索态回树（spec §2.2） */
  onReveal(node: NodeMeta): void;
}

/** 单条片段渲染：区间 → <mark data-hl> 着色，纯文本节点拼接（禁 dangerouslySetInnerHTML） */
function HighlightedSnippet({
  snippet,
  fullText,
}: {
  readonly snippet: Snippet;
  /** 名称片段传 true：不裁窗全量展示（服务端 ≤255 码点已全量提供） */
  readonly fullText?: boolean;
}): React.JSX.Element {
  const { text, spans } = sliceWithHighlights(
    snippet.text,
    snippet.ranges,
    fullText === true ? FULL_TEXT_WINDOW : undefined,
  );
  // 相邻 span 间补纯文本；重叠区间（M2 契约允许）取已游标右侧部分，不重复着色
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span: HighlightSpan, index) => {
    const start = Math.max(span.start, cursor);
    if (start > cursor) parts.push(text.slice(cursor, start));
    if (span.end > start) {
      parts.push(
        // 复合键：片段无业务 id（纯展示分段），start/end + 序号防重叠区间键重复
        <mark key={`${span.start}-${span.end}-${index}`} data-hl="true" className={HIT_MARK_CLASS}>
          {text.slice(start, span.end)}
        </mark>,
      );
    }
    cursor = Math.max(cursor, span.end);
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function SearchPanel({ onOpen, onReveal }: SearchPanelProps): React.JSX.Element {
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<SearchTypeFilter>('all');
  const [hits, setHits] = useState<readonly SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  // 已发起过查询（空态分文案依据：「未搜索引导」与「无匹配结果」混用会误导用户）
  const [searched, setSearched] = useState(false);
  // 请求序号守卫（QuickOpenDialog 同款）：新查询推进序号，过期响应按序号丢弃
  const seqRef = useRef(0);

  /**
   * 发起查询（回车首查与「加载更多」共用）：offset 0 整体替换结果集，否则按当前命中数
   * 追加分页；空关键词不发起（契约拒绝空查询，不发无效 IPC）。失败 toast 并保留既有结果
   * （瞬时错误不摧毁用户当前视图）
   */
  function runSearch(offset: number): void {
    const trimmed = keyword.trim();
    if (trimmed === '') return;
    const seq = ++seqRef.current;
    setSearching(true);
    setSearched(true);
    void window.api
      .searchQuery({
        keyword: trimmed,
        filters: { nodeTypes: [...nodeTypesForFilter(typeFilter)] },
        limit: SEARCH_LIMIT_DEFAULT,
        offset,
      })
      .then((result) => {
        if (seq !== seqRef.current) return; // 过期响应丢弃
        setSearching(false);
        if (!result.ok) {
          showToast(`搜索失败：${result.error.message}`);
          return;
        }
        // 首页替换 / 加载更多追加（展开为可变数组后回存，React 不可变纪律）
        setHits((prev) => (offset === 0 ? result.value.hits : [...prev, ...result.value.hits]));
        setTotal(result.value.total);
        setTruncated(result.value.truncated);
      });
  }

  /** 回车提交（显式监听，jsdom/真实浏览器同路径，不依赖 form 隐式提交） */
  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') runSearch(0);
  }

  return (
    <section aria-label="全局搜索" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 查询工具条：关键词输入 + 类型过滤（全部/HTML/目录 → nodeTypes 三态） */}
      <div className="lt-search-toolbar flex items-center gap-1 border-b border-border px-2 py-1">
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="搜索关键词"
          placeholder="搜索名称或正文，回车执行"
          className="h-6 min-w-0 flex-1 rounded-sm px-2 py-0 text-xs"
        />
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            // 运行时收窄替代 as 断言（A.1-5）：SelectItem 值域即 SearchTypeFilter 全集
            if (value === 'all' || value === 'file' || value === 'dir') setTypeFilter(value);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="类型过滤"
            className="h-6 w-[4.5rem] rounded-sm px-1.5 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all" className="text-xs">
              全部
            </SelectItem>
            <SelectItem value="file" className="text-xs">
              HTML
            </SelectItem>
            <SelectItem value="dir" className="text-xs">
              目录
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hits.length === 0 ? (
        // 空态分文案：未搜索给引导、搜过无命中给事实（TrashPanel 空态/无匹配同款纪律）
        <p className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          {searching ? '搜索中…' : searched ? '无匹配结果' : '输入关键词后回车搜索'}
        </p>
      ) : (
        <ul
          aria-label="搜索结果"
          className="m-0 min-h-0 flex-1 list-none overflow-auto p-2 text-sm"
        >
          {hits.map((item) => (
            <li key={item.node.id} className="mb-1 rounded-sm border border-border px-1 py-1">
              <div className="flex items-start justify-between gap-1">
                {/* 主钮整行可点（名称/路径/正文片段）；次级动作独立成钮避免嵌套交互面 */}
                <button
                  type="button"
                  aria-label={`打开 ${item.node.name}`}
                  className={HIT_ROW_CLASS}
                  onClick={() => onOpen(item.node)}
                >
                  <span className="block truncate">
                    <HighlightedSnippet snippet={item.nameSnippet} fullText />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.node.virtualPath}
                  </span>
                  {item.bodySnippet !== null ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      <HighlightedSnippet snippet={item.bodySnippet} />
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`在树中显示 ${item.node.name}`}
                  className={`${TOOL_BUTTON_CLASS} shrink-0`}
                  onClick={() => onReveal(item.node)}
                >
                  在树中显示
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* 状态条：total 精确计数（spec §5 含未翻页部分）+ truncated 余量加载入口 */}
      {total > 0 ? (
        <div className="lt-search-status flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
          <span>共 {total} 条命中</span>
          {truncated ? (
            <button
              type="button"
              aria-label="加载更多搜索结果"
              disabled={searching}
              className={TOOL_BUTTON_CLASS}
              onClick={() => runSearch(hits.length)}
            >
              加载更多
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
