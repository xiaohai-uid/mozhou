# CHG-20261008-21 产物戳诚实化与推送前依赖环门禁

> 触发：`/retro` 会话（用户授权「按你推荐的来吧」，执行顺序 3 → 1 → 4 → 2）。基线 HEAD `e321323`。证据分两层：**实跑**与**读代码判定**，逐条标注。

## 1. 需求来源

retro 候选（按严重度）中的第 3、1、4、2 项：

1. 安装器在脏工作区仍盖 HEAD 戳 —— 发布审计两次栽在这；
2. 依赖环门禁不在任何 CI 里 —— 2026-10-07 审计的 1 个循环活到了 HEAD；
3. Mimosa 提交门禁恒 INCONCLUSIVE；
4. 审查挂账项只以散文存在变更文档，未进 GitHub Issues。

## 2. 观察基线（改前，实跑取证）

| 事实 | 命令/出处 | 结果 |
|---|---|---|
| 产物戳无条件取 HEAD | `scripts/release/windows/build.mjs:94`（改前） | `sourceCommit: execFileSync('git',['rev-parse','HEAD'])`，不看工作区状态 |
| 同类缺陷早已登记为散文 | `audit-2026-10-03/01-baseline-and-graph-gate.md:350` | 「已发布的 v0.3.0 安装包是 HEAD 与工作区的混合物，其『sourceCommit = 90b45a1』不成立」——4 天前就写过，未机械化，2026-10-07 再犯 |
| CI 无图谱步骤 | `grep -rn "graph:check\|gitnexus" .github/workflows/` | 零命中（ci.yml、release.yml 均无） |
| 索引不入库 | `git ls-files .gitnexus \| wc -l` | 0 |
| 追踪器为空 | `gh issue list --state open --json number`（绕过失效代理直连） | `[]`；已关闭 89 条。仓库 `xiaohai-uid/mozhou` 为 **PUBLIC** |
| 提交钩子扫描恒不完整 | 本次会话两次提交钩子 | `scanner_enobufs`：未取得完整扫描结论 |
| 但 MCP 扫描可完整 | `~/.mimosa/security-scans/project-4d5b…/scan-2026-10-06…/coverage.json` | `completeness: "complete"`，919/919 文件解析、无截断 |

## 3. 实际变更

### 3.1 产物戳诚实化（第 3 项，已修）

- 新增 `scripts/release/lib/source-stamp.mjs`：`computeSourceStamp(headSha, porcelainOutput)` 纯函数 + `readSourceStamp(root)`。规则：工作区有未提交改动时戳为 `<sha>-dirty`，并给出 `sourceCommitSha`（原始 40 位 SHA）、`dirty`、`dirtyFiles`。
- `scripts/release/windows/build.mjs`：改用该模块；新增 `--print-stamp`（只打印戳、不构建，秒级核验）；脏工作区时 `console.warn`；`windows-build-result.json` 改为展开 `...stamp`。
- 取舍：`sourceCommit` 在脏工作区**不再是 40 位 SHA**。这是有意的——只读 `sourceCommit` 的消费者会看到 `-dirty`，无法把它当成干净提交的证明（这正是缺陷本身）。需要原始 SHA 的消费者读 `sourceCommitSha`。仓库内 grep 未发现 `windows-build-result.json` 的任何代码消费者。

### 3.2 推送前依赖环门禁登记（第 1 项，已登记）

- `AGENTS.md` §8 增一行项目级门禁：推送前必须跑 `node scripts/ci-gate.mjs graph-check`，期望 `clean` / `cycleCount: 0`。`scripts/ci-gate.mjs` 的 `graph-check` 任务**已存在**，故未改该文件（它当前被并行会话占用）。
- 选择「本地门禁」而非 CI 步骤：`.gitnexus/` 索引不入库，CI 需先 `analyze`（数分钟 + 需 CLI），代价高；本地登记是权宜，CI 化仍作为待提议题（见 §6）。

### 3.3 Mimosa 处置决策（第 4 项，决策记录）

- 事实：提交/推送钩子路径的扫描恒 INCONCLUSIVE（`scanner_enobufs`）；MCP 扫描路径可 complete。插件失败模式旋钮（`payload/README.md:79-80`）：`MIMOSA_HOOK_FAILURE_MODE=open|strict`、`MIMOSA_GIT_GATE_FAILURE_MODE=open|strict`、`MIMOSA_HOOK_STRICT=1`；`strict` 会在「候选缺失、扫描失败、坏输出或 partial coverage」时于写入前直接 deny。
- **决策（本轮）：保持 `open`（advisory）。** 理由：缓冲问题未解决时切 `strict` 会立刻阻断全部提交，属安全姿态变更，需用户单独决定。
- 后果如实记录：**本轮未取得完整安全扫描结论，不得宣称项目安全**；该结论长期挂账。
- 后续选项：①上游修缓冲/范围后切 `strict`；②显式长期接受 advisory 并写进项目文档。

