#!/usr/bin/env bash
# LearningText 启动脚本（bash / 生产形态验证，M6 spec §6）
# 流程：node 检查 -> 依赖安装（缺失时）-> 原生模块重编（ABI 保证）-> 生产构建 -> 启动
# 幂等可重复执行；set -e 失败即停（宪法 A.5-2：better-sqlite3 必须与 Electron ABI 匹配）
set -euo pipefail
cd "$(dirname "$0")/.."

# 步骤 0：Node 存在检查（engines 钉 24 LTS，C.6-1）
if ! command -v node >/dev/null 2>&1; then
  echo "[启动] 未检测到 Node.js，请先安装 Node 24 LTS：https://nodejs.org"
  exit 1
fi

# 步骤 1：依赖安装（node_modules 缺失时才装，避免重复全量安装）
if [ ! -d node_modules ]; then
  echo "[启动][1/4] 首次运行，安装依赖（npm ci）..."
  npm ci
else
  echo "[启动][1/4] 依赖已存在，跳过安装"
fi

# 步骤 2：原生模块重编（每次都跑：保证 better-sqlite3 与当前 Electron 版本 ABI 一致）
echo "[启动][2/4] 重编原生模块（electron-rebuild，约 1 分钟）..."
npm run rebuild

# 步骤 3：生产构建（主进程编译 + preload 捆绑 + 渲染层 vite build）
echo "[启动][3/4] 生产构建..."
npm run build

# 步骤 4：启动应用（生产形态：加载 app:// 产物页）
echo "[启动][4/4] 启动 LearningText..."
npm start
