@echo off
rem LearningText 启动脚本（Windows / 生产形态验证，M6 spec §6）
rem 流程：node 检查 -> 依赖安装（缺失时）-> 原生模块重编（ABI 保证）-> 生产构建 -> 启动
rem 幂等可重复执行；任一步失败即中止（宪法 A.5-2/3：better-sqlite3 必须与 Electron ABI 匹配）
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

rem 步骤 0：Node 存在检查（engines 钉 24 LTS，C.6-1）
where node >nul 2>nul
if errorlevel 1 (
  echo [启动] 未检测到 Node.js，请先安装 Node 24 LTS：https://nodejs.org
  exit /b 1
)

rem 步骤 1：依赖安装（node_modules 缺失时才装，避免重复全量安装）
if not exist node_modules (
  echo [启动][1/4] 首次运行，安装依赖（npm ci）...
  call npm ci
  if errorlevel 1 goto :fail
) else (
  echo [启动][1/4] 依赖已存在，跳过安装
)

rem 步骤 2：原生模块重编（每次都跑：保证 better-sqlite3 与当前 Electron 版本 ABI 一致）
echo [启动][2/4] 重编原生模块（electron-rebuild，约 1 分钟）...
call npm run rebuild
if errorlevel 1 goto :fail

rem 步骤 3：生产构建（主进程编译 + preload 捆绑 + 渲染层 vite build）
echo [启动][3/4] 生产构建...
call npm run build
if errorlevel 1 goto :fail

rem 步骤 4：启动应用（生产形态：加载 app:// 产物页）
echo [启动][4/4] 启动 LearningText...
call npm start
goto :eof

:fail
echo [启动] 上一步骤失败，已中止。请检查上方错误输出。
exit /b 1
