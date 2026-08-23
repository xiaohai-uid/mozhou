# 0011. Two-Tier Fact Compaction and Scene-Level POV Knowledge Slicing

## Context

Million-word novels accumulate thousands of micro-facts, threatening to bloat the Context Compiler token budget with obsolete details (e.g., clothing worn in chapter 3). Furthermore, multi-POV chapters (e.g., alternating between protagonist investigation and antagonist scheming) risk knowledge leakage if facts are filtered only at the chapter level.

## Decision

We establish **Two-Tier Fact Compaction** and **Scene-Level Context Compilation**:

1. **Two-Tier Fact Lifecycle**:
   - **Active Tier (Dynamic Top-K)**: Facts are dynamically matched based on chapter interval (`valid_from <= current_chapter <= valid_until`), entity mentions, and vector/keyword relevance.
   - **Compacted Tier (Volume Archival)**: Upon completion of a story Volume, terminated micro-facts (`valid_until <= VolumeEnd` and importance $\ne$ `critical`) are folded into volume-level narrative rolling summaries, freeing the active graph from granular noise.

2. **Scene-Level POV Compilation (Kernel-First, UI-Abstracted)**:
   - The Story Kernel and Context Compiler treat `Scene/Beat` as the fundamental atomic compilation unit, scoping `KnowledgeState` strictly to the declared `POV_Entity`.
   - The UI presents a simplified chapter-level interface for standard single-POV workflows, while providing multi-scene POV slicing controls in Pro Studio mode.

## Consequences

- The context compilation cost remains $O(1)$ constant-bounded even as story length approaches millions of words.
- Multi-perspective narratives prevent cognitive omniscience leaks at the individual scene level.
