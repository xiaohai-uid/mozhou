# 🌊 墨舟 (MoZhou / Novel OS)

> **定位**：长篇小说 AI 辅助创作操作系统 —— 工业级状态机 · 5 项机械门禁 · 本地数据自有 · 确定性长程因果契约

---

## 📌 版本声明与当前状态

当前发布版本定位为 **技术预览版 (Technical Preview / v0.3.0)**（版本号以 `package.json` 为唯一事实来源）：
- **真实实现的核心**：本地十步生产管道（`@mozhou/pipeline`）、Story Brain 认知穿透（`@mozhou/kernel`）、5 项机械门禁与 4-gram 去复读（`@mozhou/quality-engine`）、确定性三通道加权 RRF 上下文装配（`@mozhou/context-compiler`）、本地 SQLite WAL 数据平面（`@mozhou/data-plane`），以及当前 Web/桌面工作台与导出链路；
- **AI 模型通道**：支持 **USER_BYOK（用户自带 Key）** 的 OpenAI-compatible 真实流式调用；未配置可用 Provider 时相关生成能力会显式显示不可用，只有明确开启 Demo 数据的环境才使用演示数据；
- **商业化状态**：当前为**社区免费技术预览版**。云同步/云备份、付费许可证激活与正式支付通道尚未作为本 Release 的可用能力发布。
- **部署**：只支持单机回环部署，容器与 systemd 部署必须显式设置 `MOZHOU_DATA_ROOT` 与 `MOZHOU_SECRET_KEY`。完整清单与已知限制见 [`docs/deployment.md`](docs/deployment.md)。

### v0.3.0 修复摘要

- **数据安全**：容器与 systemd 部署此前**不持久化数据根**——`MOZHOU_DATA_ROOT` 虽被 `docker-compose.yml` 与 `deploy/README.md` 约定，代码却从未读取，书稿落在镜像层，`docker compose down`、换镜像或重建容器即全部销毁且不报错。现已在 `apps/web/server/dataRoot.ts` 统一解析该变量，容器改为命名卷 `mozhou-data`。
- **凭据安全**：BYOK 加密主密钥此前在 `MOZHOU_SECRET_KEY` 缺失时回退到源码可见常量 + 固定盐，而所有部署模板都没设置该变量——等于凭据可被任何读到文件的人解开。现在 `NODE_ENV=production` 或 `MOZHOU_HOSTED=true` 下缺失即拒绝启动（exit 1），本地单机保留零配置回退。
- **掉电耐久**：章节、canon、基线等写入此前只有 `writeFileSync + rename` 而无 fsync，rename 可能先于数据刷盘，掉电后目标文件变零长度。现统一收敛到 `atomicWriteFileSync`（tmp → fsync → rename）。
- **可运维性**：新增真实 `/api/health`（此前只在路由策略表登记、无处理器，实际返回 404）、单行 JSON 请求日志与 `X-Request-Id`、SIGTERM/SIGINT 优雅停机（排空在途请求，10 秒超时）。
- **文档校正**：`docs/deployment.md` 此前描述的是一套不存在的 Next.js + Postgres + one-api 栈（本仓库无 `app/`、无 `drizzle/`），已重写为当前栈；`docs/production-deployment.md` 标记作废。

### v0.2.1 修复摘要（历史）

- **数据安全**：`manifest.json` 基线改为原子且持久落盘（临时文件 + fsync + rename），并在基线损坏时可由 canon 重建——此前崩溃截断会让整本书经应用永久无法打开；流派资产包改为非破坏注入，目标文件已存在即跳过、不再静默覆盖作者内容。
- **诚实性**：注销账号在云端删除不可用或失败时显式报错，不再回报"已删除"；小说拆解不再把与输入无关的通用模板当作本文本推断结果展示；`/api/draft.question` 补回契约要求的 `hint` 字段。
- **宣称校正**："11 项机械门禁"改为实际的 5 项；官网撤下并不存在的 `Setup.exe` 下载项与针对未开放付费通道的退款承诺。
- **真实生成取证**：新增 `pnpm verify:real-model`，并已用真实上游完成一次端到端取证（生成 → 采纳 → 落盘 → 提交），证据见 `evidence/real-model-journey/`。此前该链路在 CI 中始终是假 provider 或 mock，从未真实验证。

---

## 🚀 快速启动与安装

### 方式一：Release 本地运行时（推荐）

发布产物由 `.github/workflows/release.yml` 按 `package.json` 的版本号命名（当前即 `v0.3.0`），
仓库内 `release-artifacts/` 只保留历史构建，**不保证与当前版本同号**：

- **`mozhou-v<版本>-local-runtime.tar.gz`**：Node.js 22 本地运行时。Windows 解压后运行 **`启动墨舟.bat`**；Linux/macOS 执行 `chmod +x start.sh && ./start.sh`；
- **`mozhou-v<版本>-web-dist.tar.gz`**：已构建的 Web 静态产物；
- **`mozhou-v<版本>-docker.tar.gz`**：本地 Docker 发行包（解压后先设 `MOZHOU_SECRET_KEY` 再 `docker compose up`）；
- Release 同时提供 **SPDX SBOM** 与 **SHA256SUMS.txt** 用于供应链校验。

