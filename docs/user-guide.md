# 墨舟用户指南

> 面向**作者与评估者**的完整使用说明。术语见 [`GLOSSARY.md`](../GLOSSARY.md)；
> 界面与交互契约见 [`apps/web/DESIGN.md`](../apps/web/DESIGN.md)；
> 给贡献者的开发方式见 [`development.md`](./development.md)。

## 1. 这是什么

墨舟是**本地优先**的长篇小说 AI 辅助创作操作系统：正文与向量计算 100% 发生在本机，
安装与首跑不需要联网下载模型（P0 红线）。

当前发布定位是**技术预览版 v0.3.0**（版本号以 `package.json` 为唯一事实来源）：

| 能力 | 状态 |
|---|---|
| 本地十步生产管道（`@mozhou/pipeline`） | 真实实现 |
| Story Brain 认知穿透（`@mozhou/kernel`） | 真实实现 |
| 机械门与 4-gram 去复读（`@mozhou/quality-engine`） | 真实实现 |
| 确定性三通道加权 RRF 上下文装配（`@mozhou/context-compiler`） | 真实实现 |
| 本地 SQLite WAL 数据面（`@mozhou/data-plane`） | 真实实现 |
| AI 模型通道 | **BYOK**（你自带 Key）的 OpenAI-compatible 真实流式调用 |
| 云同步 / 云备份、付费许可证激活、正式支付通道 | **本版不可用** |

未配置可用 Provider 时，相关生成能力会**显式显示不可用**，不会静默降级成假数据；
只有明确开启 Demo 数据的环境才使用演示数据。

## 2. 安装

### 2.1 Windows 普通用户（推荐，无需开发环境）

运行 `release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe`：

- 默认安装目录：`%LOCALAPPDATA%\Programs\MoZhou`
- 默认书稿与运行数据目录：`%LOCALAPPDATA%\MoZhou`
- **卸载不会删除书稿数据**

安装后从开始菜单或桌面快捷方式启动「墨舟」。启动器只监听本机回环地址，
启动自己的服务并打开浏览器；**不依赖你的 Node.js 或 pnpm**。每个数据目录使用稳定的
本地端口，浏览器工作区的最近作品状态可跨重启恢复。

> 安装器目前**未签名**。对外发布前仍需代码签名、下载渠道、升级路径和独立 Windows
> 机器复验（见 [`docs/windows-local-install.md`](./windows-local-install.md)）。

### 2.2 从源码运行（贡献者）

前置版本是硬约束，不是建议：

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | **22.23.2** | 仓库 `.nvmrc` 钉版；better-sqlite3 的 ABI 绑定该版本，其他版本测试会挂 |
| pnpm | 9.15.0 | 见根 `package.json` 的 `packageManager` 字段 |
| CUDA 跳过变量 | `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` | **必须**，见下 |

```bash
nvm install                              # 按 .nvmrc 装 Node 22.23.2
corepack enable pnpm
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip   # Windows PowerShell 用 $env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
pnpm install
```

**为什么 CUDA 变量是必须的**：传递依赖 `onnxruntime-node` 的 postinstall 默认强拉 GPU 版
二进制（约 250MB）。无 CUDA 工具链的机器上该下载解压必然失败，并把整个安装回滚。
墨舟是纯本地 CPU 推理，永远用不到 CUDA 二进制。仓库根 `preinstall` 挂了守卫脚本
（`scripts/check-install-env.mjs`）：未设置该变量时安装会**立即失败并给出修复指令**，
而不是在依赖安装深处报晦涩的 nvcc 错误。

### 2.3 embedding 模型资产（随仓内置，零首跑联网）

- 位置：`packages/context-compiler/assets/models/bge-small-zh-v1.5/`
- 内容：BAAI/bge-small-zh-v1.5 的 int8 ONNX（`model_quantized.onnx`，约 24MB）+ tokenizer 四件套
- 完整性：同目录 `manifest.json` 登记每个文件的 SHA-256 与字节数；**装载前逐文件复核，不符即拒绝装载**
- 加载方式：fastembed CUSTOM 本地路径装载；全程无 fetch 路径，断网冷启动有测试硬断言

## 3. 首次使用

首次启动会走建书向导。向导完成后，书稿目录、SQLite WAL、安装密钥和运行日志
写入数据目录。此后每次启动不再重复弹向导，浏览器工作区会恢复最近作品。

界面布局与交互契约（视觉基线、密度规则、失败态、作者主权）不在本文重复，
见 [`apps/web/DESIGN.md`](../apps/web/DESIGN.md)。

## 4. 数据在哪里

| 内容 | 位置 |
|---|---|
| 书稿与运行数据（Windows 安装版） | `%LOCALAPPDATA%\MoZhou` |
| 书稿与运行数据（源码运行） | 由 `MOZHOU_DATA_ROOT` 决定，默认仓库内 |
| 容器部署 | 命名卷 `mozhou-data`（**不要**只靠镜像层） |

> 容器与 systemd 部署必须显式设置 `MOZHOU_DATA_ROOT` 与 `MOZHOU_SECRET_KEY`。
> `MOZHOU_SECRET_KEY` 缺失时，`NODE_ENV=production` 或 `MOZHOU_HOSTED=true` 下
> **拒绝启动**（exit 1）；本地单机保留零配置回退。完整部署清单见
> [`deployment.md`](./deployment.md)。

## 5. 故障排查

| 现象 | 原因与处理 |
|---|---|
| 安装立刻失败并提示缺 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` | 按提示设置环境变量后重试 |
| 测试报 better-sqlite3 `NODE_MODULE_VERSION` 不符 / Module did not self-register | Node 不是 22.23.2，回 2.2 重装 |
| 报模型资产 hash 不符或缺失 | 资产文件被改动或未随仓检出，以 `manifest.json` 为准恢复该目录 |
| 生成能力显示不可用 | 未配置 Provider。在「模型设置」页填 Key，或设 `MOZHOU_API_KEY` / `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` |

## 6. 已知边界

- 商业化状态：社区免费技术预览版，**付费通道不可用**。
  `apps/web/server/billing/store.ts:180` 的结账 URL 是 mock 地址，点击不会完成支付。
- 真实模型能力需要你自己的 Key；未配置时相关生成能力显式不可用。
- 主线界面是**桌面优先、仅深色**。移动端与部分通道/Inspector 标签页是显式占位，
  不得因为文档写了就以为已发布。

## 相关文档

- 术语：`GLOSSARY.md` ｜ 决策：`docs/adr/INDEX.md`
- 界面契约：`apps/web/DESIGN.md` ｜ 架构：`docs/architecture.md`
- 开发与门：`development.md` ｜ 门清单：`gates.md` ｜ 部署：`deployment.md`