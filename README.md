# LearningText

跨平台桌面端 **HTML 文档管理与实时预览工具**：所有文档保存在一个本地 SQLite 数据库中，由自建虚拟文件系统（VFS）统一管理；编辑 HTML 时实时预览，渲染结果与浏览器完全一致；支持文件名与内容的模糊搜索。

## 核心特性

- **浏览器级渲染保真**：内嵌 Chromium 内核，预览即浏览器效果，无自研排版
- **虚拟文件系统**：目录/文件统一节点树，路径化访问，软删除回收站，全部存于单个 SQLite 文件（WAL + FTS5）
- **实时预览**：编辑去抖后自动刷新，事务提交后才刷新，预览与库内数据强一致
- **模糊搜索**：文件名 + 内容全文检索（FTS5 trigram，原生支持中文子串匹配）
- **导入导出**：与真实磁盘目录互转，导出后 HTML 可直接在浏览器打开
- **跨平台**：Windows 10+ / macOS 12+ / Ubuntu 22.04+

## 文档导航

| 文档 | 内容 |
| ---- | ---- |
| [docs/01-功能模块定义](./docs/01-功能模块定义.md) | 8 大模块的职责、边界、依赖关系与非目标 |
| [docs/02-技术选型](./docs/02-技术选型.md) | 关键决策点对比（Electron vs Tauri 等）与结论 |
| [docs/03-全局需求规格说明书](./docs/03-全局需求规格说明书.md) | 架构、数据模型、功能/非功能需求、接口契约、里程碑 |

> 当前状态：**设计阶段**。需求基线以 03 号文档为准，实现工作将在 spec 评审通过后按里程碑推进（M0 脚手架 → M1 存储与 VFS → M2 搜索 → M3 预览 → M4 编辑器 → M5 辅助 → M6 打包）。

## 技术栈

Electron · TypeScript · React + Vite · CodeMirror 6 · better-sqlite3（FTS5 trigram）· Vitest + Playwright · electron-builder

## 开发（实现阶段生效）

```bash
npm install        # 安装依赖
npm run dev        # 开发模式启动
npm test           # 单元 + 集成测试
npm run lint       # 代码检查
npm run build      # 三平台打包
```

## 许可证

暂未确定（待定：MIT）。
