/**
 * 预览面板（M3 spec §3.1/§4）：沙箱 iframe（allow-scripts 无 allow-same-origin）+
 * 刷新链路——node/路径 props 变化重挂（key=url 全新加载），同路径内容变更
 * `contentWindow.location.replace()`（评审钉死：无 cache-busting）；rev 状态机防撕裂。
 * iframe 内子资源与文档加载全由 Chromium 标准行为完成（保真，FR-RENDER-01）。
 * 打磨批次（M4 终审 M-4/M-5）：订阅挂载期一次（node 经 ref 比较）；written 命中先
 * getNode 反查（路径新鲜双保险，spec §6.1），失败置「文档不可用」占位不重载旧路径；
 * text/css 写入经 fetch 新文本 postMessage 触发 iframe 内热替换（接收端归 Task 9 注入）。
 */
import { useEffect, useRef, useState } from 'react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import {
  initialRevState,
  onBroadcast,
  onLoadDone,
  onReloadStart,
  type RevState,
} from './refreshModel';
import { vfsUrl } from './vfsUrl';

export interface PreviewPanelProps {
  /** 当前预览节点（null → 占位；rename 后树重取推新 virtualPath 即触发重挂） */
  readonly node: NodeMeta | null;
}

export function PreviewPanel({ node }: PreviewPanelProps): React.JSX.Element | null {
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

  // 外部数据到达（node/路径变化）：唯一允许 effect（订阅同步）。重挂即重置 rev 基线，
  // 并复位反查失败占位态（切节点即脱离上一节点的不可用事实）
  useEffect(() => {
    revRef.current = initialRevState;
    urlRef.current = node === null ? null : vfsUrl(node.virtualPath);
    nodeRef.current = node;
    setUrl(urlRef.current);
    setUnavailable(false);
  }, [node]);

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
    // 占位态（content 档 14px 次要文字，居中；文案为 E2E/单测断言锚点零变更）
    return (
      <div className="lt-preview-empty flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        文档不可用
      </div>
    );
  }
  if (url === null) {
    return (
      <div className="lt-preview-empty flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        未选中文件
      </div>
    );
  }
  return (
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
  );
}
