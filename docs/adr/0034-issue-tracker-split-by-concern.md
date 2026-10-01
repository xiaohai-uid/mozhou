---
status: accepted
date: 2026-10-01
---

# 0034. Issue tracker 按关注点分工，ID 方案收敛为一套

两套执行跟踪后端都在生产使用且都有物证：本地 `.scratch/*/issues/` 共 74 个 markdown（仅 32 个进 git），其中**只有 9 个**带 `status` frontmatter 且全部集中在 `mozhou-deepening-20260928` 一个批次；而 GitHub 侧有真实议题在流动（`docs/adr/0023` 引 `#31`、`docs/research/t32` 引 `#29`+`#32`）。`AGENTS.md` 曾在同一文件里给出相反的两条指令，而两段都指向 `docs/agents/issue-tracker.md`——该文件只背书 GitHub，其「本地 Markdown 模式」存档节是空的。

**裁决**：按关注点分工而非二选一。**执行状态**（开了哪些、归谁、被什么阻塞）唯一权威是 GitHub Issues；**规格与决策**（是什么）在本地 markdown。二者不是互为 fallback；冲突时 GitHub 就状态胜出，本地文档须更正。三套 ID 方案（本地 `NN-<slug>`、speckit `[ID] [P?]`、GitHub `#31`）收敛为 GitHub 一种，另两种转为只读历史。

## Consequences

- **实测纠正**：本 ADR 初稿称「74 个本地 markdown 带 status」，那是未核实的推断。实际 **9 / 74**，且全部来自 `mozhou-deepening-20260928` 单一批次。处置改为：把 `.scratch/mozhou-deepening-20260928/issues/` 整体标为**冻结历史批次**，其 `status` 字段无权威、不迁移、不再更新；规则上禁止任何新本地规格文档再写 `status`。无需逐文件迁移。
- 「造什么」的第二套权威（`specs/*/spec.md` 的 User Scenarios 与 `AGENTS.md` §1 的 User journeys）互相不引用；规范权威是 `AGENTS.md` §1。
