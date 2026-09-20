/**
 * 应用根组件（M3）：M0 空壳升级为最小预览工作台挂载点；h1 保留（E2E 锚点 app.spec.ts）。
 * M4 起挂载全局 toast 宿主（spec §5.5 D11：VFS 操作与保存失败的用户可读反馈出口）。
 */
import { ToastHost } from './features/ui/Toast';
import { Workspace } from './features/workspace/Workspace';

export function App(): React.JSX.Element {
  return (
    // 应用壳铺满视口（设计系统文档 §二 布局语言）：面板内部滚动、页面级不滚动
    <main className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* 应用标题栏（E2E 锚点 h1 文本零变更）：chrome 档 12px 中性、下边框与三栏区分隔 */}
      <h1 className="m-0 shrink-0 select-none border-b border-border px-4 py-2 text-sm font-semibold tracking-wide">
        LearningText
      </h1>
      <Workspace />
      <ToastHost />
    </main>
  );
}
