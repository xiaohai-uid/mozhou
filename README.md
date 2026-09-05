# 🌊 墨舟 (MoZhou / Novel OS)

> **定位**：长篇小说 AI 辅助创作操作系统 —— 工业级状态机 · 11 项机械门禁 · 本地数据自有 · 确定性长程因果契约

---

## 📌 版本声明与当前状态

当前发布版本定位为 **本地写作版 · 技术预览 (Technical Preview / v0.1.1)**：
- **已闭环的核心路径**：本地长期书库建书（`~/MoZhou/Books/`）、正文草稿生成与续写不覆盖（`@mozhou/pipeline`）、手工编辑与哈希防冲突落盘（`@mozhou/data-plane`）、五步向导设定深度注入有界 Prompt（`@mozhou/context-compiler`）、刷新与冷启动完整恢复、全书依序 TXT 纯文本导出与基础机械质量核检（`@mozhou/quality-engine`）；
- **AI 模型通道**：支持 **USER_BYOK（用户自带 Key）** 真实流式调用（OpenAI-compatible / DeepSeek / OpenAI）。未配置 API Key 时系统降级为显式演示模式；
- **明确推迟的能力**：自动多章长篇无人值守生产、云同步与云备份（需云端服务支持）、商业会员支付充值、原生 Tauri 安装包；界面已如实标注为规划中或未接入。

---

## 🚀 快速启动与安装

### 前置要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | **22.23.2** | 依赖 better-sqlite3 本地二进制绑定，推荐使用 nvm 固定 |
| pnpm | **9.15.0** | 核心包管理工具 |
| 环境变量 | `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` | **必须设置**，避免安装过程拉取 250MB 的未编译 GPU 二进制导致失败 |

### 方式一：发布包本地运行

从 `release-artifacts/` 或 GitHub Release 下载对应发行包：
- 📦 **本地独立运行时包**: `mozhou-0.1.1-local-runtime.tar.gz`
  ```bash
  tar -xzf mozhou-0.1.1-local-runtime.tar.gz
  cd mozhou-0.1.1
  export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
  pnpm install --prod --frozen-lockfile
  node scripts/launcher.mjs
  ```
- 🐳 **Docker Compose 部署包**: `mozhou-0.1.1-docker.tar.gz`
  ```bash
  tar -xzf mozhou-0.1.1-docker.tar.gz
  cd docker-bundle
  docker compose up --build -d
  # 数据卷 mozhou_books 自动挂载至 /data/books，容器重建不丢书稿
  ```
- 🌐 **纯静态 Web 包**: `mozhou-0.1.1-web-dist.tar.gz`（用于自定义静态资源托管）

服务就绪后默认自动监听本机回环地址：**`http://127.0.0.1:5173`**。

### 方式二：源码启动（开发者推荐）

```bash
# 1. 导出环境变量并安装依赖
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
pnpm install --frozen-lockfile

# 2. 全量构建
pnpm build
pnpm --filter @mozhou/web build

# 3. 运行全量测试套件（950+ 项全绿）
pnpm test
pnpm --filter @mozhou/web test

# 4. 启动本地完整桌面/Web 创作工作台
pnpm --filter @mozhou/web dev
```

---

## 🔑 配置真实 AI 生成通道（BYOK）

墨舟支持直连 OpenAI 兼容上游服务，遵循以下**严格优先级规则**：

1. **通用自定义覆盖层（最高优先级）**：
   ```bash
   export MOZHOU_API_KEY="sk-your-key"
   export MOZHOU_API_BASE="https://your-api-gateway/v1" # 可选，自定义地址
   export MOZHOU_MODEL="deepseek-chat"                  # 可选，自定义模型
   ```
2. **仅配置 DeepSeek 官方服务**：
   ```bash
   export DEEPSEEK_API_KEY="sk-your-deepseek-key"
   # 默认直连 https://api.deepseek.com，模型 deepseek-chat
   ```
3. **仅配置 OpenAI 官方服务**：
   ```bash
   export OPENAI_API_KEY="sk-your-openai-key"
   # 默认直连 https://api.openai.com/v1，模型 gpt-4o-mini，绝不会错误回落至 DeepSeek
   ```
4. **多 Key 共存时的显式选择**：
   若环境中同时存在 `DEEPSEEK_API_KEY` 与 `OPENAI_API_KEY`，必须显式指定提供方，禁止隐式猜测：
   ```bash
   export MOZHOU_PROVIDER="deepseek" # 或 "openai"
   ```

---

## 📁 数据存储与书库备份

- **默认长期书库位置**：
  - Windows: `%USERPROFILE%\MoZhou\Books\`
  - Linux / macOS: `~/MoZhou/Books/`
- **自定义书库路径**：可通过环境变量 `MOZHOU_LIBRARY_DIR` 显式指定，例如：
  ```bash
  export MOZHOU_LIBRARY_DIR="/my/longterm/storage"
  ```
- **备份与迁移**：
  先停止墨舟进程，完整复制书目录至备份盘即可完成冷备份；复制回任意机器后，在书架或工作台中打开目录即可即时恢复。

---

## 🏛️ 项目工程架构

```text
mozhou/
├── packages/
│   ├── kernel/            # 领域九柱、CausalContract 因果契约、核心实体类型
│   ├── data-plane/        # 本地 SQLite WAL 数据面、Markdown 正典、五态对账、长期书库
│   ├── context-compiler/  # fastembed 内置向量模型、3通道加权 RRF、有界上下文装配
│   ├── quality-engine/    # 11 项机械门禁、4-gram 审查、De-AI 工业级引擎
│   ├── pipeline/          # 章节生产会话状态机、续写防覆盖、互斥锁、版本追踪
│   ├── runtime/           # 多模型运行时底座、能力注册表、Recipe 执行器
│   ├── flywheel/          # 创作者风格画像、负向学习飞轮
│   └── benchmark/         # L1 确定性连续性断言台架
├── apps/
│   └── web/               # 现代化 Web/桌面 UI (Vite + React + NovelEditorCanvas)
└── scripts/               # 启动自检、打包发行与工程维护脚本
```

---

## 🛡️ 质量保证与图谱门禁

- **自动化测试**：全仓库包含 **950+ 项自动化单测、集成测试与 API 契约测试**，持续保持 100% 通过；
- **GitNexus 代码图谱门禁**：通过 `npx gitnexus check --cycles` 进行全仓库架构依赖拓扑检查，**保证 0 循环依赖（Zero Circular Dependencies）**；
- **严格类型检查**：全仓库 TypeScript **0 错误**。

---

© 2026 墨舟团队 (MoZhou Novel OS) · 保留所有权利
