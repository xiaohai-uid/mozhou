---
date: 2026-08-23
description: '墨舟（MoZhou Novel OS）领域词汇表：内核实体、事务连续性、运行时能力、评估与数据飞轮的规范用语'
tags:
  - mozhou
  - glossary
---

# MoZhou Novel OS

MoZhou Novel OS is a local-first novel operating system and data flywheel designed to make long-form fiction a plannable, generative, editable, traceable, rollbackable, and author-adaptive engineering discipline.

> Related notes: [[kernel-schema-draft]] · [[kernel-schema-decisions]] · [[dual-plane-sync-spec]] · [[entity-directory-spec]] · [[ADR-0019 Research-Driven Amendments]]

## Language

### Kernel & Domain State

**Author Intent**:
The uncompromisable constitutional blueprint of a novel, encapsulating core satisfying points (爽点), reader promises, protagonist desires, absolute taboos, and intended climax.
_Avoid_: Prompt, author note, background setting

**Outline Graph**:
A hierarchical directed graph structuring narrative progression across Book, Volume, Arc, and Chapter with explicit dependency edges. Scenes hang below chapters as their own first-class entity, not as graph nodes.
_Avoid_: Flat outline, chapter list, story roadmap

**Scene**:
The atomic synchronization unit shared across planning, writing, chat, and review, hanging below a Chapter and carrying beats, summary, and POV; prose itself lives only in the Chapter Commit.
_Avoid_: Beat list, chapter fragment, outline leaf

**Entity Directory Card**:
The per-entity Markdown card under `设定/<类型>/` whose YAML frontmatter carries the machine fields (`ref`, `name`, `aiContext` four-tier strategy, alias table, exclusion phrases, `brief`, `tags`) while its body stays human-facing and is never assembled into prompts wholesale.
_Avoid_: Free setting note, lore entry, config object

**Entity Ref**:
A stable, human-readable slug reference to a story entity within the five frozen namespaces (`char:`, `item:`, `location:`, `faction:`, `concept:`), unique per book and frozen once any tracked row or card cites it.
_Avoid_: Opaque ID, mutable name, numeric key

**Temporal Fact**:
A canonical atomic truth assertion tied to a subject, predicate, and value, bounded by valid chapter intervals (`valid_from` to `valid_until`) and explicit confirmation state (`planned`, `candidate`, `confirmed`, `rejected`). Secrets are temporal facts in the reserved `secret` predicate namespace whose disclosure closes the validity interval.
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

**Active Draft**:
A chapter file in the manuscript tree that has not been committed yet, or is being re-edited after a prior commit; freely editable in any editor without triggering reconciliation.
_Avoid_: Dirty file, temp draft, WIP copy

**Sync Layering**:
The dual-plane rule that planning-layer entities (author intent, outline nodes, scenes, manually created promises, style profiles) persist to canon files immediately on save, while narrative-state deltas (facts, knowledge, relationships, timeline) land only upon Chapter Commit.
_Avoid_: Autosave everything, deferred write-back, batch flush

**Hash Baseline**:
The application-maintained fingerprint record of what MoZhou itself last wrote to each canon file, kept outside the disposable projection, used to tell external modifications apart from the app's own writes.
_Avoid_: Cache key, checksum log, git index

**Write Verification**:
The mandatory pre-write hash check that suspends any application-side save when the file on disk differs from its baseline, routing the collision into reconciliation instead of silently overwriting it.
_Avoid_: Last-writer-wins, force save, merge-on-save

**Full-Absorption Rebuild**:
Reconstruction of the projection by deterministically rescanning every canon file as truth and establishing a fresh baseline; requires no model involvement.
_Avoid_: Ledger replay, backup restore, resync wizard

**Runtime Zone**:
The book-local non-canon area (`.mozhou/`) holding the disposable projection, the audit ledger, receipts, and snapshots; excluded from reconciliation and never treated as truth.
_Avoid_: Hidden state, system folder, cache directory

**Snapshot**:
A point-in-time copy of the entire book directory taken after each Chapter Commit and on demand, serving as the data source for rollback.
_Avoid_: Autosave, version history, undo stack

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

**Reserved Allocation**:
The two-phase budget algorithm that first reserves final-form token costs for candidate entries strictly in desirability sequence, then places the reserved prefix; inclusion is therefore equivalent to occupying a prefix of that order.
_Avoid_: Best-effort fill, skip-ahead packing, greedy insertion

**Desirability Order**:
The deterministic total order over candidate entries — manual pin, tier rank, relevance score, identifier tie-break — along which reservation proceeds and against which eviction is defined.
_Avoid_: Insertion Order (hand-tuned scalar), priority number, sort index

**Atomic Entry**:
An entry governed by Do-Not-Trim semantics: it enters the packet whole or is evicted whole, never truncated mid-content; atomicity bars truncation but never bars eviction.
_Avoid_: Protected entry, undeletable entry, eviction-immune entry

**Story Text Quota**:
The pre-deducted token floor reserving prose capacity ahead of any setting-entry competition; setting-like entries can never spend it, while prose itself may absorb unused pool slack beyond the floor.
_Avoid_: Prose budget cap, quota refund, story text limit

**Recomputability**:
The audit property of a Context Receipt: it archives a minimal replay input surface, so re-running the budget assembly reproduces the identical recomputation hash at any later time; mutated or retired inputs fail loudly and localize the drift to specific entries — never silent divergence.
_Avoid_: Digest-only anchoring, determinism claim without verification, best-effort replay

**Activation Evidence**:
The typed record of why a candidate entered recall through its channel — matched keywords, graph hop source and depth, embedding score, or manual pin — carried optionally per receipt entry; structural injections have none.
_Avoid_: Compressed evidence string, activation key dump, search log, relevance explanation prose

