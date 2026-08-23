# Specification: MoZhou Novel OS 2.0 (小说操作系统 + 数据飞轮)

## Problem Statement

Authors attempting to produce commercial long-form novels (500k to 1M+ words) using current AI tools face severe failure modes:
1. **Context Amnesia & Hallucination**: Beyond 30 chapters, AI forgets past character injuries, leaks secret information characters shouldn't know, and misplaces narrative promises and items.
2. **Cascading State Corruption**: Modifying an early world rule or character setup silently invalidates dozens of downstream chapters without tracking or notice.
3. **Black-box Fragility & High Costs**: Naive multi-agent swarms burn massive token budgets without transactional guarantees, while mock-heavy implementations break when connecting to real models.
4. **Zero Continuous Adaptation**: AI generation does not learn the author's nuanced prose rhythm or implicit stylistic preferences, requiring repetitive manual prompt tweaking.

## Solution

MoZhou Novel OS 2.0 transitions from a naive "AI text generator" to an **industrial novel production operating system**:
1. **Story Kernel**: Manages 9 core domain entities (Author Intent, Outline Graph, Temporal Facts with validity intervals, Asymmetric Knowledge States, Narrative Promises, Relationship States, Timeline Events, Scenario Style Profiles, and Chapter Commits).
2. **Context Compiler & Receipts**: Dynamically queries active facts within token budgets and generates user-verifiable Context Receipts detailing exactly what the AI saw.
3. **Deterministic-First Change Impact Engine**: Emits an immutable `DependencyManifest` on every commit, enabling instant mathematical dependency tracking and targeted LLM impact analysis when canon changes.
4. **Three-Tier Policy Flywheel**: Learns author preferences locally from edit deltas (P0 manuscript text stays 100% private), benchmark-tests capability recipe versions, and ingests legitimate mainstream fiction platform trends (Fanqie, Qidian, Jinjiang, Qimao, Zongheng, Zhihu Yanxuan).
5. **Dual-Plane Local Data Storage**: Markdown/JSONL files act as the human-readable source of truth; an append-only Event Ledger and SQLite projection provide high-performance indexing with 100% rebuildability.
6. **Hard Anti-Rework Gates**: Enforces Requirement Fidelity (verbatim traceability) and Real Stability (live model smoke, reload invariance, 3x consecutive clean runs).

---

## User Stories

### 1. Author Intent & Constitutional Setup
1. As an author, I want to define my novel's `AuthorIntent` (core satisfying points, protagonist core drive, absolute taboos, target ending), so that the AI never generates narrative arcs that violate my fundamental story principles.
2. As an author, I want to declare explicit taboos (e.g., "no arbitrary cultivation resets", "no green-hat betrayal"), so that the Continuity Gate rejects candidate drafts containing these violations.

### 2. Outline & Structural Planning
3. As an author, I want a hierarchical `OutlineGraph` (Book → Volume → Arc → Chapter → Scene/Beat) with dependency links, so that I can structure multi-volume narrative pacing.
4. As an author, I want to edit an outline node in Chapter 12 at Chapter 40, so that the Change Impact Engine detects downstream chapters affected by the change without silently regenerating them.

### 3. Temporal Facts & Knowledge Boundary Control
5. As an author, I want temporal facts bounded by chapter intervals (`valid_from` to `valid_until`), so that temporary states (e.g., "Lin Xuan left arm broken from Ch. 23 to Ch. 39") are only injected when writing relevant chapters.
6. As an author, I want to track `KnowledgeState` across Reader, Protagonist, and Antagonist separately, so that characters in Chapter 30 do not act on secret truths only the reader knows.
7. As an author, I want Scene-level POV knowledge scoping, so that multi-perspective chapters isolate what the POV character observes from what the antagonist is scheming.
8. As an author, I want expired micro-facts to be compacted into volume-level summaries upon volume completion, so that my context window is never choked by obsolete minor details.

### 4. Narrative Promise & Foreshadowing Lifecycle
9. As an author, I want to track `NarrativePromise` items (foreshadowing, character vows, countdowns, debts) through a strict lifecycle (`introduced` → `reinforced` → `due` → `paid_off` | `abandoned`), so that I never leave forgotten plot threads.
10. As an author, I want the Context Compiler to prioritize active promises approaching their due chapter, so that the AI organically weaves payoffs into the current draft.

