# 01 · 基线与图谱门禁记录（MoZhou 模块架构审计 · 2026-10-03）

> 口径见 `00-audit-charter.md`。本文件是**基线事实的唯一来源**。
> 每条事实都可由本文件给出的命令或 `logs/` 编号复现。
> 原始输出目录：`audit-2026-10-03/logs/`。

---

## 1. 仓库与时间基线

| 项 | 值 | 取证 |
|---|---|---|
| 实际仓库根 | `C:\zcode\novel-ai` | `git rev-parse --show-toplevel` → `C:/zcode/novel-ai` |
| 分支 | `feature/windows-local-release` | `git rev-parse --abbrev-ref HEAD` |
| 与远端关系 | `ahead 7`（`origin/feature/windows-local-release`） | `git status -sb` |
| 完整 HEAD | `90b45a1a1bf15a97b1cc690ad0b9872018aeebcb` | `git rev-parse HEAD` |
| 短 HEAD | `90b45a1` | `git rev-parse --short HEAD` |
| HEAD 提交信息 | `fix(terms): 修正术语映射的证据语义，58 条「已验证」降为 27 条声明` | `git log -1` |
| HEAD 作者/时间 | 王大易 `\<169173651@qq.com\>`，`Fri Oct 2 01:02:25 2026 +0800` | `git log -1` |
| **审计开始时间** | **2026-10-03T00:48:18+08:00** | `(Get-Date)`，时区 `China Standard Time` / `Asia/Shanghai` |
| 当前工作目录 | `C:\zcode\novel-ai` | `Get-Location` |

**领先远端的 7 个提交**（`git log origin/feature/windows-local-release..HEAD`）：

```
90b45a1 fix(terms): 修正术语映射的证据语义，58 条「已验证」降为 27 条声明
0d87ece feat(packages): 9 个包 README 契约 + 覆盖率/克隆检测配置，附两处未跑通的事实
ce9bb7b feat(terms): 中英标识符映射表（生成 + 门禁），并记录一处已确认的命名漂移
e745b8d chore(gates): 建立门禁退出码契约，并给真实模型验收加 --strict
6528fd3 docs(audit): 代码层重复裁决清单，并更正上一轮四处不成立的判断
7043636 chore(docs): 接入术语与架构双门禁，并纠正一处未核实的事实
4bf596a docs(terminology): 统一术语与流程权威，收敛六条工作流线
```

---

## 2. 环境基线

| 项 | 值 |
|---|---|
| 操作系统 | Microsoft Windows 11 专业工作站版，10.0.26200，64 位 |
| 内存 | 33693593600 B（≈31.4 GiB） |
| Node.js | `v24.18.0`（`C:\Program Files\nodejs\node.exe`） |
| npm | `11.16.0` |
| pnpm | `9.15.0`（`C:\Users\a1691\AppData\Roaming\npm\pnpm.ps1`） |
| Git | `2.55.0.windows.3` |
| PowerShell | 7.6.4（`pwsh`） |
| GitNexus CLI | `1.6.10-rc.123`（`C:\Users\a1691\AppData\Roaming\npm\gitnexus.ps1`） |
| LadybugDB | 0.18.3（native `lbugjs.node` 已加载） |
| ONNX | 1.27.0 |

> ⚠️ 工具链**版本分叉**：根 `package.json` 为 `0.3.0`，而 `src-tauri/tauri.conf.json` 与 `src-tauri/Cargo.toml` 均为 `0.2.0`。桌面宿主版本号与产品版本号不一致，已列入 `inventory.json`。

---

## 3. 工作区未提交清单（关键：先查这张表再决定标签）

### 3.1 计数（含一个必须知道的坑）

**审计开始前的既有未提交项 = `git status --porcelain` 42 项；`-uall` 展开后 = 50 个文件。** 与任务简报所述「共 42 项」**一致**。

> ⚠️ **计数坑（已实测，务必知道）**：本审计的产物目录 `audit-2026-10-03/` 一旦写入文件，就会让 `--porcelain` 从 42 变成 **43**。
> 原因是 **git 不报告空的未跟踪目录**——已在系统临时目录用独立 git 仓实测确认：空目录时 `porcelain` count=0，目录下加入一个文件后 count=1（出现 `?? emptydir/`）。
> 因此审计开始时该目录尚为空、不计入 42；`logs/010` 是在写入 `010-*.txt` 之后才采集的，所以 **`010` 自身含 43 行（1 行是本审计目录）**。
> **他人复核计数时必须先扣除 `?? audit-2026-10-03/`，再与 42 / 50 对齐。**

证据：`logs/010-git-status-porcelain-default.txt`（43 行，其中 1 行为本审计目录）、`logs/011-git-status-porcelain-uall.txt`（51 行，其中 1 行为本审计日志文件）

### 3.2 已暂存（index 中，3 个文件）

