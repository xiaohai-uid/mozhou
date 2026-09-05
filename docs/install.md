# 安装指南（本地开发 / 打包基线）

墨舟是**本地优先**的创作 OS：正文与向量计算 100% 发生在本机（P0 红线），任何安装与首跑步骤都不允许联网下载模型。

## 前置

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | **22.23.2** | 仓库 `.nvmrc` 钉版；better-sqlite3 的 ABI 绑定该版本，其他版本测试会挂 |
| pnpm | 9.15.0 | 见根 `package.json` 的 `packageManager` 字段 |

```bash
nvm install   # 按 .nvmrc 装 Node 22.23.2
corepack enable pnpm
```

## 安装：必须先导出 CUDA 跳过变量

```bash
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
pnpm install
```

**为什么必须**：传递依赖 `onnxruntime-node` 的 postinstall 默认强拉 GPU 版二进制（约 250MB）。无 CUDA 工具链的机器上该下载解压必然失败，并把整个安装回滚（T9 调研风险 R1，本机两次复现）。墨舟是纯本地 CPU 推理，永远用不到 CUDA 二进制。

仓库根 `preinstall` 挂了守卫脚本（`scripts/check-install-env.mjs`）：未设置该变量时安装会立即失败并给出上面这条修复指令，而不是在依赖安装深处报晦涩的 nvcc 错误。

## embedding 模型资产（随仓内置，零首跑联网）

- 位置：`packages/context-compiler/assets/models/bge-small-zh-v1.5/`
- 内容：BAAI/bge-small-zh-v1.5 的 int8 ONNX（`model_quantized.onnx`，约 24MB）+ tokenizer 四件套
- 完整性：同目录 `manifest.json` 登记每个文件的 SHA-256 与字节数；装载前逐文件复核，不符即拒绝装载
- 加载方式：fastembed CUSTOM 本地路径装载（`@mozhou/context-compiler` 的 `createLocalEmbeddingProvider()`）；全程无 fetch 路径，断网冷启动有测试硬断言

## 验证安装

```bash
pnpm build && pnpm lint && pnpm test   # 三绿 = 就绪
```

## 故障排查

- **安装立刻失败并提示缺 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`** → 按提示 export 后重试。
- **测试报 better-sqlite3 `NODE_MODULE_VERSION` 不符 / Module did not self-register** → Node 版本不是 22.23.2，回前置步骤重装。
- **报模型资产 hash 不符或缺失** → 资产文件被改动或未随仓检出；恢复该目录后重试（以 `manifest.json` 为准）。

## 书库长期存储与数据备份

墨舟采用本地优先文件系统存储，作品与章节草稿保存在独立的书库目录中：

- **默认书库目录**：`~/MoZhou/Books/`（Windows 下位于 `%USERPROFILE%\MoZhou\Books\`，Linux/macOS 下位于 `$HOME/MoZhou/Books/`）。
- **自定义书库环境变量**：可通过环境变量 `MOZHOU_LIBRARY_DIR` 显式指定长期保存根目录，例如 `export MOZHOU_LIBRARY_DIR=/my/safe/novels`。
- **Docker 容器环境**：默认挂载命名数据卷 `mozhou_books:/data/books`，容器内固定为 `MOZHOU_LIBRARY_DIR=/data/books`，容器销毁或重建不会丢失书稿。

### 书库数据备份与迁移操作

1. **先停止墨舟服务**：确保无并发写入或未完成的流式任务。
2. **完整复制书目录**：将原书目录（例如 `~/MoZhou/Books/<bookId>/`）整包复制到目标备份或新书库位置。
3. **校验完整性**：确认目标目录下包含 `book.json` 及 `正文/` 目录结构。
4. **重新启动服务**：在墨舟界面点击“书架”或调用“打开作品”，选择新路径即可立即恢复写作与目录索引。

## BYOK 模型服务配置规则（大模型密钥）

墨舟支持通过环境变量接入兼容 OpenAI 协议的模型提供商，遵循以下严格的优先级规则：

1. **通用自定义网关（最高优先级）**：
   - 设置 `MOZHOU_API_KEY`、可选 `MOZHOU_API_BASE`（如自建 OneAPI/NewAPI/云网关）与可选 `MOZHOU_MODEL`（默认为 `deepseek-chat`）。
2. **DeepSeek 官方服务**：
   - 仅配置 `DEEPSEEK_API_KEY` 时，默认指向官方端点 `https://api.deepseek.com` 并使用 `deepseek-chat`。
3. **OpenAI 官方服务**：
   - 仅配置 `OPENAI_API_KEY` 时，默认指向官方端点 `https://api.openai.com/v1` 并使用 `gpt-4o-mini`，绝不会错误回落到 DeepSeek。
4. **多 Key 共存**：
   - 若同时配置了 `DEEPSEEK_API_KEY` 与 `OPENAI_API_KEY`，必须显式声明 `MOZHOU_PROVIDER=deepseek` 或 `MOZHOU_PROVIDER=openai`，系统不进行不可控的隐式猜测。
