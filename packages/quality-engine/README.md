# @mozhou/quality-engine

正典（canon）**之前**的文学质量审查边界。**零依赖**。

## Owns

- 确定性机械门 + LLM 旁路建议（`src/deterministic.ts`、`src/mechanical-gates.ts`）。
- 质量规则集、审查报告与锚点（`QualityPolicy`、`QualityRuleDefinition`、`QualityReviewReport`、`QualityReviewAnchor`、`ReviewerBinding`）。
- 失败模式（`FailurePattern`）与去 AI 味引擎（`src/de-ai-engine.ts`）。

> 边界见 [ADR-0025](../adr/0025-literary-quality-review-boundary.md)：文学判定**不得**进入正典真伪裁决。

## Depends on

（无。）

## Extension points

- `defaultPlatformRules` / 规则集：平台默认规则 + 项目覆盖（`QualityPolicy.maxAutomaticReworks` 恒为 2）。
- `ReviewerBinding`：审查者绑定，决定 LLM 旁路用哪个模型。

本包共 78 个具名导出（2026-10-10 实测：`src/index.ts` 里 `export {…}` / `export type {…}` 标识符去重计数），其中约一半是规则与报告的类型/结构。

## Known limitations

- 审查报告是**值**（落 `.mozhou/quality-reviews/`），**不是正典**。把文学判定写进 `TemporalFact` 是本包的边界错误。
- 正文一变，报告锚点即失效（fail closed）。这是设计意图，不是缺陷——但意味着报告不能跨版本复用。
