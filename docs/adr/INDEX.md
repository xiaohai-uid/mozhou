# 决策地图 (Decision Map)

墨舟全部架构决策的入口。**一个事实只有一个家**：决策只在这里和它指向的 ADR 文件里，不出现在 `GLOSSARY.md`（术语）、`AGENTS.md`（流程）、`docs/architecture.md`（生成式组合图）。

> 清单由脚本从 `docs/adr/*.md` 的实际标题生成（2026-10-01），不是手抄。

## 编号规则

| 前缀 | 含义 | 范围 |
|---|---|---|
| `K-` | 内核线（英文标题系列） | `K-0001` – `K-0007` |
| `A-` | 应用线（中文标题系列） | `A-0001` – `A-0007` |
| 无前缀 | 合并后单一系列，从未发生编号冲突 | `0008` – `0036` |
| `L-` | **保留段**：合并时丢失的第三系列。**判定不可恢复**，见 ADR-0033 | 未启用 |

## 裸号速查表（`0001`–`0007`）

> **这是本文件最重要的一张表。** 每个编号对应**两条不同决策**。任何残留裸号引用都靠它定位：

| 裸号 | `K-`（内核线） | `A-`（应用线） |
|---|---|---|
| 0001 | Novel Kernel Architecture over Skill Adapters | 统一写作上下文边界与模型输入分层 |
| 0002 | Temporal Canon Graph and Candidate-to-Canon Fact Lifecycle | 写作上下文、模型传输与候选生命周期深化 |
| 0003 | Dependency Manifest and Deterministic-First Change Impact Engine | 将候选生命周期从写作上下文修复中隔离 |
| 0004 | Two-Stage Context Architecture: Story Bible vs. Context Compiler | 写作请求保留语义 seam 与 wire payload seam |
| 0005 | Policy Flywheel and 4-Tier Local-First Privacy Boundary | 扫榜、趋势与搜索通道 |
| 0006 | Local Data Plane: Canon Files and SQLite Projection | Skill 运行时与 A 版双栏工作台 |
| 0007 | Novel Runtime Event Architecture | 可恢复创作任务运行时 |

**引用规则**：`0001`–`0007` 必须写全前缀；`0008` 及以后可裸写。

**自动改写**：`pnpm gen:adr-refs` 按上下文标题线索机械加前缀，**判不出的一律不动**。当前 30 处已改写。

> **已知误判并已修正**：脚本曾把 `docs/research/t30-d-upstream-convergence.md:36`（原文写「直接对应内核线 NovelRuntime」）判成 `A-0007`，实为 `K-0007`；已修正。`0024:18` 的 `候选生命周期在 ADR-0002/0014` 属真歧义（K-0002 与 A-0002 都讲候选生命周期），已**退回裸号**。

**门禁**：`pnpm run check:glossary` 统计裸号数量并与预算比对（当前 **54 / 54，只许减不许增**），已接入 CI。

## 内核线（K-）

| 编号 | 标题 |
|---|---|
| K-0001 | Novel Kernel Architecture over Skill Adapters and Multi-Agent Panels |
| K-0002 | Temporal Canon Graph and Candidate-to-Canon Fact Lifecycle |
| K-0003 | Dependency Manifest and Deterministic-First Change Impact Engine |
| K-0004 | Two-Stage Context Architecture: Story Bible vs. Context Compiler with Transparent Receipts |
| K-0005 | Policy Flywheel and 4-Tier Local-First Privacy Boundary |
| K-0006 | Local Data Plane: Dual Storage of Human-Readable Canon Files and SQLite Projection |
| K-0007 | Novel Runtime Event Architecture: Event Bus, Session Replay, and Auditability |

## 应用线（A-）

