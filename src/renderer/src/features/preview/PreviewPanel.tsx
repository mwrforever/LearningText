/**
 * 预览面板（M3 spec §3.1/§4）：沙箱 iframe（allow-scripts 无 allow-same-origin）+
 * 刷新链路——node/路径 props 变化重挂（key=url 全新加载），同路径内容变更
 * `contentWindow.location.replace()`（评审钉死：无 cache-busting）；rev 状态机防撕裂。
 * iframe 内子资源与文档加载全由 Chromium 标准行为完成（保真，FR-RENDER-01）。
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

  // 外部数据到达（node/路径变化）：唯一允许 effect（订阅同步）。重挂即重置 rev 基线
  useEffect(() => {
    revRef.current = initialRevState;
    urlRef.current = node === null ? null : vfsUrl(node.virtualPath);
    setUrl(urlRef.current);
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

  // 广播订阅（挂载期一次，cleanup 成对解绑）：written 命中当前节点→replace 重载；
  // rev 一律先记账（catch-up 判定依赖「落后」事实）
  useEffect(() => {
    return window.api.onVfsChanged((broadcast) => {
      revRef.current = onBroadcast(revRef.current, broadcast.rev);
      const event = broadcast.event;
      if (event.type === 'written' && event.node.id === node?.id) {
        reload();
      }
    });
    // 订阅随 node 重建（闭包捕获当前 node 比较基准）；url 读取走 ref 不受重建影响
  }, [node]);

  if (url === null) {
    return <div className="lt-preview-empty">未选中文件</div>;
  }
  return (
    <iframe
      // key=url：路径变化全新重挂（新历史条目无关——用户导航语义），内容更新走 replace（§4.2）
      key={url}
      ref={iframeRef}
      className="lt-preview-frame"
      title="预览"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={url}
      onLoad={onLoad}
    />
  );
}
