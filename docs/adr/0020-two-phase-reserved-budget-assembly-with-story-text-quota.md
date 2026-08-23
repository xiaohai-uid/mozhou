---
date: 2026-08-23
description: 'ADR-0020：Token 预算两阶段 Reserved 装配决策——三层预扣、复合 desirability 全序、前缀预订、原子只免截断不免淘汰、正文保底池硬顶'
tags:
  - project-note
  - mozhou
---

# 0020. Two-Phase Reserved Token Budget Assembly with Story-Text Quota

> 相关笔记：[[token-budget-assembly-spec]] · [[ADR-0004 Context Compiler and Receipts]] · [[ADR-0019 Research-Driven Amendments]] · [[kernel-schema-draft]]

## Context

The Context Compiler (ADR-0004) needs a concrete, deterministic budgeting algorithm. The two-volume reference retrospective surfaced NovelAI's two-phase Reserved allocation as the only battle-tested lorebook budget mechanism (reserve tokens in descending Insertion Order first, then place), alongside three of its documented hazards: hand-tuned single-scalar priority that does not survive million-character libraries (retrospective vol2 §D.2③), atomic entries whose interaction with eviction is undefined, and the officially acknowledged "lorebook can cancel out story text" failure — settings entries starving prose of context because no quota protects it. The frozen kernel schema (`kernel-schema.draft.ts` §8) already reserves the receipt surface this algorithm must populate: `AssemblyChannel`, `ExclusionReason` (including `story_text_quota_protected`), `ReceiptEntry.trimType`, and `storyTextQuota`. Deterministic recomputation (`recomputationHash`) is a frozen requirement, so every ordering and accounting rule below must be a pure function.

## Decision

Assembly is **three-layer pre-deduction → final-form materialization → sequential prefix reservation → place-and-converge** (pseudocode-level spec: `docs/specs/token-budget-assembly-spec.md`).

1. **Three-layer pre-deduction**: output reserve `R_out = max(1024, ⌈15%×W⌉)`, structural layer (Author Intent / task frame / style profile), and a per-task story-text quota floor `S_floor` are all deducted before any competition; what remains is a competitive pool `B_pool` with a **hard ceiling** for setting-like entries.
2. **Composite desirability order** replaces NAI's hand-tuned Insertion Order: `pinned DESC > tierRank ASC > relevanceScore DESC > identifier(ULID) ASC`. Tiers follow the ADR-0004 trim hierarchy (active facts / due promises > world rules > rolling recaps > distant recall); relevance scores come from the dual-channel recall (#7). The tie-break on ULIDs makes the total order deterministic with zero extra state.
3. **Sequential prefix reservation** (NAI port): candidates are finalized (trimmed to tier caps, head-kept; token-counted by the server-side exact tokenizer) *before* reservation, then reserved strictly in desirability order until the pool is exhausted; the walk stops at the first overflow. Inclusion therefore equals a prefix of the order (**prefix completeness**) — skip-ahead filling was rejected because it breaks monotone receipt reasoning.
4. **Atomic means anti-truncation, not anti-eviction**: an atomic entry enters whole or is evicted whole, but is still evictable by the same order; otherwise an oversized atomic set makes the budget unsolvable. Defaults: facts and due promises atomic; rules/recaps/distant recall truncatable (head-kept) via per-tier caps with per-entry override.
5. **Story-text quota as pool ceiling, not refund machinery**: settings can never spend `S_floor`; prose may expand into unused pool slack up to `B_total` but never displaces reserved entries. No compensation round re-admits evicted settings in v1 (optimization, not correctness; revisit with load-test data).
6. **Exact-tokenizer authority**: budget accounting uses server-side exact tokenizer counts only (cached per entity, invalidated by tokenizer version); estimators are confined to recall ranking (NovelForge's stubbed `budget_stats` is the recorded counterexample).
7. **Place-and-converge**: fixed section layout v1 (NAI key-relative insertion deferred; entries carry an optional ignored `anchorRef` extension point); overflow from cache drift triggers a bounded convergence loop that shrinks or evicts in ascending desirability, failing loudly rather than silently trimming prose.

Exclusion reason codes are decided at exactly one point: an entry that fits under the quota-free budget but not the pool records `story_text_quota_protected`; otherwise `budget_exhausted`.

## Consequences

- Receipts become monotonically explainable: inclusion implies all more-desirable entries were included, so receipt diffs localize regressions to a single order position.
- The NAI "cancel out story text" failure class is structurally impossible while the structural layer stays within its cap; violations raise `CompileConfigError` instead of degrading silently.
- Token budgets are reproducible bit-for-bit across reruns, satisfying `recomputationHash`; tokenizer changes are visible as mass hash churn rather than silent drift.
- Ticket #7 must return exclusion metadata (reason-coded filtered candidates) alongside candidates so one receipt covers the full funnel; ticket #9 inherits the stage vocabulary (`recall_filter`/`structural`/`reserve`/`converge`/`story_text`) but owns physical storage and the EventLedger relationship.
