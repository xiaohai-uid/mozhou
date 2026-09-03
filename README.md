# 🌊 墨舟 (MoZhou / Novel OS)

> **定位**：长篇小说 AI 辅助创作操作系统 —— 工业级状态机 · 11 项机械门禁 · 本地数据自有 · 确定性长程因果契约

---

## 📌 版本声明与当前状态

当前发布版本定位为 **技术预览版 (Technical Preview / v0.1.0)**：
- **真实实现的核心**：本地十步生产管道（`@mozhou/pipeline`）、Story Brain 认知穿透（`@mozhou/kernel`）、11 项机械门禁与 4-gram 去复读（`@mozhou/quality-engine`）、确定性三通道加权 RRF 上下文装配（`@mozhou/context-compiler`）、本地 SQLite WAL 数据平面（`@mozhou/data-plane`）；
- **AI 模型通道**：支持 **USER_BYOK（用户自带 Key）** 真实流式调用（OpenAI-compatible / DeepSeek / Claude）。未配置 API Key 时系统降级为显式演示模式；
- **商业化状态**：当前为**社区免费版**，云同步目前为本地快照模式，会员充值与付费通道暂未开放。

---

## 🚀 快速启动与安装

### 方式一：发布包一键启动（免繁琐配置）

获取 `release-artifacts/` 目录下的对应平台安装包：
- 🪟 **Windows**: 解压 `mozhou-v0.1.0-windows-x64.zip`，双击运行 **`启动墨舟.bat`**（或 `start.bat`）；
- 🐧 **Linux**: 解压 `mozhou-v0.1.0-linux-x64.tar.gz`，执行 `chmod +x start.sh && ./start.sh`；
- 🍎 **macOS**: 解压 `mozhou-v0.1.0-darwin-universal.tar.gz`，执行 `./start.sh`；
- 服务就绪后默认自动打开浏览器：**`http://localhost:5173`**。

### 方式二：源码启动（开发者推荐）

```bash
# 1. 安装依赖
pnpm install

# 2. 全量构建
pnpm build

# 3. 运行测试（888 项全绿）
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

- **自动化测试**：全仓库包含 **888+ 项自动化单测与端到端测试**，测试覆盖率高且全数跑通；
- **GitNexus 代码图谱门禁**：通过 `pnpm graph:check` 进行架构拓扑依赖检查，**保证 0 循环依赖（Zero Circular Dependencies）**；
- **严格类型检查**：全仓库 `tsc --noEmit` **0 错误**。

---

© 2026 墨舟团队 (MoZhou Novel OS) · 保留所有权利
