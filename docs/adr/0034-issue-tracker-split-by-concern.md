---
status: accepted
date: 2026-10-01
---

# 0034. Issue tracker 按关注点分工，ID 方案收敛为一套

两套执行跟踪后端都在生产使用且都有物证：本地 `.scratch/*/issues/` 有 74 个带 `status: ready-for-agent` 的 markdown，而 GitHub 侧有真实议题在流动（`docs/adr/0023` 引 `#31`、`docs/research/t32` 引 `#29`+`#32`）。`AGENTS.md` 曾在同一文件里给出相反的两条指令，而两段都指向 `docs/agents/issue-tracker.md`——该文件只背书 GitHub，其「本地 Markdown 模式」存档节是空的。

**裁决**：按关注点分工而非二选一。**执行状态**（开了哪些、归谁、被什么阻塞）唯一权威是 GitHub Issues；**规格与决策**（是什么）在本地 markdown。二者不是互为 fallback；冲突时 GitHub 就状态胜出，本地文档须更正。三套 ID 方案（本地 `NN-<slug>`、speckit `[ID] [P?]`、GitHub `#31`）收敛为 GitHub 一种，另两种转为只读历史。

## Consequences

- 74 个本地 markdown 的 `status` frontmatter 降级为**无权威的遗留字段**，规则上禁止新文档再写。迁移方案未定，见 `docs/adr/INDEX.md` 挂账项。
- 「造什么」的第二套权威（`specs/*/spec.md` 的 User Scenarios 与 `AGENTS.md` §1 的 User journeys）互相不引用；规范权威是 `AGENTS.md` §1。
