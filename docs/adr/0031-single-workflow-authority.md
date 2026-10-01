---
status: accepted
date: 2026-10-01
---

# 0031. 六条工作流线收敛为一条，AGENTS.md 补优先级规则

本仓同时存在六条 AI 代理工作流线：mattpocock/skills、应用线 UVSD、内核线 Wayfinder、spec-kit/speckit、superpowers、DSH `.dwf.ts`。2026-09 的两线合并（`docs/research/t30-d-upstream-convergence.md:43`）把它们**拼接**进了 `AGENTS.md`，两段 `## Agent skills` 块在 Issue tracker / Triage labels / Domain docs 三处互相矛盾，且没有任何优先级规则。

**裁决**：mattpocock/skills 是唯一的流程权威，住在 `docs/agents/` + `AGENTS.md`。UVSD 与 Wayfinder 并入它，分别成为 `AGENTS.md` §1–§8（能不能做）与 §9（记在哪），冲突时 **§1–§8 的范围纪律优先**。spec-kit 降级为产物目录、superpowers 降级为历史层、`.dwf.ts` 降级为任务级脚本——三者保留文件，但不再产生新约束。

## Consequences

- `AGENTS.md` 缩短为一个自洽文件，两个矛盾块合并为一节，并在 §0 写明六条线的裁决状态。
- `.agents/skills/` 成为唯一 skill 目录（Codex / OpenCode / Pi 均扫描该路径）。`.claude/skills/` 与 `.zcode/skills/` 中的 16 个副本是 SHA-256 完全相同的重复件，删除前需先确认 `.specify/integrations/*.manifest.json` 的重生成路径。
- 「术语」与「流程」就此分家：`GLOSSARY.md` 管术语，`AGENTS.md` 管流程，两者互不定义对方的词。