| 编号 | 标题 | 状态 |
|---|---|---|
| A-0001 | 统一写作上下文边界与模型输入分层 | |
| A-0002 | 写作上下文、模型传输与候选生命周期深化 | |
| A-0003 | 将候选生命周期从写作上下文修复中隔离 | |
| A-0004 | 写作请求保留语义 seam 与 wire payload seam | |
| A-0005 | 扫榜、趋势与搜索通道（2026-08-14） | |
| A-0006 | Skill 运行时与 A 版双栏工作台进入真实产品 | accepted |
| A-0007 | 可恢复创作任务运行时进入真实产品 | accepted |

## 合并后单一系列（0008–0036）

| 编号 | 标题 | 状态 |
|---|---|---|
| 0008 | Evaluation Engine as a First-Class Subsystem | |
| 0009 | Capability Registry Inspired by DeepSeek Harness Plugin Architecture | |
| 0010 | External Edit Reconciliation and Dual-Plane Synchronization | |
| 0011 | Two-Tier Fact Compaction and Scene-Level POV Knowledge Slicing | |
| 0012 | Scenario-Classified Style Evolution and Anti-Drift Algorithm | |
| 0013 | Single-Stream Drafting and Localized Multi-Candidate Preference Sampling | |
| 0014 | Canon Conflict Reconciliation and Guided Intentual Mutation | |
| 0015 | Market Brain Lifecycle Boundary | |
| 0016 | Two-Tier Evaluation Harness: Fast Deterministic Mock vs. Live Model Benchmark | |
| 0017 | Mainstream Novel Platform Market Sources and Strict Legitimate Indexing | |
| 0018 | Two Hard Anti-Rework Gates: Requirement Fidelity and Real Stability | |
| 0019 | Research-Driven Amendments | |
| 0020 | Two-Phase Reserved Token Budget Assembly with Story-Text Quota | |
| 0021 | Context Receipt Physical Storage: Receipt Files with Pointer Events | |
| 0022 | Deterministic K-Hop Graph Recall over the POV-Visible Temporal Canon Subgraph | |
| 0023 | 执行基底单一化：内核线吸收应用线可恢复任务语义 | accepted |
| 0024 | 章节生产管线事务化编排：单一 session 步进状态机 | accepted |
| 0025 | 文学质量审查边界：独立于正典的前置质量门 | accepted |
| 0026 | KnowledgeState 认知层级：知情 ≠ 怀疑 ≠ 信念 | accepted |
| 0027 | UI 基线：Ink Orbit 深色工作台 | accepted |
| 0028 | UI 基线升级：Ink Realm / 墨境（superseding 0027 的视觉层） | accepted |
| 0029 | 银白创作空间（superseding ADR-0028 视觉层） | |
| 0030 | 本地 API 信任模型 | |
| **0031** | **六条工作流线收敛为一条，AGENTS.md 补优先级规则** | **accepted** |
| **0032** | **CONTEXT.md 升格为 GLOSSARY.md，纪事迁出** | **accepted** |
| **0033** | **ADR 双系列加前缀消歧，第三系列不可恢复** | **accepted** |
| **0034** | **Issue tracker 按关注点分工，ID 方案收敛为一套** | **accepted** |
| **0035** | **操作幂等与写入结果可对账（W3 Contract Delta）** | **accepted** |
| **0036** | **提交时安全扫描保持 advisory（扫描结论不完整时的处置）** | **accepted** |

## 本轮裁决与执行结果

| 编号 | 决定了什么 | 执行结果 |
|---|---|---|
| 0031 | mattpocock/skills 是唯一流程权威 | `AGENTS.md` 两块合一 + §0 优先级规则；`.zcode/skills/` 10 个副本已删；`.specify/memory/constitution.md` 已加警示横幅 |
| 0032 | `CONTEXT.md` → `GLOSSARY.md` | 459 行 / 88 词条 / 88 条 `_Avoid_`；27 个文件引用改写；`CONTEXT.md` 已退役 |
| 0033 | `K-` / `A-` 前缀消歧 | 14 文件重命名；30 处交叉引用加前缀 |
| 0034 | 执行状态 = GitHub，规格决策 = 本地 | `docs/agents/issue-tracker.md` 空白备档节已填；**实测纠正「74 个带 status」为 9/74** |

