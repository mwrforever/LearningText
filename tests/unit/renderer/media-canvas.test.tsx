// @vitest-environment jsdom
// 媒体画布冒烟（M6 spec §2.4/D4，批次②）：image → <img>、audio → <audio controls> 以
// vfs:// 原生直载；加载失败 onError 落「文档不可用」占位；切节点复位失败态（上一节点的
// 不可用事实不沾染后续节点）。纯呈现组件：props 仅 node，断言渲染结构与占位切换。
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NodeMeta } from '../../../src/shared/vfs-contract';
import { MediaCanvas } from '../../../src/renderer/src/features/canvas/MediaCanvas';

function mediaMeta(id: number, name: string, mimeType: string): NodeMeta {
  return {
    id,
    parentId: 1,
    nodeType: 'file',
    name,
    virtualPath: `/${name}`,
    mimeType,
    size: 8,
    createdAt: '2026-09-18T10:00:00.000+08:00',
    updatedAt: '2026-09-18T10:00:00.000+08:00',
  };
}

let container: HTMLElement;
let tree: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  tree = createRoot(container);
});
afterEach(() => {
  act(() => {
    tree.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
});

describe('MediaCanvas（媒体标签画布）', () => {
  it('image meta 渲染 <img>：src 经 vfs:// 直载、alt 为文件名', () => {
    act(() => {
      tree.render(<MediaCanvas node={mediaMeta(3, 'pic.png', 'image/png')} />);
    });
    const img = container.querySelector('img.lt-media-content');
    expect(img?.getAttribute('src')).toBe('vfs://local/pic.png');
    expect(img?.getAttribute('alt')).toBe('pic.png');
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    // 加载失败：媒体元素退场，「文档不可用」占位呈现（lt-media-empty 锚点）
    expect(container.querySelector('img.lt-media-content')).toBeNull();
    expect(container.querySelector('.lt-media-empty')?.textContent).toContain('文档不可用');
  });

  it('audio meta 渲染 <audio controls>：src 经 vfs:// 直载；onError 同样落占位', () => {
    act(() => {
      tree.render(<MediaCanvas node={mediaMeta(4, 'song.mp3', 'audio/mpeg')} />);
    });
    const audio = container.querySelector('audio.lt-media-content');
    expect(audio?.hasAttribute('controls')).toBe(true);
    expect(audio?.getAttribute('src')).toBe('vfs://local/song.mp3');
    expect(container.querySelector('img')).toBeNull();
    act(() => {
      audio?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('audio.lt-media-content')).toBeNull();
    expect(container.querySelector('.lt-media-empty')?.textContent).toContain('文档不可用');
  });

  it('切节点复位失败态：上一节点加载失败的占位不带到新节点（按 node.id 复位）', () => {
    act(() => {
      tree.render(<MediaCanvas node={mediaMeta(3, 'broken.png', 'image/png')} />);
    });
    const img = container.querySelector('img.lt-media-content');
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('.lt-media-empty')).not.toBeNull();
    // 切到另一节点（id 变化）：复位为媒体元素直载，占位退场
    act(() => {
      tree.render(<MediaCanvas node={mediaMeta(5, 'other.png', 'image/png')} />);
    });
    expect(container.querySelector('.lt-media-empty')).toBeNull();
    const next = container.querySelector('img.lt-media-content');
    expect(next?.getAttribute('src')).toBe('vfs://local/other.png');
  });
});
