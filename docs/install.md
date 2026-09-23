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