### 5. Context Compilation & Transparent Explainability
11. As an author, I want the Context Compiler to enforce hard token budgets across prioritized sections, so that I never encounter context truncation or unexpected API token blowouts.
12. As an author, I want to click "View Context Receipt" on any generated draft, so that I can inspect the exact token breakdown, included facts, and excluded items that informed the model.

### 6. Chapter Production & Transactional Commit
13. As an author, I want drafting to default to single-stream generation, so that generation is fast, responsive, and cost-effective under BYOK.
14. As an author, I want paragraph-level multi-candidate branching on demand, so that I can explore alternative narrative expressions for critical moments.
15. As an author, I want the Continuity Gate to flag hard canon conflicts before commit, so that accidental contradictions are caught immediately.
16. As an author, I want to confirm intentional plot twists through guided fact mutation, so that the temporal state machine automatically updates its validity bounds without breaking graph consistency.
17. As an author, I want finalized chapters to commit as atomic `ChapterCommit` packets (prose, extracted deltas, dependency manifest), so that story state is committed reliably in a single transaction.

### 7. Dual-Plane Local Storage & External Reconciliation
18. As an author, I want my manuscript and settings stored as clean Markdown and JSONL files on my local disk, so that I can read, backup, and version control my novel in Git or Obsidian.
19. As an author, I want to edit chapter files in VS Code or Obsidian while MoZhou is closed, so that MoZhou detects the hash difference on launch, treats it as an `EXTERNAL_MODIFIED` proposal, and safely reconciles the facts into SQLite.
20. As an author, I want SQLite to be completely disposable and rebuildable from the raw Markdown/JSONL files, so that I never risk catastrophic data loss from database corruption.

### 8. Three-Tier Policy Flywheel & Privacy
21. As an author, I want my full manuscript prose (P0) to remain strictly on my local machine at all times, so that my creative copyright and privacy are 100% protected.
22. As an author, I want the local Tier 1 Author Flywheel to learn my stylistic preferences from my manual text edits (Edit Deltas), so that subsequent AI generations automatically match my rhythm and word choices without manual prompt tweaking.
23. As an author, I want scenario-classified style profiles (`action`, `dialogue`, `romance`, `exposition`) with EMA smoothing, so that intense battle scene edits do not distort the style of quiet emotional dialogue.
24. As an author, I want the Tier 2 Engineering Flywheel to measure recipe acceptance rates and edit ratios, so that upgrades to prompt skills (e.g., `story-deslop v1.4`) are mathematically proven superior.
25. As an author, I want the Tier 3 Market Flywheel to scan official mainstream fiction platforms (Fanqie, Qidian, Jinjiang, Qimao, Zongheng, Zhihu Yanxuan) during book inception and volume planning, so that I receive actionable commercial insights on pacing and tropes without distraction during daily writing.

### 9. Hard Anti-Rework Gates & Benchmark Verification
26. As an engineer/author, I want a 50-chapter synthetic Long Novel Benchmark, so that the entire state machine, dependency traversal, and knowledge isolation are mechanically validated.
27. As an engineer/author, I want Phase 1 to be gated by Requirement Fidelity and 3 consecutive clean Real Provider Smoke runs, so that the project never regresses or enters a rework loop.

---

## Implementation Decisions

### 1. Architectural Seams & Testing Boundaries
All capabilities and runtime flows interact through **Four Unified Seams**:
1. **`StoryKernelService` (Domain Seam)**:
   - Methods: `createBook`, `updateAuthorIntent`, `mutateOutline`, `assertTemporalFact`, `queryActiveFacts(chapter, entityIds, pov)`, `registerPromise`, `updateKnowledgeState`, `commitChapter(chapterIndex, commitPacket)`, `reconcileExternalEdit(filePath, rawContent)`.
2. **`ContextCompiler` (Context Assembly Seam)**:
   - Methods: `compile(taskType, scope, tokenBudget, authorIntent, activeFacts, promises, styleProfile) -> { packet, receipt, manifest }`.
3. **`NovelRuntime` & `CapabilityRegistry` (Execution Seam)**:
   - Methods: `registerCapability(type, provider)`, `execute(taskType, payload) -> Result`, `publishEvent(event)`, `replaySession(sessionId) -> ExecutionTrace`.
4. **`LocalDataPlane` (Persistence & Sync Seam)**:
   - Methods: `writeCanonFile(path, content)`, `readCanonFile(path)`, `syncToProjection(sqliteDb)`, `rebuildProjectionFromCanon()`, `verifyHash(path)`.

