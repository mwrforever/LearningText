/**
 * 应用根组件（M3）：M0 空壳升级为最小预览工作台挂载点；h1 保留（E2E 锚点 app.spec.ts）。
 */
import { Workspace } from './features/workspace/Workspace';

export function App(): React.JSX.Element {
  return (
    <main>
      <h1>LearningText</h1>
      <Workspace />
    </main>
  );
}
