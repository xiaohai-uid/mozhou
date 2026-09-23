# 0002. Temporal Canon Graph and Candidate-to-Canon Fact Lifecycle

## Context

Long-form novels require strict chronological consistency across hundreds of chapters. Systems relying on flat character settings or static context markdown (`上下文.md`) inevitably produce continuity hallucinations (e.g., characters holding items already given away, acting on secret knowledge they have not learned, or remaining injured after recovery).

Furthermore, naive extraction architectures treat LLM generation outputs as immediate factual truth upon generation, corrupting the story memory before the author reviews or modifies the text.

## Decision

We establish an explicit **Temporal Canon Graph** with a 4-state lifecycle for all factual assertions:
1. **Fact States**:
   - `planned`: Stated in outlines/plans, not yet verified in narrative prose.
   - `candidate`: Extracted from AI-generated draft prose, pending human validation.
   - `confirmed`: Promoted to canon upon final chapter commit and author acceptance.
   - `rejected`: Discarded or explicitly overridden by the author.

2. **Temporal Scoping**: Every fact maintains valid chapter bounds (`subject`, `predicate`, `value`, `valid_from`, `valid_until`, `importance`, `source`, `status`). Querying chapter $N$ returns only facts where `valid_from <= N` and (`valid_until is null` or `valid_until >= N`).

3. **Reader vs. Character Knowledge Separation**: Knowledge states are tracked independently for the reader, the POV character, and secondary characters to prevent omniscience leaks.

4. **Risk-Graded Writebacks on Commit**:
   - *Low risk* (e.g., character moves to tavern): Auto-written to canon.
   - *Medium risk* (e.g., relationship status shifts from strangers to allies): Staged in commit review panel.
   - *High risk* (e.g., character death, cultivation breakthrough, secret reveal, world rule breach): Requires explicit author confirmation.

## Consequences

- AI drafts never pollute canon facts until final user acceptance and commit.
- Fact retrieval is deterministic and strictly chronologically accurate.
- Authors retain final governance over narrative reality.