**Replay Inputs**:
The minimal input snapshot archived inside a Context Receipt — config/tokenizer/model versions plus the desirability-ordered candidate list with scores and content digests, structural section digests, and story-text slice digests — sufficient to deterministically re-run the budget assembly phase; entity contents themselves are never duplicated. Recall-filter pass-throughs sit outside the replay contract.
_Avoid_: Raw prompt archive, full input snapshot, digest-only anchor

**Graph Trigger Source**:
An EntityRef resolved by the keyword fast channel from a draft mention through the alias table; it roots the k-hop graph recall, and its entity card enters the candidate set unconditionally while its one-hop facts bypass relevance threshold but never budget or gating.
_Avoid_: Mention hit, activation key, anchor entity

**K-Hop Recall**:
The deterministic breadth-limited traversal of the POV-visible Temporal Canon subgraph that expands from trigger sources across relationship, reference, and event edges under hard branch caps to surface neighborhood facts as candidates.
_Avoid_: Graph search, recursive scanning, memory walk

**Continuity Gate**:
A series of deterministic and LLM-assisted verification checks executed before chapter commit to detect logic errors, knowledge leaks, timeline paradoxes, and dead promises.
_Avoid_: Linter, fact checker, review agent

---

### Runtime & Capabilities

**AI Context Tier**:
The entity-level assembly strategy in four grades—`always`, `detected` (default), `detectedOff`, `never`—deciding activation only; secret-authorization and POV-slicing gates remain centrally enforced and cannot be bypassed by any tier.
_Avoid_: Include flag, prompt toggle, permission level

**Novel Runtime**:
The stateful execution engine that coordinates workflows, event buses, schedulers, checkpoints, and transactions across the novel lifecycle.
_Avoid_: Agent loop, script runner, orchestrator

**Event Bus**:
The asynchronous domain event backbone that publishes and records every generation step, review finding, and user decision.
_Avoid_: Message queue, callback listener

**Session Replay**:
The deterministic reconstruction and root-cause audit of a historical generation run from logged domain events.
_Avoid_: Chat history, debug log

**Task Projection**:
The rebuildable SQLite projection of task lifecycle state (jobs/steps/attempts) with rows aligned to ledger sequence numbers; optimistic concurrency (CAS) applies to the projection, never to the append-only ledger itself.
_Avoid_: Source-of-truth state table, dual ledger

**Tier Routing**:
The indirect two-level mapping from task_type to tier name to (provider, model) pairs; model ids are never bound directly to task types so that provider-side renames stay isolated in configuration.
_Avoid_: Direct model binding, hardcoded per-task models

**Chapter Production Session**:
The single in-memory state machine driving one chapter through the ten-step pipeline (Prepare→…→Flywheel Record); each step transition is a ledger task event, one session yields exactly one commit, and recovery replays from the step-boundary checkpoint.
_Avoid_: Batch job, background worker

**Proposal Port**:
The unified confirmation API through which both the reconciliation flow and the pipeline's canon proposals await per-item author rulings (confirm/reject/editAccept) before promotion.
_Avoid_: Ad-hoc dialog state, silent auto-promotion

**Capability**:
An abstract task-level contract (e.g., `PROSE_DEAI`, `MARKET_SCAN`, `STATE_EXTRACTOR`, `LONGFORM_PLANNING`) decoupled from underlying implementation providers.
_Avoid_: Skill, tool, agent

**Capability Registry**:
The central registry resolving abstract capabilities to concrete providers (such as native routines, external skills, or remote services) without coupling callers to implementation names.
_Avoid_: Skill manager, tool list, plugin loader

**Capability Recipe**:
A machine-validatable frozen methodology unit (typed fields + JSON Schema: triggers, static load conditions, failure matrix, tracking gate, context budget, pinned MIT source) that can be instantiated as one or more runtime skill runs.
_Avoid_: Free-form prompt template, skill definition

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

## 2026-08-30 文学质量门集成边界冻结（ADR-0025）

实施计划 `docs/superpowers/plans/2026-08-30-longform-quality-gates-integration.md` 开工前置裁决，详见 [[0025-literary-quality-review-boundary]]。要点：

1. Continuity Gate 保持确定性与正典权威；文学 LLM 判定不得进入 Canon 真伪判定。
2. 文学质量审查 = 独立 pre-Canon 质量边界（`@mozhou/quality-engine`），报告锚定 `chapterIndex + draftRevision + draftContentHash + receiptId + ruleSetDigest + reviewerBinding`，正文变化即 stale（fail closed）。
3. 管线步 id `review` 保留，契约扩展为「产出版本绑定 QualityReviewReport」；blocking 失败走显式 `review_rework` 回炉边，每 session 自动回炉上限 2 次，第 3 次交作者。
4. **QualityReviewReport 是值**（随报告 JSON 落 `.mozhou/quality-reviews/`，非 Canon）；飞轮侧信号由事件投影派生，不双写报告本体。
5. `apps/web + packages/*` 为 Novel OS 主线；`app/` 冻结为遗留面（只收迁移/安全/可靠性修复）。项目级质量策略不入 TemporalFact。

新增术语：**QualityReviewReport**（版本绑定的文学审查报告值）、**QualityPolicy**（平台默认+项目覆盖的规则集，`maxAutomaticReworks` 恒为 2）、**FailurePattern**（作者结构化纠错投影出的项目级失败记忆，质量先验而非 Canon 事实）、**ReaderExperienceDelta**（压力/期待/实得/兑付/解法模式的章级诊断，Kernel 外）。
_Avoid_: 让文学判定进入 Gate 裁决、把质量规则写进 TemporalFact、自动回炉超 2 次
