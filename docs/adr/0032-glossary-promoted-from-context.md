---
status: accepted
date: 2026-10-01
---

# 0032. CONTEXT.md 升格为 GLOSSARY.md，纪事迁出

`CONTEXT.md` 的 frontmatter 自己声明它是 `glossary`，含 50 个领域词条，每个都带规范化的 `_Avoid_` 反义词禁用行——它已经是术语表，只是文件名和分层是错的。同时它的第 271–307 行混着三段带日期的决策纪事（2026-08-30 文学质量门冻结 / 2026-09-20 遗留 `app/` 移出 / 2026-09-30 评测子系统接线），按 DSH 文档分层，纪事属于 decision / postmortem 层，不属于术语层。

**裁决**：`CONTEXT.md` 更名为 `GLOSSARY.md`，成为术语唯一权威，并把三段纪事中的**新词**（QualityReviewReport、QualityPolicy、FailurePattern、ReaderExperienceDelta、路由建议确认、路由变更）并入 Part 1；纪事**本体**归 `docs/adr/`（分别由 0025、0023、0008 承接）。同时新增 Part 2「用词消歧登记」，收编六个曾有一词多义的通用词：工单/ticket/issue、门禁/闸门/gate、切片/slice、任务、契约、工作台。

## Consequences

- 25 个跟踪文件中的 56 处 `CONTEXT.md` 引用改写为 `GLOSSARY.md`。
- 每个词条现在带**规范中文名**——这直接消灭了三个空洞：`收据`、`候选事实`、`熔核` 此前在全仓 markdown 中命中数均为 0，即「英文定义了、中文从不用」。
- 新建 `GLOSSARY.md` 会制造第 8 个术语家，因此本决策明确**不做**新建，只做升格。
