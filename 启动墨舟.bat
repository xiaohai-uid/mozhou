@echo off
setlocal
chcp 65001 > nul
title 墨舟 (Novel OS) 一键启动器

echo ========================================================
echo   墨舟 (Novel OS) - 本地优先长篇小说 AI 创作系统
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 22。
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) === 22 ? 0 : 1)"
if %errorlevel% neq 0 (
    echo [错误] 本发行版要求 Node.js 22。当前版本：
    node --version
    pause
    exit /b 1
)

set ONNXRUNTIME_NODE_INSTALL_CUDA=skip

if not exist node_modules (
    echo [提示] 首次运行：按锁文件安装生产依赖（pnpm 9.15.0）...
    call npx --yes pnpm@9.15.0 install --prod --frozen-lockfile
    if %errorlevel% neq 0 (
        echo [错误] 生产依赖安装失败；未放宽锁文件约束。
        pause
        exit /b 1
    )
)

if not exist apps\web\dist\index.html (
    echo [错误] 发行包缺少 apps\web\dist\index.html
    pause
    exit /b 1
)
if not exist apps\web\dist-server\productionServer.js (
    echo [错误] 发行包缺少正式 Node 服务产物。
    pause
    exit /b 1
)

node scripts\launcher.mjs
if %errorlevel% neq 0 (
    echo [错误] 墨舟服务异常退出。
    pause
    exit /b %errorlevel%
)

endlocal
