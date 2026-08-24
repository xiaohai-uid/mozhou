# Task 5 Preflight Report — Slice 5 replay-contract repair

Date: 2026-08-13

## Root cause

`runChapterChat` constructed replay rows directly from the narrow `prepareChapterCandidate` query. That bypassed the status normalization used by the chapter-message row mapper, so a legacy successful assistant row persisted as `done` reached `buildChapterReplayHistory` unchanged and was excluded. The missing assistant history also prevented the compression threshold from being reached; in the fail-open case, the 503 mock was consequently consumed by the actual provider request instead of by the compression request.

## Frozen replay contract

- Replay only `user + done`, `assistant + completed_candidate`, and `assistant + applied`.
- A persisted assistant `done` is normalized to `completed_candidate` before replay. User `done` remains `done`.
- `generating`, `stopped`, `error`, and `discarded` are not replayed. `stopped` was not restored to the production replay policy.
- The current user is supplied separately by `buildWritingContext`, once and last. Compression receives only eligible history; unsuccessful compression keeps that complete eligible history and then appends the current user.
- Observer facts remain derived from the final `PreparedChatRequest`; this repair does not alter observer or SSE domain semantics.

## Changes

- Added `normalizePersistedChapterMessageStatus`, a pure role-aware adapter over the existing candidate normalization. `toRow` and the replay handoff both use it, leaving a single assistant candidate-status rule.
- Added pure replay-normalization tests for a legacy assistant `done` and a user `done` row.
- Corrected the conflicting payload-consumer fixture from `stopped` to legacy assistant `done`. This is a Contract Correction: `stopped` must remain excluded, rather than being added back to replay.

## Verification

Executed from `C:\zcode\novel-ai\app`:

```text
npm test -- tests/unit/payload-consumer.test.ts
PASS: 1 file, 11 tests.

npm test -- tests/unit/payload-consumer.test.ts tests/unit/chapter-replay.test.ts tests/unit/chapter-candidate-lifecycle.test.ts tests/unit/writing-context.test.ts tests/unit/payload-observer.test.ts tests/unit/sse.test.ts tests/http/chat.test.ts tests/http/chapter-continuation.test.ts
PASS: 8 files, 95 tests.

npm test -- tests/http/chat.test.ts tests/http/chapter-continuation.test.ts
PASS: 2 files, 46 tests. These are real Next HTTP tests backed by the configured local PostgreSQL database.

npx tsc --noEmit
PASS: exit 0.

npm run build
PASS: Next.js 16.3.0 production build; TypeScript and 42 static pages completed.

npx drizzle-kit check
PASS: Everything's fine.
```

The HTTP/DB gate uses the available local database from `.env`; it validates HTTP routes and persisted chapter candidate lifecycle with the deterministic mock provider. No real provider smoke was run or claimed for this repair.

## Unresolved items

- This preflight repair does not perform the broader Slice 5 production-provider/canary workflow. Real-provider behavior remains out of scope and unclaimed.
- Vitest emits existing Vite configuration deprecation warnings; all commands above exited successfully.
- The checkout remains intentionally dirty with unrelated changes. Only the five Slice 5 files in this report's commit are staged.