| # | 路径 | 一句话影响面 | 落在被审计路径上 |
|---|---|---|---|
| S1 | `apps/web/server/routes/pipelineRoutes.advanceGuard.test.ts`（新增，155 行） | 新增推进守卫测试 | **是**（BFF 路由） |
| S2 | `apps/web/server/routes/pipelineRoutes.ts`（+22） | 推进守卫实现变更 | **是**（BFF 路由） |
| S3 | `apps/web/server/routes/proseRoutes.sessionComplete.test.ts`（±14） | 会话完成测试变更 | **是**（BFF 路由） |

证据：`logs/013-git-diff-stat-staged.txt`

### 3.3 未暂存修改（工作区，23 个文件）

| # | 路径 | 一句话影响面 | 落在被审计路径上 |
|---|---|---|---|
| M1 | `AGENTS.md` | 改流程闸门 + 改 gitnexus 技能路径（见 §4） | 否（治理文件，但**改它会污染图谱注入**） |
| M2 | `CLAUDE.md` | 改 gitnexus 符号计数 + 技能路径 | 否（同上） |
| M3 | `apps/web/server/routes/productionRoutes.test.ts` | 生产路由测试变更 | 是 |
| M4 | `apps/web/server/test-support/realModelGate.test.ts` | 真实模型闸门测试变更 | 是 |
| M5 | `apps/web/src/App.test.tsx` | 应用壳测试变更 | 是 |
| M6 | `apps/web/src/App.tsx`（±329） | 应用壳路由/视图变更 | 是 |
| M7 | `apps/web/src/code-graph/CodeGraphView.test.tsx` | 代码图谱视图测试变更 | 是 |
| M8 | `apps/web/src/code-graph/codeGraphData.json` | 图谱数据变更 | 是 |
| M9 | `apps/web/src/code-graph/codeGraphSnapshot.ts`（**4345 行大改**） | 图谱快照重排 | 是 |
| M10 | `apps/web/src/context-receipt/ReceiptPanel.test.tsx` | 上下文回执面板测试 | 是 |
| M11 | `apps/web/src/context-receipt/ReceiptPanel.tsx`（+59） | 上下文回执面板变更 | 是 |
| M12 | `apps/web/src/workbench/WorkbenchView.tsx` | 工作台视图变更 | 是 |
| M13 | `apps/web/src/workbench/editor/ProseEditorPanel.isolation.test.tsx` | 编辑器隔离测试 | 是 |
| M14 | `apps/web/src/workbench/editor/ProseEditorPanel.tsx` | 正文编辑器变更 | 是 |
| M15 | `eslint.config.js` | **放宽 lint 门禁阈值 80 → 120**（见 §4.3） | 是（构建门禁） |
| M16 | `evidence/usability-fixes-20260921/result.json` | 可用性证据结果变更 | 否（证据产物） |
| M17 | `package.json` | 新增脚本 `verify:journey` | 是（入口清单） |
| M18 | `packages/context-compiler/src/assemble.test.ts`（+84） | 上下文装配测试 | 是 |
| M19 | `packages/context-compiler/src/assemble.ts`（+58） | 上下文装配实现，新增通道贡献汇总 | 是 |
| M20 | `packages/context-compiler/src/receipt-file.test.ts` | 回执落盘测试 | 是 |
| M21 | `packages/kernel/src/kernel-schema.ts`（+27） | 内核 schema 新增 `ChannelContribution` | 是 |
| M22 | `scripts/gen-adr-refs.mjs`（-1） | ADR 引用生成脚本 | 否（开发工具） |
| M23 | `windows-install-check-report.json` | 安装检查报告变更 | 否（产物） |

证据：`logs/012-git-diff-stat-unstaged.txt`（合计 23 files, +2870 / -2324）

### 3.4 未跟踪新增（默认视图 16 条 / `-uall` 展开 24 个文件）

条数对账：`--porcelain` 42 = 26（3 已暂存 + 23 未暂存）+ 16（未跟踪）；`-uall` 50 = 26 + 24 个未跟踪文件。两个未跟踪目录 `scripts/corpus/`（2 文件）与 `.agent-teams/`（8 文件）在默认视图中各折叠为 1 条。

