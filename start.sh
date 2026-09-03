#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo "  墨舟 (Novel OS) - 本地优先长篇小说 AI 创作系统"
echo "========================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js 22。"
  exit 1
fi

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) === 22 ? 0 : 1)"; then
  echo "[错误] 当前 Node.js 版本为 $(node --version)，本发行版要求 Node.js 22。"
  exit 1
fi

export ONNXRUNTIME_NODE_INSTALL_CUDA=skip

if [ ! -d "node_modules" ]; then
  echo "[提示] 首次运行：按锁文件安装生产依赖（pnpm 9.15.0）..."
  npx --yes pnpm@9.15.0 install --prod --frozen-lockfile
fi

require_file() {
  if [ ! -f "$1" ]; then
    echo "[错误] 发行包缺少必要产物: $1"
    exit 1
  fi
}

require_file "apps/web/dist/index.html"
require_file "apps/web/dist-server/productionServer.js"

node scripts/launcher.mjs