源码运行时服务默认地址为 **`http://127.0.0.1:5173`**。Tauri 原生安装与代码签名仍是独立发布面；普通 Windows 用户请使用下方的本地安装器。

### 方式二：Windows 本地安装器（普通用户）

当前工作分支已提供无需预装 Node.js、pnpm 或开发工具的 Windows x64 安装器：

- 构建产物：`release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe`；
- 安装范围：当前用户的 `%LOCALAPPDATA%\Programs\MoZhou`，不需要管理员权限；
- 用户数据：`%LOCALAPPDATA%\MoZhou`，卸载时保留；
- 运行方式：开始菜单或桌面快捷方式启动，程序在本机启动服务并打开浏览器工作台；
- 安装器内置 Node.js 运行时和生产依赖，启动不读取用户的 Node/pnpm PATH；
- 本地构建包未做代码签名，Windows SmartScreen 可能显示发布者未知提示；发布前仍需独立签名与下载渠道验收。

详细安装与验收记录见 [`docs/windows-local-install.md`](docs/windows-local-install.md)。

在仓库中重建安装器：

```powershell
pnpm package:windows
```

### 方式三：源码启动（开发者推荐）

```bash
# 1. 安装依赖（纯 CPU，本仓库显式禁止 onnxruntime 下载 CUDA 包）
# PowerShell:
$env:ONNXRUNTIME_NODE_INSTALL_CUDA="skip"; pnpm install
# Linux/macOS:
# ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install

# 2. 全量构建
pnpm build

# 3. 运行全量测试（发布门禁以当前 CI/本地实际输出为准）
#    pnpm test = pnpm run test:packages && pnpm run test:web，两层都跑，任一失败即非零。
#    默认零真实模型调用：真实模型用例在未显式启用时是 skipped，不发任何上游请求。
pnpm test

# 3b. 只跑包层 / 只跑 Web 层（调试分层失败时用）
pnpm run test:packages
pnpm run test:web

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

### 验证真实生成链路（推荐首次使用前执行）

```bash
pnpm verify:real-model
```

用真实上游跑一次完整旅程（建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交），
并把证据写到 `evidence/real-model-journey/<时间戳>/result.json`。

该脚本会校验 `start` 帧自报 `provider: 'real-openai-compatible'` 且正文不是对 prompt 的回吐，
因此**假 provider / mock 流会被直接判失败**，不会被当成真实生成。未配置密钥时如实写
`BLOCKED` 证据并退出 0，不伪造结果。

---

## 🏛️ 项目工程架构

项目采用统一的标准 Pnpm Monorepo 架构，彻底告别历史遗留单体代码：

```text
mozhou/
├── packages/
│   ├── kernel/            # 领域九柱、CausalContract 因果契约、SceneExitState
│   ├── data-plane/        # 本地 SQLite WAL 数据库、Markdown 目录卡、五态对账
│   ├── context-compiler/  # fastembed 向量模型、3通道加权 RRF、Reserved 预算装配
│   ├── quality-engine/    # 5 项机械门禁、4-gram 审查、De-AI 工业级引擎 v2.0
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

- **自动化测试**：发布前要求全仓库 `pnpm test` 全部通过。根 `pnpm test` 是 `pnpm run test:packages && pnpm run test:web` 的串联（包层 vitest + Web 层 vitest），任一层失败即非零；CI 为保留分层诊断，按 `test:packages` 与 `--filter @mozhou/web test` 两步分别执行，避免 Web 层重复运行。README 不固定写死会过时的测试数量，以当前 CI 实际输出为准；
- **真实模型测试是显式入口**：`pnpm test` **默认零真实模型调用**。需要验证真实上游链路时，另跑 `pnpm run test:real-model`，并自行显式提供 `MOZHOU_API_KEY` / `MOZHOU_API_BASE` / `MOZHOU_MODEL`（该入口会设置 `MOZHOU_RUN_REAL_MODEL_TESTS=1`）。三项缺任一项即**非零失败**而非跳过；上游不可达或鉴权失败同样非零。测试不会自动发现本机凭据，也不会自行放开 `MOZHOU_ALLOW_PRIVATE_LLM` 私网端点授权。**该入口会产生真实上游费用。** 端到端取证脚本另见 `pnpm verify:real-model`；
- **GitNexus 代码图谱门禁**：`pnpm graph:check` 经仓库自带的 `.gitnexus/run.cjs` 包装器执行 `check --cycles --json -r .`，**按 cwd 相对定位本仓库**——不再用 `--repo mozhou` 按同名选择：本机索引里存在三个同名 mozhou 仓库，那样无法确定检查的是哪一个。输出为结构化字段 `{"status":"clean","cycleCount":0,"cycles":[]}`；包装器缺失或检查失败即非零退出；
- **严格类型检查**：全仓库 `tsc --noEmit` **0 错误**。

---

© 2026 墨舟团队 (MoZhou Novel OS) · 保留所有权利
