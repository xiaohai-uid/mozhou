# 墨舟 (MoZhou) — AI 小说写作平台

Repo-level agent instructions. Global user instructions live at `C:\zcode\AGENTS.md` (symlinked from `~/.zcode/AGENTS.md`) — this file only adds project-scoped conventions.

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

### 7. 项目基建（V1.0 已固化，勿删）
- 契约全集：`.scratch/mozhou-mvp/contracts/api-contract.md`（已实现端点以后端发射端 + 契约测试为准，UI 消费是协议子集）
- Ticket tracker：`.scratch/mozhou-mvp/issues/NN-<slug>.md`；spec 见 `.scratch/mozhou-mvp/spec.md`
- 决策记录：OB `10_Projects/墨舟.md`；spike 结论：`docs/spikes/`（见 0.5 探针）
- 里程碑：`v1.0.0-release`（全站 12 接口真实化，90/90 测试）
- 遗留切片（V1.1 未做项，用户已定排除）：书源 HTML 规则解析器、会员支付真实化、projects 审查记录+导出备份；风格库持久化已收官（2026-08-11，工单 14/15）

## Agent skills

### Issue tracker

Local markdown — tickets live at `.scratch/<feature-slug>/issues/NN-<slug>.md` (e.g. `.scratch/mozhou-mvp/`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at repo root; ADRs under `docs/adr/` (created lazily). See `docs/agents/domain.md`.

---

# 内核线增补：Wayfinder 追踪操作


## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical 5-role triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout at repo root (`CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **mozhou** (7826 symbols, 21170 relationships, 475 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
