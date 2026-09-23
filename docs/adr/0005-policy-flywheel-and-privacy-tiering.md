# 0005. Policy Flywheel and 4-Tier Local-First Privacy Boundary

## Context

A sustainable AI system must continuously improve through usage. However, for a creative writing tool operating under a Local-First + Bring Your Own Key (BYOK) model, attempting to build a generic foundation model pretraining flywheel creates severe risks:
1. Violates the core privacy promise of local-first creative work.
2. Incurs prohibitive compute and fine-tuning infrastructure costs.
3. Fails to provide immediate value to authors writing in varied and unique styles.

## Decision

We establish a **Policy Flywheel** governed by a strict **4-Tier Local-First Privacy Boundary**:

1. **Policy Flywheel Focus**:
   Improve prompts, context compilation policies, workflow checkpoints, task-based model routing, quality gate thresholds, and author personalization profiles—*not* base model pre-training.

2. **Privacy Tiering**:
   - **P0 (Private Text - Strictly Local)**: Manuscript prose, raw drafts, worldbuilding lore, user chat transcripts. *Never leaves the user's local machine.*
   - **P1 (Private Derived - Local by Default)**: Author preference profiles, style matrices, localized story brain indexes.
   - **P2 (Anonymous Metrics - Opt-in Telemetry)**: Model name, recipe version, capability type, acceptance/rejection booleans, edit distance ratios, token latency, error codes. *Only anonymized execution metrics can be contributed to aggregate product optimization.*
   - **P3 (Contributed Data - Explicit User Consent)**: Anonymized benchmark cases, shared prompt templates, and explicitly open-sourced case studies.

3. **7-Tier Flywheel Engine**:
   - Tier 1: Local Author Preference Learner (reject vs. accept vs. user edit patterns).
   - Tier 2: Revision & Style Evolution (abstracting edits into style delta rules without prompt stuffing).
   - Tier 3: Quality & Long-term Survival Tracker (measuring text survival across 30+ days).
   - Tier 4: Task-Model Router (matching task types like drafting, review, extraction to optimal models).
   - Tier 5: Context Policy Debugger (converting continuity failures into regression eval cases).
   - Tier 6: Capability & Skill Benchmark (versioned recipe performance tracking).
   - Tier 7: Market Brain & Trend Analysis (extracting public leaderboard structure and pacing formulas).

## Consequences

- The system gains institutional and personalized intelligence with every written word while keeping novel prose 100% private.
- BYOK cost-effectiveness is maximized via intelligent, benchmarked model routing.
- Context compiler bugs become deterministic regression tests.