| # | 路径 | 一句话影响面 | 落在被审计路径上 |
|---|---|---|---|
| U1 | `MOZHOU_MODULE_ARCHITECTURE_AUDIT.md` | **上一份报告**（未提交，不得覆盖） | 否（被复核对象） |
| U2 | `apps/web/server/routes/exportRoutes.test.ts` | 导出路由测试 | 是 |
| U3 | `apps/web/src/context-receipt/WhyThisWritingButton.tsx` | 新组件「为什么这样写」 | 是 |
| U4 | `apps/web/src/context-receipt/WhyThisWritingButton.test.tsx` | 上者测试 | 是 |
| U5 | `docs/audit/gitnexus-impact-analysis-phase1-2026-10-02.md` | 上一轮图谱影响面报告 | 否 |
| U6 | `docs/audit/mozhou-comprehensive-audit-report-2026-10-02.md` | 上一份综合审计报告 | 否 |
| U7 | `docs/audit/mozhou-first-audit-report-2026-10-02.md` | 上一份首轮审计报告 | 否 |
| U8 | `docs/audit/mozhou-full-pipeline-acceptance-report-2026-10-02.md` | 上一份全链路验收报告 | 否 |
| U9 | `packages/data-plane/src/export-formats.test.ts` | 数据面导出格式测试 | 是 |
| U10 | `packages/pipeline/src/guardrails-hardening.test.ts` | 管线护栏加固测试 | 是 |
| U11 | `scripts/corpus/famous-novels-corpus.mjs` | 名著语料加载器 | 否（评测语料） |
| U12 | `scripts/corpus/lingjie-daozhong-loader.mjs` | 语料加载器 | 否 |
| U13 | `scripts/measure-draft-context.mjs` | 草稿上下文测量 | 否（评测工具） |
| U14 | `scripts/verify-batch-novel-pipeline-stress.mjs` | 批量压力验收脚本 | 否（评测工具） |
| U15 | `scripts/verify-famous-novel-refine.mjs` | 名著精修验收脚本 | 否 |
| U16 | `scripts/verify-mock-journey.mjs` | mock 旅程验收脚本（`package.json` 已引用，见 M17） | 否（评测工具） |
| U17 | `.agent-teams/`（8 文件：3 个 archive 团队 + 本审计团队 + `retired-members.json`） | 代理团队状态 | 否 |

> ⚠️ **U13–U16 是未跟踪脚本，但 M17 让 `package.json` 的 `verify:journey` 指向 U16。** 也就是说 HEAD 上的 `package.json`（无该脚本）与工作区的 `verify:journey` 依赖一个**未纳入版本控制**的文件。标 `WORKTREE(未提交)`。

---

## 4. 适用的 AGENTS / Skills / 项目约束

### 4.1 约束层级（其他成员必须遵守）

1. **全局主契约**：`C:\Users\a1691\.zcode\AGENTS.md`（85 行，**本会话已完整读取**）。含：授权边界、协作与真实验证、**代码图谱门禁**、部署/集成/工具包装交付门禁、本地数据库（dbhub）、Git 分支与提交、Windows 工具。
2. **项目级**：`C:\zcode\novel-ai\AGENTS.md`（MoZhou 仓库约定）：§0 流程权威裁决（mattpocock/skills 为唯一流程权威；spec-kit/superpowers/.dwf.ts 降级）、§1–§8 UVSD v2.2.1、§9 Wayfinder。
3. **DSH 入口**：`~/.dsh/AGENTS.md`。
4. 本文件与 `00-audit-charter.md` 定义的**审计口径**（在上述之上做收紧，不放松）。

### 4.2 `AGENTS.md` / `CLAUDE.md` 工作区改动要点及其对审计口径的影响

两个文件当前都是**已修改**状态（`M`），改动高度一致：

| 改动 | `AGENTS.md` | `CLAUDE.md` | 审计影响 |
|---|---|---|---|
| 文件头新增「本会话第一个动作先读全局 AGENTS.md」闸门 | ✔ 新增 2 行 | ✘ | 使**全局契约必读**成为硬前置；本审计已遵守 |
| gitnexus 符号计数 `9653 → 10007 symbols`、`21363 → 21780 relationships` | ✔ | ✔ | 说明这两处数字**已被图谱重新注入过一次**（即 10/2 21:22 那次 analyze 之后被改过），但 gitnexus 未被提交 |
| 6 行技能路径 `.agents/skills/… → .claude/skills/…` | ✔ | ✔ | **两处技能目录都存在且都已提交、内容干净**（见 §4.3），所以路径改写不指向不存在的文件 |

证据：`logs/014-AGENTS-md-diff.txt`、`logs/015-CLAUDE-md-diff.txt`

**对审计口径的三个实质影响：**

1. **`gitnexus:start` 区块是 GitNexus 托管内容。** 默认 `analyze` 会重写该区块；而这两个文件带未提交改动 → 本审计**禁止**跑裸 `analyze`（见 §5.4）。
2. **技能路径被改写但两处都在**，`.claude/skills/`（仅 gitnexus 六件套）与 `.agents/skills/`（gitnexus 六件套 + speckit 九件套）。`git status` 对这两个目录**无任何输出**（干净且已提交）。本次审计实际加载的是 **`.claude/skills/gitnexus-cli/SKILL.md`** 与 **`.claude/skills/gitnexus-exploring/SKILL.md`**。
3. **AGENTS.md §0 把 spec-kit 降级为「产物目录」**，而 `.agents/skills/` 仍保留 9 个 `speckit-*` 技能文件。两处存在**文档与实物的不一致**。本次审计不据此下结论，仅记录。

