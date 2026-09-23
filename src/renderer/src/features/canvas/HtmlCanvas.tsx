/**
 * HTML 画布（M6 spec §3.3 → M9 批次「交互优先」重构，FR-RENDER-08 2026-09-23 修订版；
 * 设计依据 `docs/design/2026-09-23-M9交互蓝图.md` 面 A 含 §1.4 在途实现对齐）：
 * 每个 HTML 标签一个保活沙箱 iframe（opaque origin + allow-scripts 红线不变）——激活可见、
 * 后台隐藏。**默认为交互态**：文档与在系统浏览器中打开完全一致，自带脚本、按钮、表单、
 * 链接全部可用（M6「打开即整页 contentEditable」被用户实测推翻——整页可编辑使文档自身
 * 交互整体失效）；编辑能力经右下角工具条「编辑」钮显式进入（body 为落笔目标，蓝图 A.5
 * 键盘路径），或交互态双击文本元素直达（桥内判定并回执）；编辑态画布级单值——切签对旧
 * 文档收口（同一时刻至多一篇在编辑态，蓝图 §1.4），重载/关签不跨导航存活。
 * 文档面基底为浏览器白（`bg-white`，见 iframe 处注与设计系统 §十二）；刷新抑制（spec D7）
 * 为结构性保证：written 广播不触发任何重载，外部变更经工具条「从库重新加载」显式拉取
 * （脏态禁用——本地修改与库内容冲突时禁止静默覆盖）。CSS 热替换通道保留（M4 spec §5.4）。
 * `data-lt-canvas-mode`（interact/edit，onLoad 后才有值）是「桥就绪/模式」的 E2E 信号锚
 * ——取代旧「body contenteditable 就绪等待」（该信号语义收窄为「编辑目标已激活」）。
 */
import { useEffect, useRef, useState } from 'react';
import { Pencil, RotateCw, X } from 'lucide-react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import type { TabState } from '../workspace/tabModel';
import { vfsUrl } from '../preview/vfsUrl';
import { useExitPresence } from '../workspace/ioProgressPresence';

/** 编辑态提示条退场时长（毫秒）：与退场类串 `duration-100` 两处同步修改（同 PROGRESS_EXIT_MS 惯例） */
const BANNER_EXIT_MS = 100;

export interface HtmlCanvasProps {
  /** 当前打开的 HTML 标签全集（全部渲染保活；由 Workspace 过滤注入） */
  readonly tabs: readonly TabState[];
  /** 激活标签 nodeId（null = 无激活，全部隐藏——实际不可达，契约收尾） */
  readonly activeId: number | null;
  /** 激活标签脏态（重新加载钮禁用判定） */
  readonly activeDirty: boolean;
  /** 编辑上报出口（Workspace：更新画布缓存 + SaveController.edit 进入保存管线） */
  onDocEdit(nodeId: number, html: string): void;
  /** 站内链接打开出口（导航闸门：桥取消就地导航后经此开新标签，与树点选同入口） */
  onOpenVfsNode(node: NodeMeta): void;
}

/** lt:doc-edit 消息收窄（外部输入禁断言，A.1-5）：type/html 双字段校验 */
function parseDocEdit(data: unknown): { html: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; html?: unknown };
  if (msg.type !== 'lt:doc-edit' || typeof msg.html !== 'string') return null;
  return { html: msg.html };
}

/** lt:edit-state 消息收窄（A.1-5）：桥内双击进入 / Esc 退出的状态回执，type/editing 双校验 */
function parseEditState(data: unknown): { editing: boolean } | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; editing?: unknown };
  if (msg.type !== 'lt:edit-state' || typeof msg.editing !== 'boolean') return null;
  return { editing: msg.editing };
}

/** lt:link-open 消息收窄（A.1-5）：导航闸门转交的站内链接 href */
function parseLinkOpen(data: unknown): { href: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; href?: unknown };
  if (msg.type !== 'lt:link-open' || typeof msg.href !== 'string' || msg.href === '') return null;
  return { href: msg.href };
}

