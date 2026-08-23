# MoZhou Novel OS

MoZhou Novel OS is a local-first novel operating system and data flywheel designed to make long-form fiction a plannable, generative, editable, traceable, rollbackable, and author-adaptive engineering discipline.

## Language

### Kernel & Domain State

**Author Intent**:
The uncompromisable constitutional blueprint of a novel, encapsulating core satisfying points (爽点), reader promises, protagonist desires, absolute taboos, and intended climax.
_Avoid_: Prompt, author note, background setting

**Outline Graph**:
A hierarchical directed graph structuring narrative progression across Book, Volume, Arc, Chapter, and Scene/Beat with explicit dependency edges.
_Avoid_: Flat outline, chapter list, story roadmap

**Temporal Fact**:
A canonical atomic truth assertion tied to a subject, predicate, and value, bounded by valid chapter intervals (`valid_from` to `valid_until`) and explicit confirmation state (`planned`, `candidate`, `confirmed`, `rejected`).
_Avoid_: Memory item, context note, setting entry

**Candidate Fact**:
An unverified factual assertion extracted from AI-generated draft prose awaiting user validation or final chapter commit.
_Avoid_: Canon, true fact, memory

**Canon Fact**:
A permanent, verified truth in the narrative canon established strictly upon final chapter commit and author confirmation.
_Avoid_: Candidate fact, hallucination, brainstorm

**Knowledge State**:
The explicit state of what specific characters, readers, and narrators know or do not know at any given chapter to prevent omniscience leaks.
_Avoid_: Character memory, shared knowledge, global state

**Narrative Promise**:
A tracked narrative commitment—including foreshadowing, suspense, countdowns, character debts, and unrevealed secrets—governed by a strict lifecycle (`introduced`, `reinforced`, `due`, `paid_off`, `abandoned`, `overdue`).
_Avoid_: Foreshadowing ledger, plot point, hook

**Relationship State**:
A temporal record of relational dynamics between entities (e.g., strangers → tentative allies → mutual trust → betrayal) indexed by chapter timeline.
_Avoid_: Character relationship table, social graph

**Timeline Event**:
An immutable chronological occurrence within the story universe that advances world time or alters temporal facts.
_Avoid_: Chapter log, story history

**Scenario Style Profile**:
A quantified, archetype-specific representation of an author's prose rhythm and vocabulary parameterized by scene type (`action`, `dialogue`, `romance_emotion`, `exposition_worldbuilding`).
_Avoid_: Prompt prefix, system prompt, global tone

**State Compaction**:
The automated archival process that folds expired temporal facts at volume boundaries into compressed rolling summaries to maintain constant-bounded retrieval costs.
_Avoid_: Fact deletion, garbage collection, memory purge

---

### Transaction & Continuity

**Chapter Commit**:
An atomic, transactional unit of finalized narrative output containing final prose, extracted deltas (facts, relationships, knowledge, promises, timeline, items), chapter summary, and a dependency manifest.
_Avoid_: Saved file, chapter markdown, draft accept

**External Modified Proposal**:
An unverified state delta generated when an external modification to canonical Markdown/JSONL files is detected via SHA-256 mismatch, staged for author reconciliation.
_Avoid_: Overwrite prompt, dirty state, sync error

**Protected Author Content**:
Human-authored prose or canon edits carrying a protection flag; automated passes may never overwrite them, and upstream recomputation may only mark affected downstream artifacts stale (ADR-0019 §4).
_Avoid_: Lock file, read-only mode

**Stale Marker**:
A non-destructive flag placed on downstream artifacts whose upstream inputs changed, signaling re-verification without deleting or regenerating author content.
_Avoid_: Deletion, cache purge, rewrite

**Dependency Manifest**:
An exact, deterministic record of all canonical entities, facts, outline nodes, promises, world rules, and style versions read during the compilation and generation of a specific chapter.
_Avoid_: Context dump, read log, prompt history

