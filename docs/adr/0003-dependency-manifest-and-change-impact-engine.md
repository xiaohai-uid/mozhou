# 0003. Dependency Manifest and Deterministic-First Change Impact Engine

## Context

Modifying early story elements (e.g., world rules, character traits, volume outlines, foreshadowing seeds) in a 100+ chapter novel often causes downstream silent rot. Pure LLM-based impact analysis ("Ask AI which of the 100 chapters are broken") is non-deterministic, incomplete, hallucination-prone, and prohibitively expensive. Conversely, naive full-text re-generation destroys author revisions.

## Decision

We decouple impact analysis into two layers: **Deterministic Dependency Graph Traversal** followed by **Targeted Semantic LLM Analysis**.

1. **Dependency Manifest on Chapter Commit**: Every compiled and committed chapter records an immutable dependency manifest of the exact versioned entities it consumed during generation:
   - Specific facts (`fact:char-001:realm:v7`)
   - Relationship versions (`rel:char-001-005:v4`)
   - Outline nodes (`outline:vol-2:v13`)
   - Narrative promises (`promise:p-023`)
   - World rules (`rule:magic-system:v2`)
   - Style profiles (`style:v17`)

2. **Change Impact Engine Flow**:
   - **Step 1 (Deterministic Traversal)**: When entity $X$ is modified, query the dependency graph index to immediately identify all downstream chapters that explicitly read entity $X$.
   - **Step 2 (Semantic Impact Evaluation)**: Send only the impacted chapter diffs and modified entity definitions to an LLM evaluator to classify the impact severity (`direct_conflict`, `indirect_drift`, `cosmetic_only`, `no_action_needed`).
   - **Step 3 (Author-Directed Action)**: Present the impacted chapters to the author with stale markers and targeted rewrite recommendations. Never silently rewrite downstream prose.

## Consequences

- Impact detection is instant, mathematically sound, and zero-hallucination at the candidate identification layer.
- Token consumption for change analysis is reduced by over 90% since LLM inference is only applied to confirmed readers of the modified entity.
- Authors can refactor early chapters with complete confidence regarding downstream consequences.