### 4.3 `eslint.config.js` 门禁放宽（重要）

工作区把 `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` 从 **80 上调到 120**，注释写明「服务端新增测试文件使 defaultProject 匹配数达到 86，上调至 120 恢复 `pnpm lint` 门禁」。

**审计口径**：任何以「lint 门禁通过」为依据的结论，在工作区状态下**不等于** HEAD 下的门禁强度。标 `WORKTREE(未提交)`。

### 4.4 Skills 目录实测

| 目录 | 存在 | 是否 git 跟踪 | 状态 |
|---|---|---|---|
| `.claude/skills/`（6 个 gitnexus + README） | ✔ | ✔ | 干净 |
| `.agents/skills/`（6 个 gitnexus + 9 个 speckit） | ✔ | ✔ | 干净 |
| `.gitnexus/run.cjs` | ✔ | ✘（gitignored，15584 B，mtime 2026/7/29） | — |

---

## 5. 图谱门禁记录

### 5.1 结论先行

> **本次已通过图谱门禁，走 CLI 通道。** GitNexus **MCP 通道对本会话不可用**，但 CLI 提供等价能力（`query` / `context` / `impact` / `trace` / `cypher` / `detect-changes` / `check`）。

### 5.2 MCP 通道可用性（三重取证，均为「不可用」）

| 取证方式 | 结果 |
|---|---|
| `cordis_inspect_list`（DSH Inspect 提供方全量） | 只有 DSH 自有提供方 `Service`/`Event`/`Config`/`Tool`/`Builtin`/`Slots`/`Theme`；**无 gitnexus** |
| `cordis_inspect_query(host, Tool, listTools)`（本 Agent 可调工具全量枚举） | 检索 `gitnexus` / `execute_sql` / `search_objects` / `detect_changes` → **0 个工具命中**（4 处 `impact` 命中全部落在 anysearch 描述文字里，非工具名） |
| `list_mcp_resources(server=anysearch)` | `{"resources":[]}`；本会话仅配置 `anysearch` 与 `n8n` 两个 MCP server |

**但宿主上确实在跑 gitnexus 与 dbhub 的 MCP server 进程**（PID 43188、35668 为 `gitnexus\dist\cli\index.js mcp`），它们绑定的是**其它客户端**的会话，不是本 DSH 会话。**不要把「宿主在跑」当成本会话可用。**

### 5.3 `node .gitnexus/run.cjs` 实际支持的子命令（实测 v1.6.10-rc.123）

`setup` `uninstall` `analyze` `index` `serve` `mcp` `list` `status` `doctor` `embeddings` `clean` `remove` `wiki` `augment` `publish` `query` `context` `impact` `trace` `cypher` `detect-changes`(别名 `detect_changes`) `check` `eval-server` `group` `help`

> ⚠️ **技能文档已过时**：`.claude/skills/gitnexus-cli/SKILL.md` 只记载了 5 条（`analyze` / `status` / `clean` / `wiki` / `list`），并把 `query`/`context`/`impact`/`detect_changes`/`explain` 描述成「MCP 工具」。**实测这些在 CLI 里都存在**（`explain` 除外）。以 `--help` 实测为准，不要以 Skill 文档为准。

### 5.4 逐命令实测可用性

| 命令 | 状态 | 证据 / 备注 |
|---|---|---|
| `status` | ✅ 可用 | `logs/022`。Index commit `90b45a1` = Current commit `90b45a1`，`Status: ⚠️ stale` |
| `list` | ✅ 可用 | `logs/024`。22 个已索引仓 |
| `doctor` | ✅ 可用 | Graph store / FTS / VECTOR 全 available |
| `check --cycles` | ✅ 可用 | `logs/025-gitnexus-check-cycles.txt`，`No circular imports found.`，exit 0 |
| `query` | ✅ 可用 | `logs/026-gitnexus-query-context-receipt.txt` |
| `context` | ✅ 可用 | `logs/028`。**必须用真实导出名**：文件里没有名为 `assemble` 的符号，真实名是 `assembleBudgetedContext` |
| `impact` | ✅ 可用 | `logs/029` |
| `detect-changes` | ✅ 可用 | `logs/027`。`26 files, 38 symbols / 297 affected processes / Risk: critical` |
| `analyze --help` | ✅ 可用 | `logs/023`。仅取帮助，**未执行索引** |
| `analyze`（实际索引） | ⛔ **刻意未执行** | 写操作；默认会重写 `AGENTS.md`/`CLAUDE.md` 的 gitnexus 区块，而两者带未提交改动 |
| `clean` / `remove` | ⛔ 未执行 | 破坏性 |
| `wiki` | ⛔ 未执行 | 需 LLM API key + 写文件 |
| `publish` | ⛔ 未执行 | 对外网络 |
| `mcp` / `serve` / `eval-server` | ⛔ 未执行 | 长驻服务 |
| `setup` / `uninstall` | ⛔ 未执行 | 改编辑器配置 |
| `index` / `embeddings` / `augment` / `group` | ⛔ 未执行 | 本任务不需要 |
| **`explain`（taint）** | ❌ **本版本不存在** | 1.6.10-rc.123 无该子命令 → 污点分析不可用 |
| `impact --mode pdg` | ⚠️ 参数存在但不可用 | 需先 `analyze --pdg`；当前索引是否含 PDG **未验证** |

