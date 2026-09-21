/**
 * 预览面板（M3 spec §3.1/§4）：沙箱 iframe（allow-scripts 无 allow-same-origin）+
 * 刷新链路——node/路径 props 变化重挂（key=url 全新加载），同路径内容变更
 * `contentWindow.location.replace()`（评审钉死：无 cache-busting）；rev 状态机防撕裂。
 * iframe 内子资源与文档加载全由 Chromium 标准行为完成（保真，FR-RENDER-01）。
 * 打磨批次（M4 终审 M-4/M-5）：订阅挂载期一次（node 经 ref 比较）；written 命中先
 * getNode 反查（路径新鲜双保险，spec §6.1），失败置「文档不可用」占位不重载旧路径；
 * text/css 写入经 fetch 新文本 postMessage 触发 iframe 内热替换（接收端归 Task 9 注入）。
 * M5 批次⑤ Task 11：滚动同步（FR-RENDER-06）——下行：向 scrollPostRef 槽位登记「按比例
 * 投递 lt:scroll-ratio 到 iframe」实现（'*' targetOrigin 为 M3 §7.2 既定协议；开关关闭
 * 静默不投递），卸载摘除成对；上行：window message 监听（挂载期一次）经 parseScrollReport
 * 收窄后、开关开启才回调 onScrollReport（Workspace 中转至编辑器锚点滚动），来源精确比对
 * 本 iframe 防串扰。开关钮为会话级偏好（D14，不进 settings），默认开启。
 * 媒体只读分支（M5 批次⑦ Task 14，FR-EDIT-04）：image 走 <img>、audio 走 <audio controls>
 * 直载 vfs:// 资源（浏览器原生能力，保真）；加载失败经 onError 复用既有「文档不可用」占位
 * 通道（unavailable 态，切节点复位）。媒体态无 iframe 即无滚动同步语义：开关条不渲染（Task 11
 * html 分支原样），投递/接收 effect 不感知（iframeRef 空引用经可选链天然 no-op）。
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, FileX } from 'lucide-react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { previewableMime } from './previewableMime';
import {
  initialRevState,
  onBroadcast,
  onLoadDone,
  onReloadStart,
  type RevState,
} from './refreshModel';
import { parseScrollReport } from './scrollSync';
import type { ScrollRatioMessage } from './scrollSync';
import { vfsUrl } from './vfsUrl';

export interface PreviewPanelProps {
  /** 当前预览节点（null → 占位；rename 后树重取推新 virtualPath 即触发重挂） */
  readonly node: NodeMeta | null;
  /**
   * 滚动同步下行投递槽（M5 Task 11）：面板在 effect 内登记「按比例投递 lt:scroll-ratio
   * 到 iframe」实现（开关关闭时不投递——D14 会话级开关），卸载时摘除（置 null）；编辑器侧
   * 滚动经 Workspace 中转调用。缺省（未接线/测试桩）不登记
   */
  readonly scrollPostRef?: React.RefObject<((ratio: number) => void) | null>;
  /**
   * 滚动同步上行出口（M5 Task 11）：收到本 iframe 的合法 lt:scroll-report 且开关开启时
   * 回调（Workspace 桥接到编辑器锚点滚动）；开关关闭、来源不符或消息形态非法不回调
   */
  readonly onScrollReport?: (anchorText: string) => void;
}

