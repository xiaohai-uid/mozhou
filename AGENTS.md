# 墨舟 (MoZhou) — AI 小说写作平台

> 共享规则的唯一源是 `C:\Users\a1691\.zcode\AGENTS.md`；`C:\zcode\AGENTS.md` 是工作区指针文件。执行前加载当前相关规则；已经完整加载且版本有效的内容可复用，避免重复注入。此文件只追加 MoZhou 项目约束，不替代共享规则。
>
> Repo-level agent instructions; the global contract above always wins, and this file never replaces it.

## 0. 流程权威与优先级

本仓只有一套流程权威：**mattpocock/skills**。UVSD 并入 §1–§8（管"能不能做"），Wayfinder 并入 §9（管"记在哪"）；二者冲突时 **§1–§8 的范围纪律优先**，宁可停下报告依赖，不得自行扩大范围。spec-kit/speckit、superpowers、DSH `.dwf.ts` 分别降级为产物目录（`.specify/`、`specs/`）、历史层（`docs/superpowers/`）、任务级脚本（`.zcode/workflow-drafts/`），保留文件但不再产生新约束。六条线的完整裁决与理由见 [ADR-0031](docs/adr/0031-single-workflow-authority.md)；术语以 [`GLOSSARY.md`](./GLOSSARY.md) 为准，本文件只定义流程；决策入口 `docs/adr/INDEX.md`。

## Engineering Rules - UVSD Protocol v2.2.1 Final

> 生效：2026-08-11（替换旧《全局开发规范 v1.0.0》禁锢规约；V1.0 已归档，12 接口全部真实化，范围锁死解除）。
> 核心口诀：User Journey 决定范围，UI 固化交互，Contract 固化边界，Spike 验证技术风险，Walking Skeleton 贯穿血脉，Vertical Slice 持续交付，Automated Gates 防止 AI 越界。

### 1. Scope & Capabilities
1. User journeys define product scope. UI defines the interactive surface.
2. Do not implement business capabilities that are not required by an approved user journey.
3. Necessary security, persistence, reliability, observability, and runtime infrastructure are allowed only when required by an approved capability.
4. Do not implement speculative V2/V3 abstractions or unrequested architectural layers.

### 2. Ticket Boundary & Scope
5. One ticket implements one observable behavior or capability.
6. A ticket may change multiple related files across layers if required by that capability.
7. Current-ticket local refactoring is allowed only when strictly necessary. Never perform architectural refactoring, cross-module refactoring, directory restructuring, or generic abstraction extraction.
8. If a required fix crosses the ticket boundary, stop and report the dependency instead of expanding scope.

### 3. Contracts & BFF Layer
9. UI consumes explicit typed contracts; UI data models must not directly dictate persistence domain models.
10. Contracts are frozen by default.
11. Contract changes require an explicit Contract Delta and synchronized updates to schema, mock, implementation, and tests.
12. Never bypass a contract with `any`, untyped maps, generic metadata fields (`data?: any`), or undocumented response fields.

### 4. Environment & Mocking Boundaries
13. Mock data is allowed only in development, test, or explicitly marked demo environments.
14. Production must never silently fall back to mock data.
15. Production failures must surface as an explicit error, unavailable state, cached/stale state when valid, or controlled retry.

### 5. Verification & Test Integrity
16. Every change must include appropriate tests.
17. Test failures may only be fixed inside the causal scope of the current ticket via evidence-based iterations. Stop if the same failure repeats twice or requires out-of-scope changes.
18. Never change unrelated code merely to make tests pass.
19. Do not claim completion until required verification checks (TypeCheck, Tests, Build) have actually passed.
20. NEVER weaken, delete, skip, or rewrite a failing test merely to make verification pass. A test may change only when: a) the approved requirement/behavior changed, b) an approved Contract Delta changed the contract, or c) the test itself is demonstrated to be invalid, with the reason documented in the ticket.
21. Existing passing tests are regression constraints and must not be modified or deleted merely to accommodate an implementation.

