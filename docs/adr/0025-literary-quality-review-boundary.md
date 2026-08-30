---
status: accepted
date: 2026-08-30
description: '文学质量审查边界：Continuity Gate 保持确定性正典权威，文学审查为独立前正典质量边界，产出版本绑定 QualityReviewReport，blocking 失败驱动显式回炉（每 session 最多 2 次），项目级质量策略不入正典'
tags:
  - mozhou
---

# 0025. 文学质量审查边界：独立于正典的前置质量门

- **状态**：Accepted（授权终审制，作者全稿签署）
- **日期**：2026-08-30
- **来源**：实施计划 [[2026-08-30-longform-quality-gates-integration]] · 配套规格：[[2026-08-29-longform-production-quality-cross-audit]]（spike）
- **前置**：ADR-0024（章节管线事务化编排）· ADR-0019（研究驱动修正：保护编辑/压缩/回执/KnowledgeState）

## Context

《长生者皆为薪柴》真实长篇生产验证出的文学质量能力（文学审查、规则覆盖、失败记忆、期待兑现、记忆锚、版本绑定）需要产品化，但必须在不削弱既有确定性边界的前提下并入 Novel OS 主线。核心张力：文学判断是 LLM 软判定，而 Continuity Gate 的裁决权、ChapterCommit 的不可变性、Canon 真相层的真伪折叠都是确定性硬边界——两者必须在结构上分离，而不是靠约定自律。

## Decision

1. **Continuity Gate 保持确定性与正典权威**：它继续只做确定性 Canon/Knowledge/Timeline/Dependency 核检；文学 LLM 判定不得进入 Canon 真伪判定，不得削弱既有 Gate 以迁就语义审查者。
2. **文学质量审查（Literary Quality Review）是独立的 pre-Canon 质量边界**：建成独立 `@mozhou/quality-engine`，不由 Gate、Kernel 或任何正典组件承载。
3. **既有管线步 id `review` 保留**：其契约从「装载 draft 供核检」扩展为「产出版本绑定的 QualityReviewReport」——报告锚定 `chapterIndex + draftRevision + draftContentHash + receiptId + ruleSetDigest + reviewerBinding`，任一正文变化使旧结果 stale。
4. **blocking 文学失败可驱动显式回炉**：`review_rework` 边从 `review` 回到 `draft`，由编排者基于显式报告调用，session 内不存在自动循环。
5. **自动回炉每 ChapterProductionSession 上限 2 次**：第 3 次失败即停止并交作者处置，不允许无限 agent loop。
6. **`apps/web + packages/*` 是 Novel OS 产品线**：`app/` 为遗留应用面，只接收迁移/安全/可靠性修复，不再新增 Story Kernel 或 quality-engine 能力。
7. **项目级文学策略不是 Canon**：`质量/quality-policy.yaml` 等作者质量配置不得存为 TemporalFact，不参与真伪折叠；平台默认规则与项目覆盖分层，题材专属规则不写死进 kernel。

## Consequences

- 正典真相层永远不含文学软判断；「机械真伪」与「文学好坏」在结构上分属两条接缝，后者失效或被绕过都不污染前者。
- PASS 的时效性由锚定哈希机械保证：拿旧 PASS 交付新正文在管线层被拒绝（fail closed），无需信任任何调用方自觉。
- 回炉次数上限把 LLM 自动重写的失控风险封顶为 2 次；作者始终保有最终编辑权与放弃权。
- `app/` 冻结为遗留面：用户数据可读性与迁移通道保留（不做破坏性删除），新能力只在 `apps/web + packages/*` 落地。
