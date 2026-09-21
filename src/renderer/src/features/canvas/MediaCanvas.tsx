/**
 * 媒体画布（M6 spec §2.4/D4，FR-EDIT-04 修订版）：媒体文件一律开标签，激活媒体标签时
 * 以系统原生组件直载 vfs:// 资源（image→<img>、audio→<audio controls>，浏览器原生能力
 * 即保真）；加载失败经 onError 落「文档不可用」占位，切节点复位。纯呈现组件。
 */
import { useEffect, useState } from 'react';
import { FileX } from 'lucide-react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
import { previewableMime } from '../preview/previewableMime';
import { vfsUrl } from '../preview/vfsUrl';

export interface MediaCanvasProps {
  /** 激活的媒体标签 meta（image/audio，由 Workspace 按 previewableMime 分流） */
  readonly node: NodeMeta;
}

export function MediaCanvas({ node }: MediaCanvasProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  // 切节点复位失败态（上一节点的加载失败事实不带到新节点）
  useEffect(() => {
    setFailed(false);
  }, [node.id]);
  const url = vfsUrl(node.virtualPath);
  const kind = node.mimeType !== null ? previewableMime(node.mimeType) : null;
  if (failed) {
    return (
      <div className="lt-media-empty flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <FileX aria-hidden="true" strokeWidth={1.5} className="h-6 w-6 opacity-60" />
        <p className="m-0">文档不可用</p>
      </div>
    );
  }
  return (
    <div className="lt-media flex min-h-0 flex-1 flex-col">
      {kind === 'image' ? (
        <img
          key={url}
          src={url}
          alt={node.name}
          className="lt-media-content min-h-0 min-w-0 flex-1 object-contain p-2"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <audio
            key={url}
            controls
            src={url}
            className="lt-media-content w-full max-w-md"
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
  );
}