### 6. Unattended / Night Mode Protocols
22. Unattended Mode may start only from a clean committed baseline in a dedicated branch or isolated git worktree. If unrelated uncommitted developer changes exist, DO NOT start autonomous implementation; mark the run BLOCKED.
23. NEVER perform destructive Git operations (`git reset --hard`, `git clean -fd`, `git checkout -- .`) on uncommitted developer work.
24. NEVER execute production DB migrations, deploy code, publish packages, force-push branches, modify secrets, or trigger irreversible external side effects (payments, real emails).
25. In Unattended Mode: If an architectural decision or ambiguous requirement is required, stop that ticket and mark it BLOCKED. Do not guess.
26. Preserve failed work and diffs in an isolated branch/worktree for developer inspection rather than destructively cleaning it.
27. Produce a structured Morning Report detailing commits, verification results, contract deltas, pending migrations, blocked tickets, external side effects, and retained diffs.

### 7. 项目基建

**作者数据相关改动**（正文写入、任务切换、恢复）优先核对三条项目约束：作者决定正文写入／旧任务不能污染新现场／恢复必须验证作者数据。它们的判断类条款与硬护栏在 [`CODING_STANDARDS.md`](./CODING_STANDARDS.md)——评审代理在 `/code-review` 的 Standards 轴读全文，机械类约束一律做成确定性检查、不加进该文件。三条对应现有领域契约，不授权新增功能，也不改变已冻结的领域契约；完整验收例、源位置与本轮观察见 [Codex 项目验收规格与证据](.scratch/codex-readiness-20261006/spec-and-evidence.md)。

- 术语：**[`GLOSSARY.md`](./GLOSSARY.md)**（原 `CONTEXT.md`，2026-10-01 迁正）
- 架构地图：`docs/architecture.md`；决策地图：`docs/adr/INDEX.md`；决策记录：`docs/adr/`
- 用户指南：`docs/user-guide.md`（面向作者）；开发指南：`docs/development.md`（命令、回滚清单、平台注意）；界面契约：`apps/web/DESIGN.md`
- 历史档案：`docs/archive/`（已完成或被取代的审计/评审/发布报告，一次性证据，不作执行依据）
- 变更记录地图：[`PROJECT-MAP.md`](./PROJECT-MAP.md)（全局指令《项目地图与变更溯源》要求的 canonical 入口）——变更 ID、基线、验收、证据索引；专项细节归上列各图，本图不重复维护
- 契约全集：`.scratch/mozhou-mvp/contracts/api-contract.md`（已实现端点以后端发射端 + 契约测试为准，UI 消费是协议子集）
- 执行跟踪：GitHub Issues（见 §9）；本地规格文档：`.scratch/<feature-slug>/`（**不是**执行状态的家）
- spike 结论：`docs/spikes/`（见 0.5 探针）
- 里程碑：`v1.0.0-release`（全站 12 接口真实化，90/90 测试）
- 挂账项（Deferred Item，用户已定排除）：书源 HTML 规则解析器、会员支付真实化、projects 审查记录+导出备份；风格库持久化已收官（2026-08-11，议题 #14/#15）

> **已更正**：本节的执行跟踪家、挂账项命名与决策记录家已分别更正为 GitHub Issues、挂账项 Deferred Item、`docs/adr/`（原为本地 issues 目录、「遗留切片」、OB `10_Projects/墨舟.md`）；依据 `GLOSSARY.md` Part 2 与 ADR-0032/0034。

### 8. Git 分支与提交约定（2026-09-23 起生效）
- 本仓库采用六分支模型，完整手册见 WinClaw `knowledge/GIT-BRANCHING-AND-COMMIT-STANDARD.md`：
  - `main` = 生产主分支（规范中 `master` 的等价映射，PRO），禁直接改码，仅由 `release`/`hotfix` 合入；
  - `develop` = 开发联调分支（DEV），新功能一律 `feature/<module>` 基于此拉出、完成后合回；
  - `test` = FAT 测试分支；`release` = UAT 预上线分支（发版时从 `test` 拉，惰性创建）；
  - `hotfix/<desc>` 基于 `main`，修复后双合回 `main` + `develop`；
  - AI 代理工作分支可用 `feature/<agent>-<module>` 前缀，但合入语义必须遵守六分支模型（功能只进 `develop`，不直接进 `main`）。
