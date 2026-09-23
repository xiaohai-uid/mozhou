---
date: 2026-08-23
description: 'ADR-0021：Context Receipt 物理存储定案——.mozhou/receipts/ 一证一文件 + EventLedger 指针事件、可复算=归档最小重放输入面、typed activation、崩溃一致序'
tags:
  - project-note
  - mozhou
---

# 0021. Context Receipt Physical Storage: Receipt Files with Pointer Events

> 相关笔记：[[context-receipt-physical-format-spec]] · [[token-budget-assembly-spec]] · [[ADR-0007 Novel Runtime Event Architecture]] · [[ADR-0019 Research-Driven Amendments]] · [[kernel-schema-draft]]

## Context

ADR-0019 promoted the Context Receipt to a first-class product artifact and ADR-0007 loosely said the `ContextCompiled` event is "carrying" it, leaving three questions open: physical storage form, the receipt↔EventLedger relationship (same record type or independent streams?), and what "recomputable and diffable" operationally means. ADR-0020 supplied the stage vocabulary and the `recomputationHash` formula this decision builds on.

Two candidate homes were weighed for receipts: a sixth canon stream under `追踪/`, versus the runtime zone already reserved by the frozen book tree v2 (`docs/specs/dual-plane-sync-spec.md`: `.mozhou/receipts/`, 审计产物). The canon-stream option was rejected: `追踪/*.jsonl` carries row-level EXTERNAL_MODIFIED reconciliation semantics (an externally added line is *accepted as new canonical state*) — reconciliation machinery applied to immutable evidence is absurd, and moving receipts would silently amend a frozen decision. Two recomputability designs were also weighed: digest-only anchoring versus archiving a minimal replay surface. Digest-only loses: relevance scores are recall-time products, not entity properties — once the embedding index drifts, the desirability order is unrecoverable and budget-phase replay becomes permanently impossible. Archiving scalars and digests (KB-scale) keeps replay possible any time.

## Decision

1. **One file per receipt under the frozen runtime zone**: `.mozhou/receipts/rcpt_<ULID>.json` — UTF-8, pretty-printed JSON with stable key order (human-openable, NAI Context Viewer positioning), immutable per I5; corrections append a new receipt under a new ULID, never rewrite history. Retention v1 = keep everything; pruning deferred behind Gate B load data.
2. **EventLedger holds pointers, not bodies**: `ContextCompiled` carries `{receiptId, taskType, chapterIndex?, recomputationHash, totalTokens, storyTextQuota, entryCount:{included,excluded}}`; `GenerationStarted` gains `receiptId` to close the compile→generation chain. The ledger stays lean for Session Replay and Flywheel scans; ADR-0007's "carrying" wording is hereby amended to reference semantics.
3. **Crash-consistency ordering**: append the receipt file first, then the event line. An interrupted pair leaves a legal orphaned receipt; a dangling pointer is illegal and validators must flag it as an error.
4. **Recomputability = archived minimal replay surface**: every receipt embeds `replayInputs` — versions (`configVersion/tokenizerVersion/modelProfileId/contextWindowTokens/embeddingQueryDigest?`), competition candidates in final desirability order (id, tier, channel, relevanceScore, pinned, atomicOverride, contentDigest), structural section digests, story-text slice digests. Entity contents are never duplicated. Replay boundary = the four budget stages (`structural/reserve/converge/story_text`); `recall_filter` entries are #7 pass-through records outside the contract. `inputsDigest := sha256(canonicalJson(replayInputs))`.
5. **Typed activation evidence** completes NAI's Key column: `ReceiptEntry.activation?: ActivationEvidence` — a discriminated union (`keyword.keys / graph_khop{sourceEntity,hops,score} / embedding.score / manual_pin`), not a lexically-compressed string; misrecall diagnosis stays machine-queryable in house style.
6. **Failed assemblies produce no receipt**: `CompileConfigError / ConvergenceError / TokenizerUnavailable` are recorded as error events only; `parseFailures` continues to mean parse failures inside a successful assembly.

Schema additions are purely additive and recorded as Q15/Q16 in `docs/specs/kernel-schema-decisions.md`; full pseudocode-level detail lives in [context-receipt-physical-format-spec](../specs/context-receipt-physical-format-spec.md).

## Consequences

- Authors open one readable JSON file per generation ("why did the AI see this"); `.mozhou/` exclusion from reconciliation keeps receipts tamper-evident — hand-editing breaks `recomputationHash`, it never triggers a merge proposal.
- Budget-phase replay succeeds bit-for-bit at any later time, or fails loudly naming the drifted/mutated dependency via per-candidate digests — silent divergence is structurally impossible.
- Ticket #7 must emit `activation` evidence at activation time and pass candidates through to `replayInputs`; receipts record, they do not reconstruct.
- Receipt files join snapshots automatically (whole-book directory copies); SQLite projection indexes remain disposable, rebuilt by scanning `receipts/`.

## Rejected Alternatives

| Alternative | Verdict | Reason |
|---|---|---|
| Inline receipt body in `ContextCompiled` | No | 10–50 KB per event bloats the audit backbone; duplicate store drifts |
| Sixth canon stream `追踪/context-receipts.jsonl` | No | Row-level reconciliation semantics are meaningless for evidence; amends frozen tree v2 without an amendment |
| Digest-only anchoring without replay surface | No | Scores unrecoverable after index drift ⇒ replay permanently impossible |
| Full raw-input archival | No | Linear-size duplication of manuscript prose |