### 2. Module Boundaries & Decoupling
- **`@mozhou/kernel`**: Pure TypeScript domain logic (entities, temporal graph, state machine, dependency manifest). Zero UI dependencies, zero direct network calls.
- **`@mozhou/context`**: Token budgeting, lorebook activation, AST/keyword extraction, context receipt assembly.
- **`@mozhou/runtime`**: Event bus, checkpointing, capability registry, session replay.
- **`@mozhou/data-plane`**: Local file I/O (Markdown/JSONL), SQLite Drizzle/better-sqlite3 projections, SHA-256 hash validator.
- **`@mozhou/flywheel`**: Local author preference inference, EMA style updater, event ledger logger, market brief aggregator.
- **`@mozhou/benchmark`**: 50-chapter synthetic test harness with deterministic mock and live provider runners.

### 3. Transaction & Commit Protocol
```typescript
interface ChapterCommitPacket {
  chapterIndex: number;
  finalProse: string;
  summary: string;
  factDeltas: TemporalFactDelta[];
  relationshipDeltas: RelationshipDelta[];
  knowledgeDeltas: KnowledgeDelta[];
  promiseDeltas: PromiseDelta[];
  timelineDelta: TimelineDelta;
  dependencyManifest: DependencyManifest;
  contentHash: string;
}
```

---

### Research Amendments (2026-08-23)

[ADR-0019](../adr/0019-research-driven-amendments-protected-edits-compaction-receipts-knowledgestate.md) records four amendments from the two-volume reference retrospective (`docs/research/reference-retrospective*.md`): protected author edits with stale propagation (amends 0010), LLM-only long-range compaction — keyword extraction banned (amends 0011), first-class Context Receipts with story-text quota and server-side-only assembly (amends 0004), first-class KnowledgeState schema with dual-channel recall (amends 0002). The Gate A behavioral freeze list (MUST M1-M20 / MUST NOT N1-N12, retrospective vol2 终章) is normative for every implementation ticket. Note: the `Drizzle/better-sqlite3` slash in this document is an open decision tracked by the SQLite access-layer research issue.

## Testing Decisions

1. **Behavioral Black-Box Testing**:
   - Tests assert observable behavior on the primary seams (`StoryKernelService`, `ContextCompiler`, `LocalDataPlane`), never internal private methods or ephemeral variables.
2. **Two-Tier Execution Harness (ADR-0016)**:
   - **L1 Deterministic Mock Suite**: Runs the complete 50-chapter synthetic lifecycle (Ch. 01 to Ch. 50, spatial moves, injuries, secret revelations, rule mutations, promise payoffs, database wiping and rebuilding) in $< 5$ seconds in CI.
   - **L2 Live Provider Smoke**: Executes real BYOK model invocations (DeepSeek / GLM / Claude) with full outgoing payload verification, SSE streaming assertions, and 3x consecutive clean runs (ADR-0018).
3. **Zero State Pollution**: Every test run uses isolated temporary directories and in-memory/scratch SQLite databases, ensuring 100% hermetic execution.

---

## Out of Scope

1. **Centralized Cloud Prose Database**: Storing user manuscript text on remote cloud servers is strictly excluded. MoZhou is 100% Local-First.
2. **Foundation Model Fine-Tuning**: Pretraining or fine-tuning custom LLM checkpoints is out of scope. The system optimizes prompts, context policies, and local author profiles.
3. **Pirate/Unverified Scraper Ingestion**: Scraping non-mainstream or pirated content-farm websites is strictly banned.
4. **Multi-Agent Conversational Panels for Routine Drafting**: Running 7-8 competing agents for drafting a single scene is out of scope; single runtime with pluggable capabilities is enforced.

---

## Further Notes

- Reference standards: [OpenWrite](https://github.com/LiPu-jpg/Openwrite) (Local-First file separation & transaction rollback), [jarvis-write](https://github.com/ynnyh/jarvis-write) (Temporal fact intervals & knowledge separation), [天命](https://github.com/zy-zmc/tianming-novel-ai-writer) (Fact delta extraction & continuity gates), [NovelAI](https://docs.novelai.net) (Context compilation & viewer receipts), [DeepSeek Harness](https://www.deepseek.com/harness/) (Event bus, runtime state, capability plugin architecture).
- All 18 Architectural Decision Records in [`docs/adr/`](file:///c:/Users/a1691/Documents/antigravity/happy-newton/docs/adr/) serve as binding technical contracts.
