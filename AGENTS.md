# 墨舟 (MoZhou) — AI 小说写作平台

Repo-level agent instructions. Global user instructions live at `C:\zcode\AGENTS.md` (symlinked from `~/.zcode/AGENTS.md`) — this file only adds project-scoped conventions.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/` (spec at `spec.md`, one file per ticket at `issues/NN-<slug>.md`). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label strings equal to their names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root (grill-with-docs output, 23 decisions), ADRs at `docs/adr/` when they exist. See `docs/agents/domain.md`.
