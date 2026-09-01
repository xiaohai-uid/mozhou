@echo off
chcp 65001 > nul
title 墨舟 (Novel OS) 一键启动器

echo ========================================================
echo   🌊 墨舟 (Novel OS) - 生产级长篇小说 AI 创作系统
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 环境！
    echo 请先前往官网下载并安装 Node.js (推荐 v20 或 v22 LTS): https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 未检测到 pnpm，正在通过 npm 自动安装 pnpm...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [错误] pnpm 安装失败，请手动执行: npm i -g pnpm
        pause
        exit /b 1
    )
)

if not exist node_modules (
    echo [提示] 首次运行，正在安装生产依赖...
    set ONNXRUNTIME_NODE_INSTALL_CUDA=skip
    call pnpm install --frozen-lockfile
    if %errorlevel% neq 0 (
        call pnpm install
    )
)

echo [提示] 正在启动墨舟创作工作台...
set ONNXRUNTIME_NODE_INSTALL_CUDA=skip
node scripts/launcher.mjs

pause