完整矩阵：`logs/032-graph-gate-matrix.txt`

### 5.5 索引新鲜度判定与处置

| 项 | 值 |
|---|---|
| 注册名 / 路径 | `mozhou` / `C:\zcode\novel-ai` |
| 索引时间 | 2026/10/2 21:22:02 |
| 索引提交 | `90b45a1` |
| 当前提交 | `90b45a1`（相同） |
| 规模 | 1029 文件 / 10007 符号 / 21780 边 / 673 簇 / 516 执行流 |
| `status` | **⚠️ stale** |

**判定**：提交相同但仍 stale → **陈旧原因是工作区脏，不是提交漂移**。因此该索引实际上是「**2026-10-02 21:22 时刻的工作区快照**」，已包含当时的未提交改动，**不含 21:22 之后的改动**（`App.tsx` 21:42、`evidence/.../result.json` 22:02、`eslint.config.js`、以及全部 8 个 `.claude`/`.agents` 路径改写等）。

**处置**：**不刷新索引**。理由：刷新是写操作且会碰用户已改的 `AGENTS.md`/`CLAUDE.md`，超出只读授权；当前索引对「结构与拓扑」类结论仍然有效。

若后续成员确需刷新，**唯一允许的形态**（已实测存在于 `analyze --help`）：

```powershell
# 首选：完全不做任何文件注入
gitnexus analyze --index-only -r "C:\zcode\novel-ai"
# 次选：仅跳过 AGENTS.md / CLAUDE.md 注入
gitnexus analyze --skip-agents-md -r "C:\zcode\novel-ai"
```

**绝对禁止**：`--self-commit`（实测存在，会自动 commit `AGENTS.md`/`CLAUDE.md`）；裸 `analyze`（默认注入两文件 + skills）；`clean`。

### 5.6 三个必须知道的操作坑（实测）

1. **仓库选择器**：`-r "mozhou (C:\zcode\novel-ai)"` **失败**（`Repository not found`，反斜杠被吃掉）。必须用**绝对路径** `-r "C:\zcode\novel-ai"`。仓库自带脚本 `graph:check` 用的是 `-r .`（在仓库根执行，等价）。
2. **`run.cjs` 会重新切分多词参数**：`run.cjs` 在 win32 用 `execFileSync(..., {shell:true})`（第 313 行），`query "context receipt"` 被拆成两个词 → `too many arguments for 'query'`。**多词参数请直接调全局 `gitnexus`**，或用 `-q/--query` 形式。
3. **每次调用都打印 `DEP0190` 弃用警告**，来源同上 `shell:true` + 未转义拼接。属**低危参数注入面**（若参数来自不可信输入）。本审计未发现该路径接收外部输入，标 `PARTIAL`。

### 5.7 「图谱已覆盖」与「图谱未覆盖」

**已覆盖（可作拓扑证据）**：TS/TSX 符号定义；静态 `import`/`call` 边；跨 workspace package 依赖边；同进程执行流。

**未覆盖（必须 E1/E4 补证，且不得写「图谱确认」）**：

| 未覆盖域 | 本仓具体落点 |
|---|---|
| **Rust** | `src-tauri/src/main.rs`（12 行，全仓唯一 Rust 源文件）——**完全不在图谱内** |
| **动态加载 / 运行时解析** | `apps/web/node_modules/@mozhou/*` 是**指向 `packages/*` 的 Junction**，运行时才解析到 `packages/*/dist`；`dataRoot.js` 按 env/cwd 动态决定数据根 |
| **文件/配置约定** | `tauri.conf.json`、`installer.iss`、`MoZhou.cs`、`pnpm-workspace.yaml`、`kernel-schema.ts` 的类型契约、路由表 |
| **HTTP 边界** | `dist-server/routes/*.js` 只保留 `import '@mozhou/context-compiler'`，路由↔handler 运行时连线不进调用图 |
| **IPC / 进程边界** | `MoZhou.cs` → `runtime/node.exe desktop-server.mjs` → `productionServer.js`；launcher 用**私有 stdin 管道**下发 `shutdown`；`FindStablePort` 端口分配 |
| **事件协议** | 浏览器事件、订阅语义 |
| **外部副作用** | 真实模型调用、支付、`billing.sqlite` 落盘、`installation.key` 生成 |
| **构建产物一致性** | `dist/` 与 `dist-server/` 与源码的对应关系（图谱只索引源码） |

