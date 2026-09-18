/**
 * 极简编辑区（M3 spec §6）：textarea 受控 + 输入去抖写（debounceMs 自设置通道）+
 * 保存钮立即写（清计时器）。props 面即 M4 CodeMirror 真编辑器最小接缝
 * （value 语义 / debounce 参数 / onSave 路径不变，仅换实现——评审 D5）。
 * 二进制 MIME 只读展示元信息不做编辑（FR-EDIT-04 P1 后置）。
 * 副作用全在事件处理器（A.1-10）：计时器句柄存 ref。
 */
import { useEffect, useRef, useState } from 'react';
import type { NodeMeta } from '../../../../shared/vfs-contract';
// 空绑定 type import：把 window-api.ts 的全局 Window.api 声明拉入渲染层编译程序
// （tsconfig.renderer.json 仅含 src/renderer，契约文件须经 import 进入程序；类型-only，构建期擦除）
import type {} from '../../../../shared/window-api';

export interface EditorPanelProps {
  /** 当前选中文件节点（null → 空态提示） */
  readonly node: NodeMeta | null;
  /** 去抖毫秒（FR-RENDER-03，spec §5 默认 300） */
  readonly debounceMs: number;
}

/** 文本可编辑 MIME 判定（渲染层本地最小实现；主进程 isTextualMime 归写库索引域，B.2 禁跨层 import） */
function isTextLike(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  );
}

export function EditorPanel({ node, debounceMs }: EditorPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelTimer(): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  // 直读闭包 node 的依据（评审 Important 修复，替代原 nodeRef 渲染期同步方案）：
  // 触发点（保存钮 onClick、去抖 setTimeout 回调）均为事件处理器闭包，绑定的是已提交
  // 渲染的 node，恒与最新 UI 状态一致；跨节点迟写由节点切换/卸载 effect cleanup 的
  // cancelTimer 防住。渲染期写 ref 属 React 19 习语禁止——并发渲染丢弃帧会把未提交
  // 的 node 污染进 ref，反而重新引入「陈旧节点误写」风险。
  function flushWrite(value: string): void {
    cancelTimer();
    if (node === null) return;
    void window.api
      .writeFile({ nodeId: node.id, content: new TextEncoder().encode(value) })
      .then((result) => {
        setNotice(result.ok ? '已保存' : `保存失败：${result.error.message}`);
      });
  }

  // 节点切换的唯一例外 effect（读内容入草稿——外部数据到达）；如实语义（终审 M-2）：
  // 节点切换经 [node] effect 体首行 cancelTimer 防跨节点迟写；卸载后悬挂去抖写=保存
  // 最新草稿到正确节点（无害；unsaved-guard 归 M4 收口，见 TASK.md 预览打磨批次）
  useEffect(() => {
    cancelTimer();
    setNotice('');
    if (node === null) {
      setDraft('');
      return undefined;
    }
    let alive = true;
    void window.api.readFile({ nodeId: node.id }).then((result) => {
      // 守卫前置使 Result 两分支各自收窄（联合类型在 !(alive && ok) 下推不出 error 变体）
      if (!alive) return;
      if (result.ok) {
        setDraft(new TextDecoder().decode(result.value.content));
      } else {
        setNotice(`读取失败：${result.error.message}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [node]);

  function onInput(value: string): void {
    setDraft(value);
    cancelTimer();
    timerRef.current = setTimeout(() => flushWrite(value), debounceMs);
  }

  if (node === null) {
    return <textarea readOnly placeholder="未选中文件" value="" onChange={() => undefined} />;
  }
  // 契约上 mimeType 为 null 仅目录（编辑区只接文件节点），按不可编辑保守处理
  if (node.mimeType === null || !isTextLike(node.mimeType)) {
    return (
      <textarea
        readOnly
        value=""
        placeholder={`二进制文件（${node.mimeType ?? '未知类型'}）不可编辑`}
        onChange={() => undefined}
      />
    );
  }
  return (
    <div className="lt-editor">
      <textarea
        aria-label="编辑区"
        value={draft}
        onChange={(e) => {
          onInput(e.target.value);
        }}
      />
      <div className="lt-editor-bar">
        {/* M4 原生菜单接管 Ctrl/Cmd+S，M3 仅按钮（spec §6） */}
        <button
          type="button"
          onClick={() => {
            flushWrite(draft);
          }}
        >
          保存
        </button>
        <span aria-live="polite">{notice}</span>
      </div>
    </div>
  );
}
