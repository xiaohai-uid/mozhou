# 0008. Evaluation Engine as a First-Class Subsystem: Novel Benchmark and Regression Prevention

## Context

Prior AI writing projects suffered from "vibes-based development"—changes to prompts, context compiler rules, or skills were merged based on subjective impressions ("this output feels nicer") rather than empirical verification. Consequently, fixing a bug in chapter 5 silently broke continuity in chapter 40, leading to perpetual rework cycles.

A production-grade Novel Operating System requires an automated, quantitative, and reproducible evaluation subsystem that treats long-form fiction continuity with the same engineering rigor as compiler optimization.

## Decision

We promote the **Evaluation Engine** to a first-class subsystem alongside the Story Kernel and Novel Runtime:

1. **Standardized Long Novel Benchmark (50-Chapter Synthetic Suite)**:
   A deterministic, multi-arc synthetic novel scenario specifically designed to stress-test narrative state management:
   - Early foreshadowing insertion (Ch. 03) and delayed payoff (Ch. 45).
   - Spatial transitions (Ch. 18).
   - Temporary physical injuries with strict validity intervals (Ch. 23 - Ch. 39).
   - Asymmetric knowledge between reader and characters (Ch. 27).
   - Relational flips from alliance to hostility (Ch. 31).
   - Retroactive world rule mutations (Ch. 35) and outline refactoring (Ch. 40).

2. **Core Quantitative Metric Gates**:
   - `CANON_ACCURACY` ($\ge 99.0\%$): Zero contradiction with confirmed temporal facts.
   - `KNOWLEDGE_LEAK_RATE` ($0.0\%$): Zero instances of characters acting on unlearned secrets.
   - `PROMISE_RECALL` ($100\%$): Active promises due at chapter $N$ must appear in the compiled context.
   - `CHANGE_IMPACT_RECALL` ($100\%$): All chapters reading modified entities must be flagged as stale.
   - `CONTEXT_BUDGET_OVERFLOW` ($0.0\%$): Compiled prompts must never exceed token allocations.
   - `USER_EDIT_RATIO_REDUCTION`: Measure whether new prompt/recipe iterations decrease required human rewriting.

3. **Continuous Regression Testing (`CASE-NNNN`)**:
   Whenever a real user or test reveals a continuity error (e.g., character uses an item given away in an earlier chapter), the system automatically captures the snapshot and registers an immutable regression evaluation case (`CASE-NNNN`). No context policy or prompt recipe can be deployed if any historical `CASE` fails.

## Consequences

- Replaces subjective guesswork with measurable, automated regression gates.
- Every architectural, prompt, or skill upgrade must mathematically demonstrate parity or improvement against historical baselines.
- Changes to the Story Kernel or Context Compiler are safeguarded against regressions across hundred-chapter story horizons.