---

## 6. 数据库通道记录

### 6.1 结论

> **MCP 通道对本会话 = `BLOCKED`。** dbhub 连接器在宿主上运行正常，但**未绑定到本 DSH 会话**。

### 6.2 取证

| 项 | 事实 |
|---|---|
| 本会话 dbhub 工具 | **无**。`Tool.listTools` 全量枚举中 `execute_sql` / `search_objects` 命中 0 |
| 宿主上的 dbhub 进程 | **5 个**（PID 32104、10640、34544、11324、43100）：`node ...\@bytebase\dbhub\dist\index.js --config C:\Users\a1691\.dbhub\dbhub.toml --transport stdio` |
| 连接器配置 | `C:\Users\a1691\.dbhub\dbhub.toml`（25 行，mtime 2026/9/30 11:42:37） |
| 数据源 id（**仅记录名称，不记录任何凭据值**） | `sqlite`、`postgres`、`mysql`、`mozhou_rt` |
| 工具名 | `execute_sql`、`search_objects` |
| 配置内声明 | `readonly = true` |
| 规定的非 MCP 客户端 | `C:\zcode\databases\seed_novel_data.py`（`DbHub` 类，11773 B）——**本次未执行** |
| `mozhou_rt` 定位 | SQLite 3，`C:\zcode\mozhou-author-os\.experiment-data\books\<书名>\.mozhou\runtime.sqlite`，mozhou-author-os **真实书稿库，必须只读**；相关表 `books`/`meta`/`outline_nodes`/`planning_artifacts` |

证据：`logs/031-db-channel-evidence.txt`、`logs/030-dbhub-source-names.txt`

### 6.3 约束确认

- 本审计**未**执行任何数据库查询，**未**读取任何书稿行数据，**未**安装任何驱动，**未**绕过连接器直连。
- 后续成员若需数据库证据：优先请求把 dbhub 绑定进本会话；否则写 `BLOCKED` 并明确「因此以下主张缺数据库证据」。
- `mozhou_rt` 任何情况下保持只读；不得为验收试写真实书稿。

---

## 7. 上一份报告与当前状态的一致性核对

### 7.1 引用核对（**一致**）

五份上一轮产物**全部**声明同一基线，且与当前状态完全吻合：

| 文件 | 声明 | 与当前实测 |
|---|---|---|
| `MOZHOU_MODULE_ARCHITECTURE_AUDIT.md` L4 | `feature/windows-local-release` @ `90b45a1` | ✅ 一致 |
| `docs/audit/mozhou-comprehensive-audit-report-2026-10-02.md` L4 | 同上 + `v0.3.0 Technical Preview` | ✅ 一致 |
| `docs/audit/mozhou-first-audit-report-2026-10-02.md` L4 | 同上 + `ahead of origin by 7 commits` | ✅ 一致（实测 ahead 7） |
| `docs/audit/mozhou-full-pipeline-acceptance-report-2026-10-02.md` L5 | 同上 | ✅ 一致 |
| `docs/audit/gitnexus-impact-analysis-phase1-2026-10-02.md` L5/L14 | `commit 90b45a1` | ✅ 一致 |

扫描这五份文件中出现的全部十六进制串，**除 `90b45a1` 外无其他提交哈希**。

### 7.2 但存在一处未被声明的偏移（**本次审计的关键发现**）

> **五份报告都把基线写成 `90b45a1`（一个提交），而它们的写作时间全部晚于工作区改动。**

mtime 排序（全部实测）：

```
2026-10-02 20:35:50  apps/web/server/routes/pipelineRoutes.ts      ← 早于所有报告
2026-10-02 21:10:45  docs/audit/mozhou-first-audit-report….md
2026-10-02 21:15:16  windows-install-check-report.json
2026-10-02 21:17:53  docs/audit/mozhou-comprehensive-audit-report….md
2026-10-02 21:31:34  docs/audit/gitnexus-impact-analysis-phase1….md
2026-10-02 21:42:32  apps/web/src/App.tsx                          ← 晚于前两份报告
2026-10-02 22:02:31  evidence/usability-fixes-20260921/result.json
2026-10-02 23:49:56  docs/audit/mozhou-full-pipeline-acceptance-report….md
2026-10-03 00:23:36  MOZHOU_MODULE_ARCHITECTURE_AUDIT.md            ← 距本次审计开始仅 25 分钟
```

**审计口径**：上一份报告的「基线 = 90b45a1」只声明了**提交**，**没有声明工作区**。凡其结论触及 §3.2–§3.4 任一路径，**必须重标为 `WORKTREE(未提交)`**。五份报告本身**均未跟踪**（无 HEAD 版本）。