**Change Impact Engine**:
A dual-layer analysis system that combines deterministic dependency graph traversal with semantic LLM evaluation to identify stale or broken downstream chapters when upstream canon is altered.
_Avoid_: LLM rewrites, manual check, batch regeneration

**Context Compiler**:
The deterministic budgeting and selection pipeline that queries the Story Bible, filters relevant entities by proximity, POV, activation rules, and token limits, and compiles the precise payload for the model.
_Avoid_: Prompt builder, context injector, system prompt generator

**Context Packet**:
The assembled prompt payload passed to a model, comprising budgeted sections with strict priority and trim policies.
_Avoid_: Full context, prompt text, context window

**Context Receipt**:
A transparent, user-inspectable breakdown accounting for every token, included entity, and excluded rule in a compiled Context Packet, detailing why each item was included or omitted.
_Avoid_: Context viewer, prompt log, debug trace

**Continuity Gate**:
A series of deterministic and LLM-assisted verification checks executed before chapter commit to detect logic errors, knowledge leaks, timeline paradoxes, and dead promises.
_Avoid_: Linter, fact checker, review agent

---

### Runtime & Capabilities

**Novel Runtime**:
The stateful execution engine that coordinates workflows, event buses, schedulers, checkpoints, and transactions across the novel lifecycle.
_Avoid_: Agent loop, script runner, orchestrator

**Event Bus**:
The asynchronous domain event backbone that publishes and records every generation step, review finding, and user decision.
_Avoid_: Message queue, callback listener

**Session Replay**:
The deterministic reconstruction and root-cause audit of a historical generation run from logged domain events.
_Avoid_: Chat history, debug log

**Capability**:
An abstract task-level contract (e.g., `PROSE_DEAI`, `MARKET_SCAN`, `STATE_EXTRACTOR`, `LONGFORM_PLANNING`) decoupled from underlying implementation providers.
_Avoid_: Skill, tool, agent

**Capability Registry**:
The central registry resolving abstract capabilities to concrete providers (such as native routines, external skills, or remote services) without coupling callers to implementation names.
_Avoid_: Skill manager, tool list, plugin loader

---

### Evaluation & Verification

**Evaluation Engine**:
The first-class automated verification subsystem that measures canon accuracy, knowledge leaks, promise recall, and prompt regressions against standardized benchmarks.
_Avoid_: Unit test suite, prompt grader

**Long Novel Benchmark**:
A 50-chapter synthetic reference novel designed to mechanically stress-test temporal facts, knowledge asymmetry, delayed promises, and retroactive world mutations.
_Avoid_: Test sample, demo book

---

### Data Flywheel & Privacy

**Policy Flywheel**:
A closed-loop learning mechanism that refines prompt recipes, context policies, model routing decisions, quality gates, and author personalization profiles without uploading or fine-tuning on raw private manuscript text.
_Avoid_: Model training pipeline, data scraper, LLM fine-tuner

**Author Model**:
The personalized profile of an author's stylistic and structural habits inferred continuously from user choices, edits, and deletions.
_Avoid_: Custom prompt, user persona

**Capability Evolution**:
The empirical tracking and benchmarking of capability and recipe versions over time based on acceptance rates and edit ratios.
_Avoid_: Version list, release changelog

**Event Ledger**:
An append-only log capturing user decisions, candidate acceptances/rejections, post-generation edits, review outcomes, and execution latency.
_Avoid_: User tracker, telemetry dump, audit log

**Privacy Tier**:
A 4-level classification system strictly separating strictly local manuscript prose (P0) and derived private profiles (P1) from opt-in anonymized execution metrics (P2) and explicitly contributed open datasets (P3).
_Avoid_: Security level, data flag

**Market Brief**:
A structured, continuously updated profile of genre trends, hook placements, chapter length distributions, pacing patterns, and anti-patterns extracted from public market leaderboards and benchmarks.
_Avoid_: Market report, scan markdown, crawler output
