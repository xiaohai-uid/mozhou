# 墨舟 (MoZhou) — AI 小说写作平台

Repo-level agent instructions. Global user instructions live at `C:\zcode\AGENTS.md` (symlinked from `~/.zcode/AGENTS.md`) — this file only adds project-scoped conventions.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/` (spec at `spec.md`, one file per ticket at `issues/NN-<slug>.md`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to their names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root (grill-with-docs output, 23 decisions), ADRs at `docs/adr/` when they exist. See `docs/agents/domain.md`.

## 开发禁锢规约（《全局开发规范 v1.0.0》第五节）

> 生效：2026-08-09。核心哲学：UI 先行 (UI-First) · 契约驱动 (Contract-Driven) · 物理隔离 (Surgical Isolation) · 渐进演进 (Incremental MVP)。契约全集见 `.scratch/mozhou-mvp/contracts/api-contract.md`。

1. **契约死规则**：未在当前 UI 界面展示的 API 接口与字段，严肃禁止在后端编写占位逻辑。
2. **范围锁死**：现阶段只允许修改【写作对话】与【认证】相关代码，其余 11 个界面代码处于只读冷冻状态。
3. **拒绝重构**：排错时仅修改报错对应的具体函数。严禁顺手优化未报错的 Rust Core / Go 架构。
4. **工单限制**：每次回答仅允许执行 1 个工单，改动文件不得超过 3 个。单工单完成后触发审查并提交 Git。
5. **拒绝谄媚**：严禁建议合并工单回顾。遇到不明确架构，触发 /grill-me 向人类发起追问。