### 7.3 发布产物溯源：两份清单自相矛盾

| 文件 | 声明的提交 |
|---|---|
| `release-artifacts/release-manifest.json` | `"targetCommit": "local-draft"` |
| `release-artifacts/windows-build-result.json` | `"sourceCommit": "90b45a1a1bf15a97b1cc690ad0b9872018aeebcb"`（完整哈希） |

**二者不一致，且都不可用 git 验证。** 构建发生在 2026/10/2 21:13–21:15，当时工作区**已经不干净**（`pipelineRoutes.ts` 20:35 早于构建 → 会被打进产物；`App.tsx` 21:42 晚于构建 → 不会）。**因此已发布的 v0.3.0 安装包是 HEAD 与工作区的混合物，其「sourceCommit = 90b45a1」不成立。** 这条请交给「复核上一份报告争议点」成员定级。

---

## 8. 运行单元的版本与数据目录

### 8.1 关键结论：运行的是**工作区**，不是 `HEAD:90b45a1`

这是本次基线最有操作价值的一条，已**验证**（非推演）：

1. `apps/web/node_modules/@mozhou/*` 是 **Junction**，指向 `C:\zcode\novel-ai\packages\*` 活源码目录（7 个：context-compiler、data-plane、flywheel、kernel、pipeline、quality-engine、runtime；**`benchmark` 未被链接进 web**）。
2. `packages/context-compiler/package.json` 的 `main` = `./dist/index.js`。
3. `packages/*/dist` 构建于 **2026/10/2 23:37–23:41**；`apps/web/dist-server` 与 `apps/web/dist` 构建于 **23:44–23:45**。
4. 所有工作区改动的 mtime **都早于**上述构建时间（`App.tsx` 21:42、`pipelineRoutes.ts` 20:35、`assemble.ts` 10/1 12:10、`kernel-schema.ts` 10/1 12:09）。
5. **直接证据**：工作区新增的 `summarizeByChannel`（HEAD 不存在）在 `packages/context-compiler/dist/assemble.js` 中出现 **8 次** → 包产物确由工作区构建。
6. `dist-server` **不内联** workspace 包，而是保留 `import { canonicalJson, … } from '@mozhou/context-compiler'`（`worksRoutes.js:3`、`semanticEvaluator.js:15`）→ 运行时经 Junction 解析。

> ⇒ **`pnpm start`、任何 `dist-server` 运行、`serve` 脚本执行的都是工作区代码。** 任何「在真实运行中观察到 X」的结论，其标签是 `WORKTREE(未提交)`，**不能**写成 `HEAD:90b45a1`。

### 8.2 版本 × 数据目录矩阵

| 运行方式 | 代码版本 | 进程 | 数据目录 | 状态 |
|---|---|---|---|---|
| `pnpm start`（`scripts/launcher.mjs`） | **工作区** | 独立 Node 进程，入口 `apps/web/dist-server/productionServer.js` | `cwd`=仓库根 → `C:\zcode\novel-ai\.mozhou_data`（除非 `MOZHOU_DATA_ROOT`） | 端口 `5173`，host `127.0.0.1`；`MOZHOU_NO_OPEN=1` 可禁自动开浏览器 |
| `pnpm --filter @mozhou/web dev`（vite） | 工作区源码 | Vite 进程 | `cwd`=`apps/web` → `apps\web\.mozhou_data` | `tauri.conf.json` 的 `beforeDevCommand` |
| `pnpm --filter @mozhou/web serve` | 工作区 `dist-server` | Node 进程 | `cwd`=`apps/web` → `apps\web\.mozhou_data` | — |
| `pnpm --filter @mozhou/web test` | 工作区源码 | vitest | 测试临时目录 | — |
| `tauri dev` / `desktop:dev` | 工作区 | Tauri + WebView | **未验证**（`main.rs` 不 spawn 服务端，数据根取决于 cwd） | `src-tauri/target/{debug,release}` **均不存在**，无 cargo 构建产物 |
| 已安装桌面程序 `MoZhou.exe` | **v0.3.0**，安装于 2026/9/27 00:52 | `MoZhou.exe` → `runtime\node.exe desktop-server.mjs` | **`%LOCALAPPDATA%\MoZhou`**（可 `--data-dir` 覆盖） | 目录**不存在** → 该安装**从未完成过数据根初始化**；且它**早于** `release-artifacts` 的 10/2 安装包 |
| 容器 / `deploy/` | v0.3.0 tar 包 | — | **必须显式 `MOZHOU_DATA_ROOT`** | `desktop-server.mjs` 里 `resolve(process.env.MOZHOU_DATA_ROOT)` **无 fallback，未设即抛错** |

### 8.3 本机实测存在的数据目录

