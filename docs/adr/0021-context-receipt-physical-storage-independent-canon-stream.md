---
date: 2026-08-23
description: 'ADR-0021：Context Receipt 物理存储决策——独立 canon 流+指针事件、可复算=决定性+漂移检测、append-only 崩溃一致序、激活证据与输入摘要字段增补'
tags:
  - project-note
  - mozhou
---

# 0021. Context Receipt Physical Storage: Independent Canon Stream with Pointer Events

> 相关笔记：[[context-receipt-physical-format-spec]] · [[token-budget-assembly-spec]] · [[ADR-0007 Novel Runtime Event Architecture]] · [[kernel-schema-draft]]

## Context

ADR-0019 promoted the Context Receipt to a first-class product artifact and ADR-0007 defined a `ContextCompiled` event "carrying" it, but the physical relationship between the receipt stream and the EventLedger was left open: same record type or independent streams? Inline payload or pointer? The dual-plane model (ADR-0006) makes the answer load-bearing — only the canon plane carries the rebuild guarantee, while `.mozhou/events.jsonl` is the audit backbone consumed by Session Replay and Flywheel statistics. "Recomputable and diffable" (frozen into `recomputationHash`) also needed an exact meaning: whether auditability demands archiving full raw inputs per generation.

## Decision

1. **Independent canon stream + pointer events**: receipts append one-per-line to `{Book}/追踪/context-receipts.jsonl` alongside the five tracking streams (a frozen kernel entity belongs on the canon plane); `ContextCompiled` events carry only `{receiptId, taskType, chapterIndex, recomputationHash, totalTokens, storyTextQuota}`. Crash-consistency by write order: receipt line first, event line second — an interrupted pair leaves a legal orphaned receipt, never a dangling pointer.
2. **Recomputability = determinism + drift detection, not snapshot archival**: the receipt pins an `inputsDigest` over config/tokenizer/model versions plus structural/candidate/story-text digests; later re-verification either reproduces the identical `recomputationHash` (inputs un-drifted) or names the changed dependencies via DependencyManifest hashes. Full raw-input archival was rejected as linear-size duplication of manuscript text.
3. **Diff = entry-level alignment on `identifier`** across two receipts (inclusion transitions, token deltas, trim-type changes); enabled purely by canonical JSON serialization (sorted keys, compact separators) and the deterministic entry order guaranteed by the budget algorithm (#8).
4. **Schema additions** (purely additive): `ReceiptEntry.recallEvidence?: string` — compressed activation evidence (`key:`/`khop:`/`emb:`/`pin`), the NAI Context Viewer Key-column counterpart that completes the "Why AI saw this" loop; `ContextReceipt.inputsDigest: string` (required — no legacy data exists pre-implementation).
5. **Retention v1 = keep everything**, SQLite index for query; pruning deferred as a maintenance-pass extension point gated on commit-reference reachability.

## Consequences

- Authors can read receipt history in Git/Obsidian like any canon stream; the event ledger stays lean for replay and analytics.
- Audit answers are honest: recompute either succeeds bit-for-bit or fails loudly naming the drifted dependency — silent divergence is impossible.
- Two-file writes need the documented ordering discipline; validators must flag dangling pointers as errors.
- Ticket #7's recall layer must produce the evidence strings (`recallEvidence`) at activation time, since receipts record but do not reconstruct them.
