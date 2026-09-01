#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  🌊 墨舟 (Novel OS) - 生产级长篇小说 AI 创作系统"
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js 环境！"
    echo "请先安装 Node.js (推荐 v20 或 v22 LTS): https://nodejs.org/"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "[提示] 未检测到 pnpm，正在通过 npm 安装..."
    npm install -g pnpm
fi

export ONNXRUNTIME_NODE_INSTALL_CUDA=skip

if [ ! -d "node_modules" ]; then
    echo "[提示] 首次运行，正在安装生产依赖..."
    pnpm install --frozen-lockfile || pnpm install
fi

echo "[提示] 正在启动墨舟创作工作台..."
node scripts/launcher.mjs
