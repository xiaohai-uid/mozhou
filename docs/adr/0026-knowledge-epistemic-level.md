---
status: accepted
date: 2026-08-30
description: 'KnowledgeState 认知层级：knows/suspects/believes 三级语义，knows 独占确定性秘密授权，suspects/believes 走限定呈现通道，存量行读路径一次性迁移 knows'
tags:
  - mozhou
---

# 0026. KnowledgeState 认知层级：知情 ≠ 怀疑 ≠ 信念

- **状态**：Accepted（授权终审制，作者全稿签署）
- **日期**：2026-08-30
- **来源**：实施计划 [[2026-08-30-longform-quality-gates-integration]] Task 7
- **前置**：ADR-0025（文学质量审查边界）· ADR-0019（KnowledgeState 修正）

## Context

KnowledgeState 此前只有「知情/不知情」二元语义：一行在手即授权该持有者对秘密事实的确定性陈述。真实长篇生产中大量叙事张力来自「怀疑但未证实」与「深信但信错了」——二元模型要么迫使作者提前披露秘密（破坏 POV 零泄漏），要么无法把怀疑/误解写进上下文，LLM 只能凭空猜。

## Decision

1. **三级认知层级** `EpistemicLevel = knows | suspects | believes` 入 KnowledgeState schema，新构造必须显式声明。
2. **knows 独占确定性秘密授权**：`queryActiveFacts` 与 Gate 的 reader 披露分支只认 `level='knows'` 的认知行；suspects/believes 不授权 definitive 秘密陈述（Gate 仍报 `no authorizing knowledge row`）。
3. **suspects 走限定呈现通道**：上下文装配只许以「`CHARACTER SUSPECTS: <命题>; do not narrate or act as confirmed knowledge.`」语义呈现；`queryKnowledgePerspective` 为唯一机械出口。
4. **believes 呈现信念而非真相**：持有者带 `distortion` 时呈现畸变版本；真相不可经该通道泄露。
5. **迁移规则**：ADR-0026 之前的存量行（无 level 字段）在解析边界一次性折算为 `knows`（`MIGRATED_DEFAULT_LEVEL`，历史行语义即确认知情）；在场值必须 ∈ 词表，非法值宁败不猜。schema 升版后此缺省移除，不静默兜底。

## Consequences

- POV 零泄漏门禁保持确定性（Gate 纯机械不被削弱）：层级判定是 schema 字段比较，不是 LLM 判断。
- 「怀疑/信念」进入上下文是有界结构段通道（与 Task 6 同法），受既有预算会计约束。
- 存量书目零迁移成本（读路径折算）；新写入严格——两级纪律以 parser 为唯一边界。