## 门禁（均已接入 CI）

| 命令 | 检查什么 | 失效方式 |
|---|---|---|
| `pnpm run check:glossary` | 术语单一权威：GLOSSARY 存在且每词条有 `_Avoid_`；`CONTEXT.md` 不复现；AGENTS 流程块唯一；ADR 文件名无裸号；裸号引用不超预算 | exit 1 |
| `pnpm run check:architecture` | `docs/architecture.md` 与生成器输出逐字一致 | exit 1 |
| `pnpm run gen:adr-refs` | 把可判定的裸 `ADR-000X` 改写为 `K-`/`A-` 前缀 | 判不出则不动 |
| `pnpm run gen:architecture` | 重建架构地图 | — |

> 两个门禁都**实测过会失败**：加一处歧义引用 → glossary 门 exit 1；手动改架构地图 → architecture 门 exit 1。

## 挂账项

| # | 事项 | 状态与证据 |
|---|---|---|
| 1 | ~~74 个本地工单的 status frontmatter 迁移~~ | **已裁决**（ADR-0034）— 实测只有 **9 / 74** 且同属 `mozhou-deepening-20260928` 单一批次，改为整批冻结，无需逐文件迁移 |
| 2 | `.claude/skills/` 6 个 gitnexus 副本 | **保留** — 它是 Claude Code 读项目技能的唯一路径，该回退行为**未验证**；已在 `.claude/skills/README.md` 写明「两份都别手工改」+ 一致性核验命令 |
| 3 | `.mimosa/` 保留期 | **方案已成型，待你点头**。实测：`hook-state/` = 121,980 文件 / 953.1 MB，占全目录 **99.9%**；其下 85 个子目录形如 `sess_<uuid>.<hash>.baseline`，是**逐 actor 的基线快照**；最新写入 **2026-09-30 13:05**，距今约 32 小时无活动；在 `~/.claude`、`~/.dsh`、`~/.agents`、`~/.codex`、winclaw（深度 3）**均未找到 mimosa 配置**。<br>**建议**：保留 `reports/`(49) + `finding-ledger/`(50) + `history/`(37) + `hook-status/`(44) = 180 文件 / ~0.9 MB（有审计证据价值），归档或删除 `hook-state/`（**可释放约 953 MB**）。**未执行**——「未找到配置」不等于「已卸载」，且你 Q12 明确要求先定保留期再动手 |
| 4 | `apps/web/src/code-graph/codeGraphSnapshot.ts`（8,296 行已提交生成物） | **未决** — 但它**是活的**：`CodeGraphView.tsx:2` 与 `CodeNodeExplorer.tsx:4` 都 import 它。需你跑一次 `pnpm graph:snapshot` 让它自然重生成 |
| 5 | 代码层重复裁决 | **已完成裁决** — 见 `CODE-DUPLICATION-INVENTORY.md`。9 项里 **5 项前提不成立**；真问题只剩 4 条，见该清单 |
| 6 | 44 处未判定的 ADR 交叉引用 | **未决** — 门禁已锁住预算（54 / 54），只许减不许增 |
| 7a | **ADR-0029「银白」状态陈旧** — 声称已实施，但 `a3bd0db`(09-19) 五天后换回 obsidian 暗色；`globals.css:12` 实为 `#080b11`。回滚残留：`scenePreference.ts:56` 仍默认 `silver-atrium`（暗色 UI 配银白底图）、`storyboard.css:11` / `mobile.css:524` 仍带 `#e6ecf2`。**无任何 ADR 记录这次回滚** | **未决** |
| 7 | 0029 / 0030 标题格式与其余 35 条不一致 | **未决** — 无实质影响 |