export function PreviewPanel({
  node,
  scrollPostRef,
  onScrollReport,
}: PreviewPanelProps): React.JSX.Element | null {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const revRef = useRef<RevState>(initialRevState);
  const [url, setUrl] = useState<string | null>(null);
  // effect 内同步最新 url（先例 75647f2：ref 赋值禁在渲染期）：reload 经 ref 读取，
  // 订阅闭包不持滞后帧（非派生 state）
  const urlRef = useRef<string | null>(null);
  // node 实时镜像（订阅挂载一次的比较基准，effect 内同步合法——75647f2 先例）
  const nodeRef = useRef<NodeMeta | null>(node);
  // written 命中但 getNode 反查失败（节点已不存在/不可达）：置占位态，不重载旧路径
  const [unavailable, setUnavailable] = useState(false);
  // 滚动同步开关（M5 Task 11，D14）：会话级偏好，不进 settings；默认开启
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true);
  // 开关实时镜像（投递闭包与 message 订阅均挂载期一次，触发时刻读最新值——urlRef 同款模式）
  const scrollSyncEnabledRef = useRef(scrollSyncEnabled);
  useEffect(() => {
    scrollSyncEnabledRef.current = scrollSyncEnabled;
  }, [scrollSyncEnabled]);
  // onScrollReport 实时镜像（订阅挂载期一次，回调读最新——nodeRef 同款模式）
  const onScrollReportRef = useRef(onScrollReport);
  useEffect(() => {
    onScrollReportRef.current = onScrollReport;
  }, [onScrollReport]);

  // 外部数据到达（node/路径变化）：刷新链路的状态同步 effect。重挂即重置 rev 基线，
  // 并复位反查失败占位态（切节点即脱离上一节点的不可用事实）
  useEffect(() => {
    revRef.current = initialRevState;
    urlRef.current = node === null ? null : vfsUrl(node.virtualPath);
    nodeRef.current = node;
    setUrl(urlRef.current);
    setUnavailable(false);
  }, [node]);

  // 滚动同步下行投递登记（M5 Task 11，挂载期一次，卸载摘除成对）：'*' targetOrigin 为
  // M3 §7.2 既定协议（opaque origin 子文档唯一可通形态，同 css-swap 先例）；开关关闭
  // 静默不投递（会话级 D14）
  useEffect(() => {
    const slot = scrollPostRef;
    if (slot === undefined) return undefined;
    slot.current = (ratio: number) => {
      if (!scrollSyncEnabledRef.current) return;
      const message: ScrollRatioMessage = { type: 'lt:scroll-ratio', ratio };
      iframeRef.current?.contentWindow?.postMessage(message, '*');
    };
    return () => {
      slot.current = null;
    };
  }, [scrollPostRef]);

  // 滚动 report 接收（M5 Task 11，挂载期一次，cleanup 成对摘除）：来源精确比对本 iframe
  // （防他源消息串扰；iframe 不在场即一概拒收），形态经 parseScrollReport 收窄（外部输入
  // 禁断言），开关关闭不联动编辑器
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const report = parseScrollReport(event.data);
      if (report === null) return;
      if (!scrollSyncEnabledRef.current) return;
      onScrollReportRef.current?.(report.anchorText);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  function reload(): void {
    const current = urlRef.current;
    if (current === null) return;
    revRef.current = onReloadStart(revRef.current);
    iframeRef.current?.contentWindow?.location.replace(current);
  }

  function onLoad(): void {
    const result = onLoadDone(revRef.current);
    revRef.current = result.state;
    if (result.catchUp) reload();
  }

  // 广播订阅（挂载期一次，cleanup 成对解绑；终审 M-4 收口）：消除随 node 重建订阅的
  // 退订/重订微窗口——比较基准走 nodeRef，url 读取走 urlRef，均不受订阅不重建影响。
  // written 命中当前节点：重载前 getNode 反查（路径新鲜双保险，spec §6.1）——失败置占位；
  // 非 CSS 命中即 replace 重载。写入节点为 text/css：拉新文本 postMessage 触发热替换
  // （M4 spec §5.4；接收端 lt:css-swap 监听归 Task 9 注入，本任务发出后静默属预期中间态）
  useEffect(() => {
    return window.api.onVfsChanged((broadcast) => {
      // rev 一律先记账（catch-up 判定依赖「落后」事实）
      revRef.current = onBroadcast(revRef.current, broadcast.rev);
      const event = broadcast.event;
      if (event.type === 'written') {
        const current = nodeRef.current;
        // 命中当前节点：反查成功才重载（meta 亦可能随写更新），失败置占位不重载旧路径
        if (current !== null && event.node.id === current.id) {
          void window.api.getNode({ nodeId: current.id }).then((result) => {
            if (!result.ok) {
              setUnavailable(true);
              return;
            }
            setUnavailable(false);
            reload();
          });
          return;
        }
        // CSS 热替换触发端（M4 spec §5.4）：拉新文本 postMessage 注入（替换失败静默）；
        // mimeType 契约为 string | null，与 'text/css' 严格相等比较即完成收窄
        if (event.node.mimeType === 'text/css') {
          void fetch(vfsUrl(event.node.virtualPath))
            .then((res) => res.text())
            .then((text) => {
              iframeRef.current?.contentWindow?.postMessage(
                { type: 'lt:css-swap', path: event.node.virtualPath, text },
                '*',
              );
            })
            .catch(() => undefined);
        }
      }
    });
    // 订阅挂载期一次（依赖恒空）；广播回调经 ref 读取实时 node/url，无陈旧闭包
  }, []);

  // 反查失败占位优先于 iframe（旧路径已不可达，保留 iframe 只会呈现失效内容）
  if (url !== null && unavailable) {
    // 占位态（content 档 14px 次要文字，居中；文案为 E2E/单测断言锚点零变更）。
    // 打磨（M5 Task 15）：组合空态图标——装饰性 aria-hidden，文本锚点不变
    return (
      <div className="lt-preview-empty flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <FileX aria-hidden="true" strokeWidth={1.5} className="h-6 w-6 opacity-60" />
        <p className="m-0">文档不可用</p>
      </div>
    );
  }
  if (url === null) {
    return (
      <div className="lt-preview-empty flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <FileText aria-hidden="true" strokeWidth={1.5} className="h-6 w-6 opacity-60" />
        <p className="m-0">未选中文件</p>
      </div>
    );
  }
  // 媒体只读分支（M5 批次⑦，FR-EDIT-04）：img/audio 经原生组件直载 vfs:// 资源；key=url
  // 与 iframe 同款「路径变化全新重挂」语义；加载失败复用 unavailable 通道落「文档不可用」
  // 占位（切节点由既有 node effect 复位）。媒体态不渲染滚动同步开关条（无 iframe 可同步，
  // 开关无操作对象；登记/接收 effect 不感知——iframeRef 为空时可选链天然 no-op）
  if (node !== null && node.mimeType !== null) {
    const mediaKind = previewableMime(node.mimeType);
    if (mediaKind === 'image') {
      return (
        <div className="lt-preview flex min-h-0 flex-1 flex-col">
          <img
            key={url}
            src={url}
            alt={node.name}
            className="lt-preview-media min-h-0 min-w-0 flex-1 object-contain p-2"
            onError={() => setUnavailable(true)}
          />
        </div>
      );
    }
    if (mediaKind === 'audio') {
      return (
        <div className="lt-preview flex min-h-0 flex-1 flex-col items-center justify-center p-4">
          <audio
            key={url}
            controls
            src={url}
            className="lt-preview-media w-full max-w-md"
            onError={() => setUnavailable(true)}
          />
        </div>
      );
    }
  }
  return (
    <div className="lt-preview flex min-h-0 flex-1 flex-col">
      {/* 滚动同步开关条（M5 Task 11，D14 会话级偏好）：aria-pressed 表达开合态；开启态
          以 accent 底色区分（工具钮通用串 + 受控态条件拼接，cn/tailwind-merge 运行时留给
          shadcn 组件场景，D28 体积红线） */}
      <div className="lt-preview-bar flex h-7 shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-2">
        <button
          type="button"
          aria-label="滚动同步"
          aria-pressed={scrollSyncEnabled}
          className={`inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium transition-colors duration-100 hover:bg-accent hover:text-accent-foreground ${
            scrollSyncEnabled ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
          onClick={() => setScrollSyncEnabled((prev) => !prev)}
        >
          滚动同步
        </button>
      </div>
      <iframe
        // key=url：路径变化全新重挂（新历史条目无关——用户导航语义），内容更新走 replace（§4.2）
        key={url}
        ref={iframeRef}
        className="lt-preview-frame min-h-0 w-full flex-1"
        title="预览"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={url}
        onLoad={onLoad}
      />
    </div>
  );
}
