@echo off
rem LearningText launcher (Windows, production form verification - M6 spec 6)
rem Flow: node check -> deps install (if missing) -> native rebuild -> build -> start
rem Idempotent; stops on first failure. (AGENTS.md A.5-2: better-sqlite3 must match Electron ABI)
rem NOTE: messages are ASCII on purpose - cmd.exe batch parsing desyncs on UTF-8
rem text with chcp 65001 (verified broken on zh-CN Windows); Chinese docs live
rem in scripts/start.sh and README.md.
setlocal
cd /d "%~dp0.."

rem Step 0: node presence check (engines pins Node 24 LTS, C.6-1)
where node >nul 2>nul
if errorlevel 1 (
  echo [start] Node.js not found. Please install Node 24 LTS: https://nodejs.org
  exit /b 1
)

rem Step 1: install dependencies only when node_modules is missing
if not exist node_modules (
  echo [start][1/4] Installing dependencies via npm ci ...
  call npm ci
  if errorlevel 1 goto :fail
) else (
  echo [start][1/4] node_modules present, skip install
)

rem Step 2: rebuild native module (always - keep better-sqlite3 ABI in sync)
echo [start][2/4] Rebuilding native module via electron-rebuild (about 1 min) ...
call npm run rebuild
if errorlevel 1 goto :fail

rem Step 3: production build (main tsc + preload bundle + renderer vite build)
echo [start][3/4] Production build ...
call npm run build
if errorlevel 1 goto :fail

rem Step 4: launch app (production form, loads app:// bundle)
echo [start][4/4] Launching LearningText ...
call npm start
goto :eof

:fail
echo [start] Previous step failed, aborted. Check output above.
exit /b 1
