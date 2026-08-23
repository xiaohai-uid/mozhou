# MoZhou Novel OS 2.0: Phasing, Benchmark & Hard Anti-Rework Gates

## 1. Engineering Roadmap (Phase 0 - Phase 7)

```mermaid
gantt
    title MoZhou Novel OS 2.0 Engineering Execution Plan
    dateFormat  YYYY-MM-DD
    section Core Foundations
    Phase 0: Domain & Schema Freeze       :done, p0, 2026-08-23, 1d
    Phase 1: Story Kernel & Dual Plane   :active, p1, after p0, 3d
    Phase 2: Context Compiler & Receipts :p2, after p1, 3d
    section Continuity & Flywheel
    Phase 3: Chapter Transaction Engine  :p3, after p2, 3d
    Phase 4: Data Flywheel V1 (Local)    :p4, after p3, 3d
    Phase 5: Change Impact Engine        :p5, after p4, 3d
    section UX & Market Brain
    Phase 6: Dual Persona UI (Novice/Pro):p6, after p5, 4d
    Phase 7: Market Brain & Benchmark    :p7, after p6, 3d
```

### Phase Breakdown

- **Phase 0 — Domain Freeze**: Complete formal definitions of `CONTEXT.md`, ADRs (`0001` - `0018`), and core schemas.
- **Phase 1 — Story Kernel & Local Data Plane**: Implement the 9 Core Domain entities in TypeScript/Node with SQLite projection indexing and bidirectional Markdown/JSONL synchronization.
- **Phase 2 — Context Compiler & Receipts**: Build the deterministic query, filtering, token budgeting, and Context Receipt generation pipeline.
- **Phase 3 — Chapter Transaction Pipeline**: Implement the 10-step chapter production lifecycle (Prepare → Compile → Draft → Review → User Edit → Final Extract → Continuity Gate → Canon Proposal → Commit → Flywheel Record).
- **Phase 4 — Data Flywheel V1**: Build the local `EventLedger`, `AuthorPreferenceLearner`, `StyleLearner`, and `TaskModelEvaluator`.
- **Phase 5 — Change Impact Engine**: Implement `DependencyManifest` indexing, graph traversal, and LLM-assisted secondary impact analysis for retroactive revisions.
- **Phase 6 — Persona UI Integration**: Implement Novice Wizard (frictionless guided flow) and Pro Studio (deep control room with Story Brain, Context Viewer, and Change Matrix).
- **Phase 7 — Market Brain & Capability Integration**: Integrate mainstream fiction platform rank ingestion (Fanqie, Qidian, Jinjiang, Qimao, Zongheng, Zhihu Yanxuan) into structured `MarketBrief` providers.

---

## 2. Long Novel Benchmark (50-Chapter Synthetic Test Suite)

To ensure mechanical rigor and eliminate regressions, MoZhou 2.0 will be validated against a standardized 50-chapter continuous novel scenario:

```
[Ch. 01-05] Setup & Author Intent: Introduce core conflict, protagonist drive, and plant Promise P-001 (Secret Master Token).
[Ch. 18] Spatial Transition: Move protagonist from Starting Village to Capital City.
[Ch. 23] Physical State Change: Protagonist breaks left arm in battle (valid_from: 23, valid_until: 39).
[Ch. 27] Asymmetric Knowledge: Reader learns the Emperor is dead; Protagonist remains unaware until Ch. 45.
[Ch. 31] Relational Mutation: Ally NPC-005 betrays party, transitioning from Mutual Trust to Hostile.
[Ch. 35] World Rule Mutation: Author refactors Magic System Rule R-008 (Spell consumption doubled in dead zones).
[Ch. 40] Retroactive Outline Edit: Author modifies Chapter 12 outline beat.
[Ch. 45] Promise Payoff & Knowledge Sync: Protagonist discovers Master Token secret and Emperor's death.
```

### Quantitative Benchmark Metrics

| Metric | Target | Description |
| :--- | :--- | :--- |
| `CANON_ACCURACY` | **$\ge 99.0\%$** | Zero contradiction with confirmed temporal facts (`valid_from` / `valid_until`). |
| `KNOWLEDGE_LEAK_RATE` | **$0.0\%$** | Zero instances of characters acting on unlearned secrets. |
| `PROMISE_RECALL` | **$100\%$** | All active promises due at chapter $N$ are surfaced in context. |
| `CHANGE_IMPACT_RECALL`| **$100\%$** | 100% of chapters reading modified entities are flagged as stale. |
| `CONTEXT_BUDGET_OVERFLOW`| **$0.0\%$** | Zero prompts exceeding specified token allocation. |
| `RECOVERY_SUCCESS` | **$100\%$** | SQLite database fully reconstructed from canon Markdown/JSONL files with zero loss. |

---

## 3. Mandatory Anti-Rework Gates (Root-Cause Shield)

Directly addressing the failure modes identified in historical project iterations (Obsidian logs 2026-08-11 to 2026-08-21):

### Gate A: Requirement Fidelity Gate
1. **Verbatim Traceability**: User preferences and reference standards (OpenWrite, jarvis-write, 天命) must be frozen into exact behavioral specifications before coding.
2. **Explicit Negative Constraints**: Every capability must define what it `must_not` do (e.g., no raw prose upload, no multi-agent panel for drafting, no pirate scraper ingestion).

### Gate B: Real Stability Gate
1. **Real Provider Smoke**: Mock tests passing in CI is only a prerequisite; no phase is closed without live provider payload verification (complete prompt inspection, SSE roundtrip, token latency accounting).
2. **Reload & Recovery Invariance**: Page refresh, app reload, and error retries must preserve 100% of uncommitted edits and canon states.
3. **Three Consecutive Clean Runs**: The core golden journey (create novel → clarify intent → draft chapter → review & edit → commit canon → reload) must pass 3 consecutive runs with 0 regression.