### 3.4 挂账项待进追踪器（第 2 项，待用户点头）

见 §6。仓库为 PUBLIC，创建议题是对外可见动作，本轮只产出可直接执行的清单，未提交。

## 4. 验证（实跑层）

| 检查 | 命令 | 结果 |
|---|---|---|
| 戳函数干净分支 | `node -e "import('./scripts/release/lib/source-stamp.mjs').then(...computeSourceStamp('abc1234',''))"` | `{"sourceCommit":"abc1234","dirty":false,"dirtyFiles":0}` |
| 戳函数脏分支 | 同上，传入两行 porcelain | `{"sourceCommit":"abc1234-dirty","dirty":true,"dirtyFiles":2}` |
| 真实仓库戳 | `node scripts/release/windows/build.mjs --print-stamp` | `e3213238…-dirty`，`dirtyFiles: 125` |
| 登记的图谱门禁命令 | `node scripts/ci-gate.mjs graph-check` | `{"status":"clean","cycleCount":0}`，exit 0 |
| 图谱门禁（MCP） | `gitnexus check`（repo=mozhou） | clean / 0 cycles |

## 5. 未做与未验证（如实）

- **未重跑完整安装器构建**：当前工作区有 125 项并行会话在制改动，重跑会把已登记的干净产物（`9aa2c286…`，戳 `8cf72b0` 干净）覆盖成 `-dirty` 产物，反而制造「产物↔记录」漂移。戳对象已由 `--print-stamp` 实跑核验；写入行是同一对象的展开（**读代码判定，未实跑**）。
- **影响分析用了人工 grep**：GitNexus 索引不覆盖 `scripts/`（`impact` 返回 `Target 'scripts/release/windows/build.mjs' not found`），故以「消费方 grep」替代：`windows-build-result.json` 无代码消费者 → 代码爆炸半径为零。属**能力缺口已披露**，不构成图谱门禁通过。
- `scripts/release/release-verify.mjs` 是 9 月恢复期陈旧脚本（检查 2 要求分支 `codex/mozhou-full-release-20260915`；检查 3-5 指向 `C:/codex/handoffs/mozhou-recovery-20260917/`），且当前被并行会话占用 → **未删未改**，仅登记（见 §6）。
- 低优先未开工（retro 第 8、9 项）：`.cmd` 垫片知识已在 `scripts/ci-gate.mjs:1-6` 注释里，AGENTS.md 未加该指针；大产物目录（`release-artifacts/`）不进递归检索的约定未写入标准。

## 6. 待提议题清单（第 2 项产出；因仓库 PUBLIC，待用户点头后提交）

| 标题 | 标签 | 正文要点 |
|---|---|---|
| 依赖环检查纳入 CI（不止本地门禁） | `ready-for-agent` | ci.yml 加 `analyze` + `check --cycles`；接受数分钟代价 |
| 真实模型路径纳入发布前作业 | `ready-for-agent` | `verify:real-model` 脚本齐备但无作业跑；需凭据，缺失时 BLOCKED 不静默跳过 |
| Mimosa 提交门禁恒 INCONCLUSIVE 的处置 | `needs-triage` | 修缓冲/范围后切 `MIMOSA_GIT_GATE_FAILURE_MODE=strict`，或显式长期 advisory |
| 建立 CODING_STANDARDS.md | `ready-for-agent` | 判断类条款（作者决定正文写入／旧任务不污染新现场／恢复必须验证）从 AGENTS.md §7 迁出，交评审代理读 |
| AGENTS.md 沉积清理 | `needs-triage` | §0 裁决叙事压成指针；CLAUDE.md 44 行全为 gitnexus 自动块（与 AGENTS.md 重复） |
| 保存路径 journal 崩溃注入恢复用例 | `ready-for-agent` | 2026-10-05 挂账；`saveProseDraft` 无故障注入钩子 |
| naming 502 路径真实模型未实测 | `ready-for-agent` | `NAMING_UPSTREAM_FAILED`／`NAMING_PARSE_FAILED` |
| 写锁跨 Windows 登录会话互斥未实测 | `needs-triage` | LOCK-01 仅按「两个独立 node 进程」实测 |
| 清理 9 月陈旧 release-verify.mjs | `ready-for-agent` | 分支／路径断言指向已结束的恢复期 |
| 基线既有 TS2352 | `ready-for-agent` | `apps/web/server/routes/taskStream.routes.test.ts:170`（`c2f7373` 引入） |

## 7. 回滚

`git revert <本提交>`；`scripts/release/lib/source-stamp.mjs` 与 `--print-stamp` 删除即可，无数据影响（产物 JSON 字段只增不减地保留了 `sourceCommitSha`）。

## 8. 并发说明

工作区另有并行会话的术语统一／歧义裁决改动（125 项，含 `PROJECT-MAP.md`、`scripts/ci-gate.mjs`、`.github/workflows/ci.yml` 等）在制。本变更用**精确暂存**只提交自己的文件，他人改动一字未动、未暂存。
