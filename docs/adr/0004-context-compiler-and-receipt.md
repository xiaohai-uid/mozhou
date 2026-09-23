# 0004. Two-Stage Context Architecture: Story Bible vs. Context Compiler with Transparent Receipts

## Context

Fiction writing systems typically suffer from either context starvation (missing critical facts) or context bloat (stuffing the entire bible into prompt windows, leading to needle-in-a-haystack attention degradation and high costs). Furthermore, when AI writes inconsistent prose, authors have no visibility into whether the model failed or the context compiler failed to deliver the necessary premise.

## Decision

We strictly separate **Story Bible Storage** from **Context Compilation**, inspired by advanced lorebook mechanics (NovelAI/Novelcrafter) and formal compiler architectures.

1. **Separation of Concerns**:
   - **Story Bible (Story Kernel)**: The comprehensive, queryable repository of what is known across the entire novel.
   - **Context Compiler**: The operational pipeline that determines what the model needs to know for a specific generative or analytical task.

2. **Context Compilation Pipeline**:
   - Task & Scope Identification (`chapter_writing`, `scene_beat`, `review`, `fact_extraction`).
   - Entity & Keyword Activation (Named entity recognition, explicit manual pins, POV scoping, regex/keyword triggers).
   - Temporal Fact Slicing (Filter strictly by `valid_from <= current_chapter <= valid_until`).
   - Narrative Promise Inclusion (Prioritize active and due promises).
   - Token Budgeting & Trim Hierarchy (Author Intent > Current Task > Active Facts > Rules > Rolling Recaps > Distant Semantic Recall).
   - Context Packet assembly.

3. **Context Receipt (Explainability Layer)**:
   Every compiled packet produces an immutable **Context Receipt** detailing:
   - Included tokens per category.
   - Exact entity IDs and facts injected.
   - Specific items trimmed or excluded due to budget or irrelevance.
   - A user-facing "Why AI saw this" inspector.

## Consequences

- Token budgets are strictly enforced, eliminating context overflow and unbounded API costs.
- Context assembly is fully deterministic, unit-testable, and reproducible.
- Author trust is maximized through complete transparency into LLM inputs.
