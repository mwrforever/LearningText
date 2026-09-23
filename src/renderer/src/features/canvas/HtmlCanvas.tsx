/**
 * HTML 所见即所得画布（M6 spec §3.3，FR-RENDER-08/FR-EDIT-05）：每个打开的 HTML 标签
 * 一个保活沙箱 iframe（opaque origin + allow-scripts 红线不变）——激活可见、后台隐藏
 * （切标签保留浏览器原生撤销）；iframe onLoad 后经注入桥 lt:edit-enable 进入编辑态，
 * 编辑输入由桥内 200ms 去抖序列化经 lt:doc-edit 上报（onDocEdit 出口 → 保存管线）。
 * 文档面基底为浏览器白（`bg-white`，见 iframe 处注与设计系统 §十二）：子文档背景透明时
 * 应用底色会透出文档，曾表现为用户实测的「灰色遮罩层」。
 * 刷新抑制（spec D7）为结构性保证：画布自身不存在「写后重载」机制，written 广播不触发
 * 任何重载；外部变更（导入/还原）经右下角「从库重新加载」钮显式拉取（脏态禁用——
 * 本地修改与库内容冲突时禁止静默覆盖，取舍见进度台账）。CSS 热替换通道保留：written
 * 命中 text/css 时拉新文本对全部 HTML 画布广播 lt:css-swap（注入桥按各文档自身 link
 * 匹配替换，主文档零重载）。
 */
import { useEffect, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import type { TabState } from '../workspace/tabModel';
import { vfsUrl } from '../preview/vfsUrl';

export interface HtmlCanvasProps {
  /** 当前打开的 HTML 标签全集（全部渲染保活；由 Workspace 过滤注入） */
  readonly tabs: readonly TabState[];
  /** 激活标签 nodeId（null = 无激活，全部隐藏——实际不可达，契约收尾） */
  readonly activeId: number | null;
  /** 激活标签脏态（重新加载钮禁用判定） */
  readonly activeDirty: boolean;
  /** 编辑上报出口（Workspace：更新画布缓存 + SaveController.edit 进入保存管线） */
  onDocEdit(nodeId: number, html: string): void;
}

/** lt:doc-edit 消息收窄（外部输入禁断言，A.1-5）：type/html 双字段校验 */
function parseDocEdit(data: unknown): { nodeId: number; html: string } | null {
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; html?: unknown };
  if (msg.type !== 'lt:doc-edit' || typeof msg.html !== 'string') return null;
  // nodeId 由来源反查填充，此处仅 html
  return { nodeId: -1, html: msg.html };
}

export function HtmlCanvas({
  tabs,
  activeId,
  activeDirty,
  onDocEdit,
}: HtmlCanvasProps): React.JSX.Element {
  // iframe 实例表（nodeId → element）：消息来源反查与 reload/edit-enable 定位用
  const framesRef = useRef(new Map<number, HTMLIFrameElement | null>());
  // onDocEdit 实时镜像（message 订阅挂载期一次，回调读最新——PreviewPanel nodeRef 同款模式）
  const onDocEditRef = useRef(onDocEdit);
  useEffect(() => {
    onDocEditRef.current = onDocEdit;
  }, [onDocEdit]);
  // tabs 实时镜像（广播订阅挂载期一次，CSS 广播目标集读取最新）
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // iframe 装载完成：经注入桥进入编辑态（'*' targetOrigin 为 opaque origin 子文档唯一
  // 可通形态，css-swap 先例）；reload 后再次触发即重新进入编辑态
  function handleLoad(nodeId: number): void {
    framesRef.current.get(nodeId)?.contentWindow?.postMessage({ type: 'lt:edit-enable' }, '*');
  }

  // lt:doc-edit 接收（挂载期一次，cleanup 成对）：来源精确比对画布 iframe 集（防他源
  // 消息串扰），反查 nodeId 后经 onDocEdit 出口进入保存管线
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      for (const [nodeId, frame] of framesRef.current) {
        if (frame !== null && frame.contentWindow === event.source) {
          const edit = parseDocEdit(event.data);
          if (edit !== null) onDocEditRef.current(nodeId, edit.html);
          return;
        }
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

  /** 从库重新加载（外部变更显式拉取）：脏态禁用（防静默覆盖本地修改）；replace 无 cache-busting */
  function reloadActive(): void {
    if (activeId === null || activeDirty) return;
    framesRef.current.get(activeId)?.contentWindow?.location.replace(vfsUrlOf(activeId));
  }

  function vfsUrlOf(nodeId: number): string {
    const tab = tabsRef.current.find((t) => t.meta.id === nodeId);
    return tab !== undefined ? vfsUrl(tab.meta.virtualPath) : 'vfs://local/';
  }

  return (
    <div className="lt-html-canvas relative flex min-h-0 flex-1 flex-col">
      {/* 每 HTML 标签一个保活 iframe：激活可见、后台 display:none（撤销历史随文档保留）；
          key=nodeId（会话身份），src 随 rename/move 更新触发导航（meta 由广播链新鲜化）
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
          title={`编辑 ${tab.meta.name}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={vfsUrl(tab.meta.virtualPath)}
          onLoad={() => handleLoad(tab.meta.id)}
        />
      ))}
      {/* 浮动「从库重新加载」（spec §3.3 D7 外部变更入口）：绝对定位右下角，不随文档滚动。
          按压走 scale 档（32px 热区 ≥ 28px 判定线）：纯图标钮前景为 muted 色，按压面不加深
          表面（对比度不达正文门槛），纪律依据见 features/ui/classStrings.ts 按压纪律 */}
      <button
        type="button"
        aria-label="从库重新加载"
        title={activeDirty ? '有未保存更改，保存或撤销后可重新加载' : '从库重新加载'}
        disabled={activeId === null || activeDirty}
        className="absolute right-4 bottom-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground shadow-md transition-[color,background-color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        onClick={reloadActive}
      >
        <RotateCw aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
