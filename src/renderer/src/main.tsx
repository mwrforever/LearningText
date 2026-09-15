// 渲染进程入口：装配 React 根；#root 缺失视为装配失败直接抛错（fail-fast）
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './global.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('index.html 缺少 #root 挂载点');
}

createRoot(rootEl).render(<App />);
