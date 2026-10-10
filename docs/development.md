# 墨舟开发指南

> 给贡献者与 AI 代理。流程与范围纪律的权威是 [`AGENTS.md`](../AGENTS.md)（UVSD Protocol
> v2.2.1 §1–§8）；本文只提供**可执行的命令与回滚清单**，不重复规则、不新增授权。
> 面向作者的使用说明见 [`user-guide.md`](./user-guide.md)。

## 1. 环境

| 依赖 | 版本 | 权威来源 |
|---|---|---|
| Node.js | 22.23.2（`.nvmrc` 钉版）/ 24.18.0（2026-10-10 实测通过） | `.nvmrc` |
| pnpm | 9.15.0 | 根 `package.json` 的 `packageManager` |
| CUDA | **必须跳过** | `preinstall` 守卫 `scripts/check-install-env.mjs` |

```bash
nvm install
corepack enable pnpm
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip   # PowerShell: $env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
pnpm install
```

> **关于 Node 版本**：`docs/install.md` 曾写「非 22.23.2 测试会挂」。2026-10-10 实测
> Node 24.18.0 下 `better-sqlite3@12.11.1` 正常加载（`:memory:` 建表成功），
> `pnpm build` / `pnpm test` 全绿。两个版本都可用；改动 Node 版本时须重新验证
> better-sqlite3 的 native 绑定，不要只信文档。

## 2. 常用命令

### 开发

```bash
pnpm start            # 启动应用（scripts/launcher.mjs，本地回环）—— 根目录无 dev 脚本
pnpm --filter @mozhou/web dev    # 仅前端 Vite dev server
pnpm build            # tsc -b（工作区全量类型构建）
pnpm lint             # eslint .
pnpm test             # test:packages（vitest）+ test:web
pnpm desktop:dev      # Tauri 桌面壳开发模式（需 Rust 工具链）
```

### 提交前的自动化门（本地必须跑）

```bash
# 一次性：激活仓库内钩子
node scripts/install-hooks.mjs

# 每次提交前：AGENTS.md §8 要求本项目额外跑这四项（CI 里有、本地推送路径原本没有）
node scripts/ci-gate.mjs graph-check     # 依赖环，期望 clean / cycleCount: 0
node scripts/ci-gate.mjs doc-gates       # 术语 / 门清单 / README / 生成物新鲜度
node scripts/ci-gate.mjs import-cycles   # 静态导入环
node scripts/ci-gate.mjs duplication     # 克隆检测
```

> 钩子本体在 `.githooks/pre-commit`，**不是** `.git/hooks/`——本机全局 gitconfig 设了
> `core.hooksPath`，`.git/hooks/` 会被 Git 完全忽略（2026-10-10 实测：装在那里根本不执行）。
> 钩子跑 4 项秒级检查 + 生成物新鲜度（阻断）+ 文档裸数字（只告警）。

### 文档与生成物

```bash
node scripts/verify-glossary.mjs       # 术语门（活跃层禁用词）
node scripts/verify-gates-contract.mjs # 门清单防腐化门
node scripts/gen-architecture.mjs      # 重新生成 docs/architecture.md（勿手改）
node scripts/gen-term-map.mjs          # 重新生成 docs/term-map.md
node scripts/check-generated-freshness.mjs   # 生成物是否与索引一致
```

> **Windows 注意**：`check-generated-freshness.mjs` 内部用 `sh` 执行命令。裸 PowerShell
> 里 `sh` 不在 PATH，脚本会以 **exit 2** 报「无法执行」。这不是脚本缺陷，是环境依赖：
> 把 `C:\Program Files\Git\bin` 加进 PATH 后同一命令 exit 0。钩子是 `sh` 脚本，
> 所以钩子路径不受影响。

### 代码图谱

```bash
node .gitnexus/run.cjs analyze    # 重建索引（约 40 秒）
pnpm graph:check                  # 环依赖检查
pnpm graph:snapshot               # 导出给 apps/web 的只读快照
```

> 改动文件后需重跑 `analyze`，否则 `check-generated-freshness` 会判定陈旧。
> 本机有 29 个已索引仓库，`run.cjs query` 需显式 `--repo`。

### 打包

```bash
node scripts/build-release.mjs    # 3 个 tar 归档 + BUILD-STAMP.json 来源戳
pnpm package:windows              # 桌面安装器（需 Inno Setup 6 + Node 24.18.0 构建机）
```

## 3. 改动纪律

| 场景 | 做法 |
|---|---|
| 改 `docs/architecture.md` / `docs/term-map.md` | **不要手改**，跑对应 `gen-*` 重新生成 |
| 改 UI | 先读 `apps/web/DESIGN.md`；视觉 token 真值在 `apps/web/src/styles/globals.css` |
| 改术语 | `GLOSSARY.md` 是唯一权威；`docs/term-map.md` 是生成物 |
| 改门 | 先更新 `docs/gates.md` 表格，再改脚本；两者由 `verify-gates-contract.mjs` 对账 |
| 跨模块重构 | **停下报告依赖**，不自行扩大范围（UVSD §2 第 7–8 条） |

## 4. 回滚清单

| 想回滚 | 怎么做 |
|---|---|
| 单个提交 | `git revert <hash>` |
| 本地未提交改动 | `git restore <path>` / `git stash`（**禁止** `git reset --hard` 丢弃他人工作） |
| 某份文档被改坏 | 从 `git show <hash>:<path>` 取回原内容 |
| 删除历史分支前 | 先打 `archive/branch/<name>` tag（AGENTS.md §8） |
| 生成物陈旧 | 跑 `gen-*` 重新生成，不要手改 |

## 5. 分支模型

六分支（AGENTS.md §8）：`main`（生产，只由 release/hotfix 合入）← `release`（UAT）←
`test`（FAT）← `develop`（联调）← `feature/*`。**功能只进 `develop`，不直接进 `main`。**
提交 ≠ 推送，合入 ≠ 部署——本地 commit 不含 merge/push 授权。

## 6. 平台注意（Windows）

- 用 PowerShell 7（`pwsh`），**不要**调用 `powershell.exe`（Windows PowerShell 5.1）。
- 优先 Git Bash。
- 缺少必需工具时**显式失败**，不静默降级。

## 相关文档

- 流程与范围：`AGENTS.md` ｜ 术语：`GLOSSARY.md` ｜ 变更溯源：`PROJECT-MAP.md`
- 门清单：`gates.md` ｜ 架构：`architecture.md` ｜ 决策：`docs/adr/INDEX.md`
- 使用说明：`user-guide.md` ｜ 部署：`deployment.md`