export function HtmlCanvas({
  tabs,
  activeId,
  activeDirty,
  onDocEdit,
  onOpenVfsNode,
}: HtmlCanvasProps): React.JSX.Element {
  // iframe 实例表（nodeId → element）：消息来源反查与 reload/桥消息定位用
  const framesRef = useRef(new Map<number, HTMLIFrameElement | null>());
  // 编辑态唯一事实源（画布级单值，null=全部交互态）：工具条切换与桥内双击进入 / Esc 退出
  // 两条路径都收敛到本 state，回执消息同值回写 bail-out 不成环（蓝图 §1.4）
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  // 编辑钮 ref：退出编辑的焦点交接目标（蓝图 A.5——Esc 退出后键盘用户不得滞留子文档）
  const editBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevEditingRef = useRef<number | null>(null);
  useEffect(() => {
    const previous = prevEditingRef.current;
    prevEditingRef.current = editingNodeId;
    if (previous === null || editingNodeId !== null) return;
    // 退出瞬间焦点仍在画布域（iframe 元素/空 body）才接管：用户已显式点选别处（树行/
    // 工具栏）时不抢焦点
    const active = document.activeElement;
    const focusLostToCanvas =
      active === null ||
      active === document.body ||
      (active instanceof HTMLElement && active.classList.contains('lt-canvas-frame'));
    if (focusLostToCanvas) editBtnRef.current?.focus();
  }, [editingNodeId]);
  // 已装载集（onLoad 置位）：data-lt-canvas-mode 的取值门（装载前无值=桥未就绪信号语义）
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<number>>(new Set());
  // loadedIds 实时镜像（onLoad 回调读「此刻」值判定首装/导航——渲染闭包在同帧竞态下必陈旧）
  const loadedRef = useRef<ReadonlySet<number>>(new Set());
  useEffect(() => {
    loadedRef.current = loadedIds;
  }, [loadedIds]);
  // onDocEdit 实时镜像（message 订阅挂载期一次，回调读最新——PreviewPanel nodeRef 同款模式）
  const onDocEditRef = useRef(onDocEdit);
  useEffect(() => {
    onDocEditRef.current = onDocEdit;
  }, [onDocEdit]);
  // onOpenVfsNode 实时镜像（link-open 路由用，同上）
  const onOpenVfsNodeRef = useRef(onOpenVfsNode);
  useEffect(() => {
    onOpenVfsNodeRef.current = onOpenVfsNode;
  }, [onOpenVfsNode]);
  // tabs 实时镜像（广播订阅挂载期一次，CSS 广播目标集读取最新）
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // 编辑态切换的桥消息下发（effect 闭包捕获「本渲染的编辑节点」）：body 对其发 enter 并把
  // 键盘焦点交给文档（蓝图 A.5：编辑态的唯一目的是键入），cleanup 对同一捕获值发 exit
  // （切签收口旧文档、卸载亦经 cleanup；iframe 已销毁时可选链静默）
  useEffect(() => {
    const notify = (nodeId: number, type: 'lt:edit-enter' | 'lt:edit-exit'): void => {
      framesRef.current.get(nodeId)?.contentWindow?.postMessage({ type }, '*');
    };
    // 装载门：桥随文档装载才存在，装载前 postMessage 落入未装桥文档被丢弃——依赖含
    // loadedIds 使装载完成后重跑补发 enter（桥 enterEdit 幂等，重入无副作用）
    if (editingNodeId !== null && loadedIds.has(editingNodeId)) {
      notify(editingNodeId, 'lt:edit-enter');
      framesRef.current.get(editingNodeId)?.contentWindow?.focus();
    }
    return () => {
      if (editingNodeId !== null) notify(editingNodeId, 'lt:edit-exit');
    };
  }, [editingNodeId, loadedIds]);

  // 桥消息接收（挂载期一次，cleanup 成对）：来源精确比对画布 iframe 集（防他源消息串扰）。
  // lt:doc-edit → 保存管线；lt:edit-state → 工具条态同步（父窗下发后桥回执同值，bail-out）；
  // lt:link-open → 导航闸门转交的站内链接：以当前文档目录为基解析（vfs:// 为 standard
  // scheme，相对解析委托标准 URL 解析器），非 vfs scheme 静默取消（蓝图最低形态），
  // 命中节点经 onOpenVfsNode 开新标签（openFile 的拒开语义由 Workspace 统一承担）
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      for (const [nodeId, frame] of framesRef.current) {
        if (frame === null || frame.contentWindow !== event.source) continue;
        const edit = parseDocEdit(event.data);
        if (edit !== null) {
          onDocEditRef.current(nodeId, edit.html);
          return;
        }
        const state = parseEditState(event.data);
        if (state !== null) {
          setEditingNodeId((prev) => (state.editing ? nodeId : prev === nodeId ? null : prev));
          return;
        }
        const link = parseLinkOpen(event.data);
        if (link !== null) {
          const tab = tabsRef.current.find((t) => t.meta.id === nodeId);
          if (tab === undefined) return;
          try {
            const url = new URL(link.href, vfsUrl(tab.meta.virtualPath));
            if (url.protocol !== 'vfs:') return;
            const virtualPath = decodeURIComponent(url.pathname);
            void window.api
              .resolvePath({ virtualPath })
              .then((resolved) =>
                resolved.ok ? window.api.getNode({ nodeId: resolved.value.nodeId }) : null,
              )
              .then((meta) => {
                if (meta !== null && meta.ok) onOpenVfsNodeRef.current(meta.value);
              });
          } catch {
            // 相对解析失败（畸形 href）：导航闸门静默取消，不中断编辑会话
          }
        }
        return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  // CSS 热替换触发（挂载期一次，cleanup 成对；M4 spec §5.4 通道由 PreviewPanel 迁入）：
  // written 命中 text/css → 拉新文本对全部 HTML 画布广播（各 iframe 注入桥按自身 link
  // 匹配替换，未引用该 css 的文档静默无操作）；写入方画布会话按 D7 一律不整页重载，
  // 当前编辑文档引用的 css 变更由此通道零重载生效
  useEffect(() => {
    return window.api.onVfsChanged((broadcast) => {
      const event = broadcast.event;
      if (event.type !== 'written' || event.node.mimeType !== 'text/css') return;
      void fetch(vfsUrl(event.node.virtualPath))
        .then((res) => res.text())
        .then((text) => {
          for (const [, frame] of framesRef.current) {
            frame?.contentWindow?.postMessage(
              { type: 'lt:css-swap', path: event.node.virtualPath, text },
              '*',
            );
          }
        })
        .catch(() => undefined);
    });
  }, []);

  /** 从库重新加载（外部变更显式拉取）：脏态禁用（防静默覆盖本地修改）；replace 无 cache-busting。
   * 重载引发导航 → onLoad 统一收口（编辑目标不跨导航存活，见 handleLoad） */
  function reloadActive(): void {
    if (activeId === null || activeDirty) return;
    if (editingNodeId === activeId) setEditingNodeId(null);
    framesRef.current.get(activeId)?.contentWindow?.location.replace(vfsUrlOf(activeId));
  }

  /**
   * iframe 装载/导航完成：登记「桥就绪」（data-lt-canvas-mode 由此放行）；编辑态注销
   * （蓝图 A.1：画布重载/标签关闭 → 退出，编辑目标不跨导航存活——rename/move 引发 src
   * 变更同样走此口）；对账镜像复位由 editingNodeId effect 的 cleanup 发 exit 完成（桥已
   * 随文档重建为交互态，exit 为幂等 no-op）
   */
  function handleLoad(nodeId: number): void {
    // 首装 vs 导航的判定读实时镜像：首装（集内无此 id）不得清编辑意图——用户可在文档
    // 装载完成前点「编辑」，此刻下发会被跳过（桥未就绪），意图由「装载后补发」承接；
    // 导航（重命名/移动引发 src 变更、从库重新加载）则注销编辑态（不跨导航存活，蓝图 A.1）
    const firstLoad = !loadedRef.current.has(nodeId);
    setLoadedIds((prev) => {
      if (prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    if (!firstLoad) {
      setEditingNodeId((prev) => (prev === nodeId ? null : prev));
    }
  }

  /** 编辑态切换（工具条唯一程序化入口） */
  function toggleEditing(): void {
    if (activeId === null) return;
    setEditingNodeId((prev) => (prev === activeId ? null : activeId));
  }

  function vfsUrlOf(nodeId: number): string {
    const tab = tabsRef.current.find((t) => t.meta.id === nodeId);
    return tab !== undefined ? vfsUrl(tab.meta.virtualPath) : 'vfs://local/';
  }

  const editing = activeId !== null && editingNodeId === activeId;
  // 编辑态提示条退场存在性（蓝图 A.4 退场动画承载；退场期渲染离开时状态）
  const banner = useExitPresence(editing ? 'edit' : null, BANNER_EXIT_MS);
  return (
    <div className="lt-html-canvas relative flex min-h-0 flex-1 flex-col">
      {/* 每 HTML 标签一个保活 iframe：激活可见、后台 display:none（撤销历史随文档保留）；
          key=nodeId（会话身份），src 随 rename/move 更新触发导航（meta 由广播链新鲜化）。
          onLoad 不再自动进入编辑态（M9「交互优先」：加载完成即为浏览器语义交互态）。
          data-lt-canvas-mode 在 onLoad 后才有值（桥就绪/模式双信号锚，蓝图 A.6）。
          文档面基底 `bg-white`（保真修复，依据见设计系统 §十二）：浏览器对顶层文档恒以
          白色为画布基底，而 Chromium 中子文档根元素背景为 transparent 时其画布对嵌入者
          透明——文档自身未设 background（纯结构 HTML、外链 CSS 被 CSP 拦掉等）时应用底色
          即透过文档显示（实测文档区主色逐一等于应用底色：亮 #f8fafc / 暗 #0f172a，即用户
          所述「灰色遮罩层」）。基底落 iframe 元素而非文档内：不触碰用户文档（保存序列化
          零污染），白即浏览器默认画布，「不注入 UA 样式」保真红线不破（暗色主题下文档面
          亦为白，与浏览器一致） */}
      {tabs.map((tab) => (
        <iframe
          key={tab.meta.id}
          ref={(el) => {
            framesRef.current.set(tab.meta.id, el);
          }}
          className={`lt-canvas-frame min-h-0 w-full flex-1 bg-white${tab.meta.id === activeId ? '' : ' hidden'}`}
          title={`文档 ${tab.meta.name}`}
          data-lt-canvas-mode={
            loadedIds.has(tab.meta.id)
              ? tab.meta.id === editingNodeId
                ? 'edit'
                : 'interact'
              : undefined
          }
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={vfsUrl(tab.meta.virtualPath)}
          onLoad={() => {
            handleLoad(tab.meta.id);
          }}
        />
      ))}
      {/* 编辑态提示条（蓝图 A.2-2）：画布顶部居中浮动，不改变 iframe 尺寸（文档零重排）；
          pointer-events-none 不吞文档点击；文案逐字「编辑中 · 脚本与链接已暂停 · Esc 退出」 */}
      {banner !== null ? (
        <div
          role="status"
          className={`lt-canvas-edit-banner pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ${
            banner.leaving
              ? 'duration-100 ease-in animate-out fade-out slide-out-to-top-1 fill-mode-forwards'
              : 'duration-100 ease-out animate-in fade-in slide-in-from-top-1'
          }`}
        >
          编辑中 · 脚本与链接已暂停 · Esc 退出
        </div>
      ) : null}
      {/* 浮动工具条（spec §3.3 D7 + M9 编辑态入口，蓝图 A.2-1）：绝对定位右下角纵向排列，
          不随文档滚动；容器 pointer-events-none（透明区与两钮间 8px 缝隙不吞文档点击），
          钮各自 pointer-events-auto。「编辑」钮 aria-label 恒常、aria-pressed 承载态
          （蓝图 §1.4：开关语义下随态改名与 aria-pressed 并存自相矛盾），编辑态换实心主色
          + X 图标；「从库重新加载」脏态禁用（防静默覆盖）。按压走 scale 档（32px 热区
          ≥ 28px 判定线），纪律依据见 features/ui/classStrings.ts 按压纪律 */}
      <div className="lt-canvas-toolbar pointer-events-none absolute right-4 bottom-4 flex flex-col items-center gap-2">
        <button
          ref={editBtnRef}
          type="button"
          aria-label="编辑"
          aria-pressed={editing ? 'true' : 'false'}
          title={editing ? '退出编辑（Esc）' : '编辑文档内容（脚本与链接将暂停）'}
          disabled={activeId === null}
          className={`lt-canvas-edit-toggle pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-md transition-[color,background-color,scale] duration-100 active:duration-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
            editing
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-popover text-popover-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
          onClick={toggleEditing}
        >
          {editing ? (
            <X aria-hidden="true" className="size-4" />
          ) : (
            <Pencil aria-hidden="true" className="size-4" />
          )}
        </button>
        <button
          type="button"
          aria-label="从库重新加载"
          title={activeDirty ? '有未保存更改，保存或撤销后可重新加载' : '从库重新加载'}
          disabled={activeId === null || activeDirty}
          className="lt-canvas-reload pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md transition-[color,background-color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          onClick={reloadActive}
        >
          <RotateCw aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
