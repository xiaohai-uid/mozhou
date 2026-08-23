---
date: 2026-08-23
description: 'ADR-0022：k-hop 图召回算子决策——POV 可见子图 strict 门禁、三类边恒开二跳、双硬上限、触发卡必入不免预算、三通道 raw 分 max 合并记胜出证据、duplicate≡identifier 撞车'
tags:
  - project-note
  - mozhou
---

# 0022. Deterministic K-Hop Graph Recall over the POV-Visible Temporal Canon Subgraph

> 相关笔记：[[khop-graph-recall-spec]] · [[token-budget-assembly-spec]] · [[context-receipt-physical-format-spec]] · [[ADR-0002 Temporal Canon and Candidate-to-Canon Fact Lifecycle]] · [[ADR-0011 Temporal Fact Compaction and Scene-Level POV Slicing]]

## Context

Ticket #7 settled the Context query API as structured deterministic operators with three-channel automatic activation: keyword fast channel (draft mention detection), Temporal Canon Graph k-hop expansion (`graph_khop`, "trigger source must enter the candidate set"), and embedding long-tail fallback (M5 dual-track). The k-hop operator itself was left as a graduated fog area pending two prerequisites — the frozen nine-entity schema (#4) and the receipt's typed activation evidence (#9 Q15/Q16). Both have landed, but four questions remained open: where graph edges come from and their weights; traversal depth and branching caps; the precise semantics of "trigger source must enter the candidate set"; and how graph-recalled entries merge scores with the keyword and embedding channels, including what `ExclusionReason.duplicate` actually means.

## Decision

1. **Entity-node graph, three edge types**: nodes are EntityRefs only; facts hang off their subject. Edges derive from RelationshipState endpoints (`rel`, interval-gated), fact subject→entity-value references (`fact_ref`, value must wholly match the EntityRef grammar, interval-gated), and TimelineEvent participant/location co-occurrence (`event`, permanent — history stays true; recency belongs to the rolling recap stream). Only `confirmed` facts build edges and candidates; `planned` is intent routed through the structural layer, never dressed up as canon.
2. **Strict POV-visible subgraph traversal**: knowledge-gated facts lose both candidacy and bridging qualification at a single gate before traversal (zero soft leakage via secret bridges); unreachable public material is the embedding channel's job — that is why the recall layer is dual-track.
3. **Constant two-hop expansion under hard caps**: no conditional depth — caps make receipts locally explainable ("edge rank made the cut"), where adaptive triggers would make them globally stateful. `branchCap` bounds per-entity per-hop width, `khopCap` bounds the channel globally; k is permanently capped at 2 (Novelcrafter's cascade-bloat warning).
4. **Trigger semantics = card always, neighborhood discounted**: the trigger entity's card enters unconditionally (the only capacity exemption); its own one-hop facts bypass relevance threshold and dedup but not branch cap, interval, status, POV gating, or budget competition. "Must enter the candidate set" ≠ "must enter the packet" — NAI's lesson avoided on both ends.
5. **Unified, channel-independent tier assignment** by content class × temporal state (cards → new `entity_card` tier added to #8's table as a controlled amendment; compacted facts → `distant_recall`; overdue promises promoted to `promise_due`). Events are bridges, never standalone candidates; promises are not graph-reachable by schema.
6. **Raw-score max merge, winning-channel evidence**: same-identifier hits converge to one candidate with `relevanceScore = max`, evidence recording the winning channel (Q15), ties broken by fixed channel priority. No cross-channel calibration layer — desirability compares tiers before scores. `duplicate` ≡ identifier collision after merge (defensive, normally zero), never "similar content".

## Consequences

- The recall layer can now emit #8's exact input contract (`candidates` with tier/channel/score, `excluded` pass-throughs) with zero implementation-time design decisions.
- Hub entities cannot explode the pool: candidate count is deterministically bounded by `|T| · (branchCap + branchCap²)` clamped to `khopCap`.
- Receipts answer "why did the AI see this fact about B" with `{sourceEntity: trigger root, hops, score}` — root attribution matches the Viewer-Key diagnostic purpose; mediating neighbors are inferable, not recorded.
- Strict gating trades a class of recall for a guarantee: nothing in the packet hints at a secret's existence through graph structure alone.
- Config (weights, caps, thresholds) participates in `configVersion` → `recomputationHash`; threshold values start from T9-calibrated defaults and are tunable without spec changes.

## Alternatives Rejected

- Conditional second hop (expand only when first-hop yield is thin) — global-state explanations poison receipt readability.
- Cross-channel score calibration — complexity with no consumer, since tierRank precedes score in desirability.
- Content-level dedup between cards and facts — undeterminable, violates the recomputability discipline; short-card redundancy accepted in v1.
- impactFactIds-derived bridge edges — `fact_ref` already covers key prop/person links bidirectionally; kept as a v2 extension point.
- Recency decay on event edges — an extra parameter duplicating the recap stream's job.
