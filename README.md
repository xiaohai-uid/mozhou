# 🌊 墨舟 (MoZhou / Novel OS)

> **定位**：长篇小说 AI 辅助创作操作系统 —— 工业级状态机 · 11 项机械门禁 · 本地数据自有 · 确定性长程因果契约

---

## 📌 版本声明与当前状态

当前发布版本定位为 **技术预览版 (Technical Preview / v0.2.0)**：
- **真实实现的核心**：本地十步生产管道（`@mozhou/pipeline`）、Story Brain 认知穿透（`@mozhou/kernel`）、11 项机械门禁与 4-gram 去复读（`@mozhou/quality-engine`）、确定性三通道加权 RRF 上下文装配（`@mozhou/context-compiler`）、本地 SQLite WAL 数据平面（`@mozhou/data-plane`），以及当前 Web/桌面工作台与导出链路；
- **AI 模型通道**：支持 **USER_BYOK（用户自带 Key）** 的 OpenAI-compatible 真实流式调用；未配置可用 Provider 时相关生成能力会显式显示不可用，只有明确开启 Demo 数据的环境才使用演示数据；
- **商业化状态**：当前为**社区免费技术预览版**。云同步/云备份、付费许可证激活与正式支付通道尚未作为本 Release 的可用能力发布。

---

## 🚀 快速启动与安装

### 方式一：Release 本地运行时（推荐）

v0.2.0 Technical Preview 的 GitHub Release/CI 产物与 `release-artifacts/` 使用同一套命名：
- **`mozhou-v0.2.0-local-runtime.tar.gz`**：Node.js 22 本地运行时。Windows 解压后运行 **`启动墨舟.bat`**；Linux/macOS 执行 `chmod +x start.sh && ./start.sh`；
- **`mozhou-v0.2.0-web-dist.tar.gz`**：已构建的 Web 静态产物；
- **`mozhou-v0.2.0-docker.tar.gz`**：本地 Docker 发行包；
- Release 同时提供 **SPDX SBOM** 与 **SHA256SUMS.txt** 用于供应链校验。

服务默认地址为 **`http://127.0.0.1:5173`**。当前 Release **不冒充原生 Windows/macOS 安装器**；Tauri 原生安装与代码签名仍作为独立发布面验收。

### 方式二：源码启动（开发者推荐）

```bash
# 1. 安装依赖（纯 CPU，本仓库显式禁止 onnxruntime 下载 CUDA 包）
# PowerShell:
$env:ONNXRUNTIME_NODE_INSTALL_CUDA="skip"; pnpm install
# Linux/macOS:
# ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install

# 2. 全量构建
pnpm build

# 3. 运行全量测试（发布门禁以当前 CI/本地实际输出为准）
pnpm test

# 4. 启动本地完整桌面/Web 创作工作台
pnpm --filter @mozhou/web dev
```

---

## 🔑 配置真实 AI 生成通道（BYOK）

墨舟支持完全无中转的本地直连 OpenAI 兼容上游服务。启动前在环境或 `.env` 中指定：

```bash
# 必填一项即可开启真实 LLM 流式草稿
export DEEPSEEK_API_KEY="sk-your-deepseek-key"
# 或 export OPENAI_API_KEY="sk-your-openai-key"
# 或 export MOZHOU_API_KEY="sk-your-custom-key"

# 可选：自定义上游地址与模型名（默认: https://api.deepseek.com / deepseek-chat）
export MOZHOU_API_BASE="https://api.deepseek.com"
export MOZHOU_MODEL="deepseek-chat"
```

---

## 🏛️ 项目工程架构

项目采用统一的标准 Pnpm Monorepo 架构，彻底告别历史遗留单体代码：

```text
mozhou/
├── packages/
│   ├── kernel/            # 领域九柱、CausalContract 因果契约、SceneExitState
│   ├── data-plane/        # 本地 SQLite WAL 数据库、Markdown 目录卡、五态对账
│   ├── context-compiler/  # fastembed 向量模型、3通道加权 RRF、Reserved 预算装配
│   ├── quality-engine/    # 11 项机械门禁、4-gram 审查、De-AI 工业级引擎 v2.0
│   ├── pipeline/          # 10 步章节生产会话状态机、回炉降级、版本追踪
│   ├── runtime/           # 多模型运行时底座、能力注册表、Recipe 执行器
│   ├── flywheel/          # 创作者风格画像（StyleProfile vN）、负向学习飞轮
│   └── benchmark/         # L1 确定性连续性断言、Promptfoo 测试编译器
├── apps/
│   └── web/               # 现代化 Web/桌面 UI (Vite + React + TipTap AST + Tailwind)
├── src-tauri/             # Tauri 2.0 原生跨平台桌面外壳 (<15MB 体积，<40MB 内存)
├── scripts/               # 启动自检、多平台发布打包与工程脚本
└── release-artifacts/     # 全平台发布构建产物
```

---

## 🛡️ 质量保证与图谱门禁

- **自动化测试**：发布前要求全仓库 `pnpm test`、Web 专项测试与构建门禁全部通过；README 不固定写死会过时的测试数量，以当前 CI 实际输出为准；
- **GitNexus 代码图谱门禁**：通过 `pnpm graph:check` 进行架构拓扑依赖检查，**保证 0 循环依赖（Zero Circular Dependencies）**；
- **严格类型检查**：全仓库 `tsc --noEmit` **0 错误**。

---

© 2026 墨舟团队 (MoZhou Novel OS) · 保留所有权利
