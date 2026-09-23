# 0007. Novel Runtime Event Architecture: Event Bus, Session Replay, and Auditability

## Context

Most AI creative applications operate under a stateless, fire-and-forget request pattern (`User Click → LLM API Call → Database Write → End`). When generation failures, continuity breaks, or sudden style degradations occur, it is impossible to diagnose root causes: Did the model hallucinate? Did the context compiler omit a key fact? Was the recipe prompt malformed? Did the user's manual edit contradict an earlier canon rule?

Inspired by the **DeepSeek Harness** runtime philosophy—where every task execution, tool call, session state, and scheduler step is a replayable event stream—MoZhou Novel OS requires an explicit event-driven runtime.

## Decision

We establish an asynchronous, append-only **Novel Runtime Event Architecture**:

1. **First-Class Event Bus**:
   Every lifecycle transition in the novel creation process publishes a strongly-typed domain event to `.mozhou/events.jsonl` and the SQLite event projection:
   - `ChapterGenerateRequested`
   - `ContextCompiled` (carrying a **pointer** to the `ContextReceipt` — `{receiptId, taskType, chapterIndex?, recomputationHash, totalTokens, storyTextQuota, entryCount}`; receipt bodies live once in `.mozhou/receipts/`, never inline — ADR-0021)
   - `GenerationStarted` (recording model provider, temperature, recipe ID, and the `receiptId` of the compile it consumes)
   - `CandidateCreated` (storing raw LLM candidate outputs)
   - `AutomatedReviewCompleted` (recording continuity & quality findings)
   - `UserEditRecorded` (capturing diffs between candidate and user final text)
   - `CanonCommitted` (recording fact deltas and promoted truth)
   - `FlywheelRecorded` (capturing metrics, edit distance, and survival status)

2. **Session Replayability & Root-Cause Diagnosis**:
   Any historical generation can be fully replayed and audited step-by-step. If Chapter 45 contains an error, the system can inspect the exact context packet, prompt recipe version, active temporal facts, model parameters, and user edits that produced it.

3. **Disaster Recovery & Event Sourcing**:
   In addition to Markdown canon files, the append-only event ledger acts as an event-sourced audit log. Any corrupted runtime state or broken index can be verified or reconstructed by replaying the event stream.

## Consequences

- Zero black-box mystery: Every LLM output, context injection, and user choice is fully auditable.
- The Data Flywheel receives high-resolution telemetry for algorithmic optimization without storing raw manuscript prose in the cloud.
- Enables deterministic time-travel debugging and generation regression testing.
