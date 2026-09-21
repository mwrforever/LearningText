/**
 * 应用根组件（M6 spec §2 壳层重构）：标题栏/活动栏/侧栏/画布/状态栏全部收拢进 Workspace
 * 壳层结构，本组件仅承担视口容器与全局 toast 宿主；应用标题 h1 由 TitleBar 承载
 * （E2E 锚点语义不变，仅挂载位置移动）。
 */
import { ToastHost } from './features/ui/Toast';
import { Workspace } from './features/workspace/Workspace';

export function App(): React.JSX.Element {
  return (
    // 应用壳铺满视口（设计系统文档 §二 布局语言）：面板内部滚动、页面级不滚动
    <main className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      <Workspace />
      <ToastHost />
    </main>
  );
}
