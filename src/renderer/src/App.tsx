/**
 * 应用根组件（M3）：M0 空壳升级为最小预览工作台挂载点；h1 保留（E2E 锚点 app.spec.ts）。
 * M4 起挂载全局 toast 宿主（spec §5.5 D11：VFS 操作与保存失败的用户可读反馈出口）。
 */
import { ToastHost } from './features/ui/Toast';
import { Workspace } from './features/workspace/Workspace';

export function App(): React.JSX.Element {
  return (
    <main>
      <h1>LearningText</h1>
      <Workspace />
      <ToastHost />
    </main>
  );
}
