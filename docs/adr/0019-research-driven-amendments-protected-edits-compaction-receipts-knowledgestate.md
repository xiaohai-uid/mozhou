# 0019. Research-Driven Amendments: Protected Edits, LLM-Only Compaction, First-Class Receipts, KnowledgeState Schema

## Context

The two-volume reference retrospective (`docs/research/reference-retrospective-20260823.md`, `docs/research/reference-retrospective-vol2-20260823.md`; 13 sources, Gate A freeze list M1-M20/N1-N12) surfaced four places where frozen decisions need strengthening before Phase 1+2 implementation. None reverses a prior decision; all four tighten or extend one. Recording them as one amendment ADR keeps the audit trail single-sourced while leaving ADRs 0002/0004/0010/0011 untouched.

## Decision

Four amendments, each traceable to evidence in the retrospective:

1. **Amends ADR-0002 (Temporal Canon Graph)**: `KnowledgeState` ("who knows what, since when") is promoted to a **first-class schema entity**, not a prompt fragment or derived view. Canon injection gains **dual-channel recall**: deterministic graph/canon queries remain authoritative, with a local embedding channel as coverage fallback (vol2 §D.2-D.3; jarvis-write's advisory-only failure mode is the counterexample).
2. **Amends ADR-0004 (Context Compiler)**: the **Context Receipt is a first-class product artifact** — recomputable and diffable per generation, recording inclusion/exclusion reason, insertion order, reserved tokens, and every parse failure per reference (precedent: NovelAI's Context Viewer stages with Inclusion/Reason fields; counterexample: NovelForge's stub `budget_stats`). Assembly happens **server-side only** (NovelForge client-side assembly = zero auditability is an anti-pattern). A **reserved story-text quota** guarantees prose cannot be displaced by lore/context entries (NAI's documented "cancel out story text" hazard).
3. **Amends ADR-0011 (Compaction & POV Slicing)**: keyword-extraction compression is **banned** for long-range memory (openwrite's rule-engine compressor loses causality at scale); long-range compaction uses LLM summarization exclusively.
4. **Amends ADR-0010 (External Edit Reconciliation)**: reconciliation adopts **protectedUserContent + stale propagation**: content authored by the human carries a protection flag; upstream recomputation may only mark downstream artifacts **stale**, never clear or overwrite author text (ANWA issue #80/#90 lineage; DSH projection-rebuild precedent).

Additionally, the Gate A behavioral freeze list (**MUST M1-M20 / MUST NOT N1-N12**, vol2 终章) is **normative** for all implementation tickets derived from this repository's specs.

## Consequences

- Kernel schemas (Phase 1) must reserve fields for knowledge-state rows, receipt linkage, protection flags, and staleness markers — this is binding input to the field-level schema freeze.
- The Context Compiler (Phase 2) inherits receipt-as-artifact, server-side assembly, and quota rules as acceptance criteria, not aspirations.
- Future effect claims must cite a benchmark gate ID (N8); lint bans on silent-failure patterns (N9) enter the engineering scaffold ticket.