| 路径 | 状态 | 备注 |
|---|---|---|
| `C:\zcode\novel-ai\.mozhou_data` | **存在** | `backups/`、`billing.sqlite(+wal/shm)`、`.mozhou_instance.lock`；lock mtime 2026/10/2 22:02:13 |
| `C:\zcode\novel-ai\apps\web\.mozhou_data` | **存在** | 另有 `memo/`；`billing.sqlite-shm` mtime **2026/10/2 23:51:04**（构建后 6 分钟）→ 当时应有 dev server 从 `apps/web` 跑过 |
| `C:\zcode\novel-ai\src-tauri\.mozhou_data` | 不存在 | — |
| `%LOCALAPPDATA%\MoZhou` | **不存在** | 见上 |
| `%APPDATA%\com.mozhou.author` / `MoZhou` / `mozhou` | 不存在 | — |
| `%LOCALAPPDATA%\Programs\MoZhou` | **存在** | v0.3.0，含 `MoZhou.exe`、`runtime/`、`app/dist`、`app/dist-server`、`unins000.exe` |

> ⚠️ 这两个 `.mozhou_data` 里是**真实 `billing.sqlite` 及 WAL**。**本次审计全程只读、未打开、未触碰。** 后续成员同样不得触碰。

### 8.4 两套互不相同的数据根契约（行为语义差异，已取证）

| | `apps/web/server/dataRoot.ts`（源码直跑 / 容器内服务） | `scripts/release/windows/desktop-server.mjs`（发行包入口） |
|---|---|---|
| 有 env | `resolve(MOZHOU_DATA_ROOT)` | `resolve(MOZHOU_DATA_ROOT)` |
| 无 env | **回落**到 `resolve(cwd, '.mozhou_data')` | **无回落，直接抛错** |
| 自述 | `dataRootSource()` 返回 `env` / `default`，健康端点回传 | 还负责 `installation.key`（48 随机字节 hex，`wx`）+ `MOZHOU_SECRET_KEY` + `NODE_ENV=production` + `MOZHOU_HOSTED=false` + `HOST=127.0.0.1` |
| 注释原文 | 「容器内数据落在镜像层，`docker compose down`…会连同全部书稿一起销毁，且没有任何报错」 | 「Windows cannot send POSIX SIGTERM…用私有 stdin 管道进入既有 drain-and-release 关闭流程」 |

**审计口径**：任何关于「数据落在哪里」的结论，必须指明走的是哪条入口。**这两条不是同一行为**，不可互相代证。

### 8.5 运行中进程（只读列举，未停止任何进程）

- **无** mozhou 服务进程、**无** Tauri 进程、**无** `MoZhou.exe`。
- 端口 5173 **未**监听；43000–43999 **未**监听。
- 端口 **4173 正在监听**，属主 PID 44268 = `python.exe -m http.server 4173` —— 这是一个普通 Python 静态文件服务器，**不是** mozhou / vite preview。**不要误认为产品在运行。**

### 8.6 桌面宿主是空壳

`src-tauri/src/main.rs` 全文 12 行：`tauri::Builder::default().setup(println!).run(tauri::generate_context!())`。**无 tauri command、无 plugin、无 sidecar、无 spawn Node 服务端。** 真正的桌面进程编排由 `scripts/release/windows/MoZhou.cs`（C#）+ `desktop-server.mjs`（Node）承担。

---

## 9. 交付给其他成员的速查

| 你要做 | 标签怎么打 | 走哪条通道 |
|---|---|---|
| 任何依赖未改动文件 | `HEAD:90b45a1` | `git show 90b45a1:<path>` |
| 任何触及 §3.2–§3.4 的结论 | `WORKTREE(未提交)` | 读工作区文件 |
| 调用链 / 影响面 / 依赖拓扑 | 必须附图谱命令 | `gitnexus query/context/impact/detect-changes -r "C:\zcode\novel-ai"`（**用全局 `gitnexus`，多词参数不经过 `run.cjs`**） |
| Rust（`src-tauri`） | 图谱未覆盖 | 只能 E1/E4 |
| HTTP / IPC / 事件 / 配置约定 | 图谱未覆盖 | 只能 E1/E4 |
| 「在运行中看到 X」 | **必然** `WORKTREE(未提交)` | 见 §8.1 |
| 数据库事实 | `BLOCKED`（除非 captain 绑定 dbhub） | 不得直连 |
| 真实模型 / 支付 / 发布 | `NOT RUN` | 不在授权内 |

**复现本文件全部事实的命令**：`git rev-parse HEAD`、`git status --porcelain`、`git log -3`、`node .gitnexus/run.cjs status`、`gitnexus check --cycles -r "C:\zcode\novel-ai"`、`cordis_inspect_list`、`gitnexus doctor`。原始输出见 `logs/010`–`logs/033`。
