# 0014. Canon Conflict Reconciliation and Guided Intentional Mutation

## Context

Continuity checking gates frequently flag hard contradictions (e.g., character uses an amputated limb). In creative writing, such contradictions may represent intentional narrative twists, spontaneous breakthroughs, or unrecorded plot developments rather than accidental continuity errors. Allowing authors to blindly ignore gates produces silent graph rot; blocking authors completely breaks creative flow.

## Decision

We implement a **Guided Fact Mutation Reconciliation Protocol** for hard continuity conflicts:

1. **Hard Conflict Flagging**: The Continuity Gate marks the contradiction as `HARD_CONFLICT` and displays the exact conflicting `TemporalFact` assertion.
2. **Author Intent Clarification**: The author can choose:
   - *Acknowledge Error*: Edit the prose to align with established canon.
   - *Confirm Intentional Twist / Mutation*: Keep the prose and declare the state change.
3. **State Machine Self-Healing**: When an intentional twist is confirmed, the system assists the author in atomically mutating the temporal fact interval:
   - Sets `valid_until = current_chapter - 1` on the obsolete fact.
   - Creates a new `TemporalFact` with `valid_from = current_chapter` and the new state value.

## Consequences

- Authors have complete freedom to introduce spontaneous plot twists and retcons.
- The Story Kernel's temporal fact graph maintains mathematical consistency without accumulated logic debt.