- 提交信息：按全局指令（文件头 `C:\zcode\AGENTS.md`）「Git 分支与提交 → 提交信息与历史保护」章执行（八类 Conventional Commits 前缀、单提交同一类别不超过 3 个问题）；破坏性 Git 操作的禁令以全局同章与本文件 §6 第 23 条为准。本节只保留项目级差异，不重复全局条文。
- 存量历史分支删除前一律打 `archive/branch/<name>` tag 归档，可随时找回。
- **推送前的自动化门（项目级额外项）**：除全局的 act 本地 CI 外，本项目推送前还必须跑 `node scripts/ci-gate.mjs` 的这几个任务——`graph-check`（依赖环，期望 `clean` / `cycleCount: 0`）、`doc-gates`（术语/架构地图/门清单/README 及门清单「在 CI」列一致性）、`import-cycles`、`duplication`。这些步骤 ci.yml / release.yml / graph-gate.yml 里有、本地推送路径原本没有：图谱步骤 ci.yml 与 release.yml 都没有且 `.gitnexus/` 索引不入库，所以只在本地把得住（2026-10-07 发布审计的 1 个循环就是这样活到 HEAD 的）；文档门与导入环 2026-10-10 补齐（此前只覆盖 build/lint/test/graph-check，于是「生成物陈旧到 HEAD 过不了自己的 CI」「重复度门假绿空转」能一路活到 HEAD）。记录见 `docs/changes/CHG-20261008-21-release-stamp-and-local-graph-gate.md` 与 `docs/changes/CHG-20261010-14-retro-guardrails.md`。
- **提交时的快速门（钩子）**：跑一次 `node scripts/install-hooks.mjs` 激活仓库内的 `.githooks/pre-commit`（它先链式调用机器级钩子，再跑术语/门清单/README/导入环四项秒级检查，外加**生成物新鲜度按索引判定**这一项阻断检查；文档裸数字只告警）。**钩子本体在 `.githooks/` 而不是 `.git/hooks/`**——本机全局 gitconfig 设了 `core.hooksPath`，`.git/hooks/` 会被 Git 完全忽略（2026-10-10 实测：装在那里根本不执行）。

## 9. Wayfinder 追踪操作（内核线并入）

### Issue tracker

**执行状态的唯一权威是 GitHub Issues**，用 `gh` CLI 操作。本地 `.scratch/` 下的 markdown 承载**规格与决策**，不是执行状态。两者分工、命令约定与 ID 方案见 `docs/agents/issue-tracker.md`。

### Triage labels

五个规范标签（canonical，非 "default"）：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。存放于 GitHub 议题标签。映射见 `docs/agents/triage-labels.md`。

> **已更正**：五个标签的两套措辞已统一为 **canonical**（映射见 `docs/agents/triage-labels.md`）。

### Domain docs

Single-context：`GLOSSARY.md` 在仓库根（单份术语权威，无 `GLOSSARY-MAP.md`）；决策记录在 `docs/adr/`（惰性创建）。消费规则见 `docs/agents/domain.md`。

> **已更正**：本节的重复同义描述已合并，`docs/agents/domain.md` 对 `CONTEXT-MAP.md` 与 `ADR-0007` 的错误引用已修正。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **mozhou** (13698 symbols, 28915 relationships, 620 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/mozhou/context` | Codebase overview, check index freshness |
| `gitnexus://repo/mozhou/clusters` | All functional areas |
| `gitnexus://repo/mozhou/processes` | All execution flows |
| `gitnexus://repo/mozhou/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
