# LearningText

跨平台桌面端 **HTML 文档管理工具**（VS Code 式工作台）：所有文档保存在一个本地 SQLite 数据库中，由自建虚拟文件系统（VFS）统一管理；HTML 直接在渲染结果上**所见即所得编辑**（Typora 式，渲染面即编辑面，与浏览器打开完全一致）；支持文件名与内容的模糊搜索。

## 核心特性

- **所见即所得编辑**：HTML 直接在渲染面上编辑（仅既有元素的内容级修改；删除元素保存后即移除），无源码/预览双面板；CSS/JS 等文本文件走 CodeMirror 源码编辑
- **浏览器级渲染保真**：内嵌 Chromium 内核，编辑面即浏览器效果，无自研排版
- **VS Code 式工作台**：自绘标题栏 + 应用内菜单、活动栏、侧栏（资源树/搜索/回收站）、多标签、状态栏、欢迎页，全量图标化（lucide）
- **虚拟文件系统**：目录/文件统一节点树，路径化访问，软删除回收站，全部存于单个 SQLite 文件（WAL + FTS5）
- **模糊搜索**：文件名 + 内容全文检索（FTS5 trigram，原生支持中文子串匹配）
- **导入导出**：与真实磁盘目录互转，导出后 HTML 可直接在浏览器打开
- **数据位置可控**：数据默认存于标准用户数据目录，可在设置中更改位置并原子迁移；NSIS 安装包支持选择安装位置
- **跨平台**：Windows 10+ / macOS 12+ / Ubuntu 22.04+

## 文档导航

| 文档 | 内容 |
| ---- | ---- |
| [docs/01-功能模块定义](./docs/01-功能模块定义.md) | 8 大模块的职责、边界、依赖关系与非目标 |
| [docs/02-技术选型](./docs/02-技术选型.md) | 关键决策点对比（Electron vs Tauri 等）与结论 |
| [docs/03-全局需求规格说明书](./docs/03-全局需求规格说明书.md) | 架构、数据模型、功能/非功能需求、接口契约、里程碑 |
| [docs/design/布局蓝图.md](./docs/design/布局蓝图.md) | 工作台布局蓝图（M6 谋局定稿） |

> 当前状态：**M6 产品化重构**（UI 全面 VS Code 化 + 所见即所得 + 数据目录迁移 + 打包能力）。

## 技术栈

Electron · TypeScript · React + Vite + Tailwind CSS v4 + shadcn/ui · CodeMirror 6 · better-sqlite3（FTS5 trigram）· Vitest + Playwright · electron-builder

## 开发与验证

```bash
# 一键验证（Windows 用 scripts\start.bat；bash 用 bash scripts/start.sh）：
# node 检查 → 依赖安装（缺失时）→ 原生模块重编 → 生产构建 → 启动应用

npm install        # 安装依赖
npm run rebuild    # better-sqlite3 匹配 Electron ABI（install 后必跑）
npm run dev        # 开发模式启动（渲染层/preload/主进程三路编排，另需 npm run start:dev 启动应用）
npm test           # 单元 + 集成 + E2E
npm run lint       # 代码检查
npm run build      # 生产构建
npm run package    # 三平台安装包（NSIS 支持选择安装位置）
```

## 许可证

暂未确定（待定：MIT）。
