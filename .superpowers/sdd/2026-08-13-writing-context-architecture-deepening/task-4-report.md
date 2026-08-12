# Task 4 Report — Slice 4: final payload observer and shared SSE framing

Date: 2026-08-13

## Changes

- `app/lib/chat/payload.ts` now derives observer-only facts from the final `PreparedChatRequest`: recognized system-section markers from the rendered system string, final message roles/count, final current-user-last fact, and final history count. It no longer records `system_char_count`, and it ignores non-whitelisted markers so arbitrary prompt text cannot become an observed section name.
- `app/lib/http/sse.ts` centralizes SSE byte framing, headers, close-once terminal lifecycle, request/client cancellation propagation, and a generic safe-error fallback.
- Both chat routes now use the shared SSE response helper. They continue to construct all domain events, completion decisions, domain error codes, and fields themselves.
- Added unit tests for final-request-derived observation, no raw-section leakage, observer fail-open streaming, exact SSE framing, one terminal event, client cancellation, and sanitized fallback errors.

## Frozen contracts preserved

- Provider-visible `PreparedChatRequest` shape and one-api system-message prepend behavior were not changed.
- Observer remains fail-open and does not participate in provider calls, DB writes, candidate lifecycle, or state decisions.
- Observation is a structured allowlist only: route/mode/model, system presence/known sections, message count/roles, final current-user fact, history/compression, RAG/style/skill, and scope booleans. It records no raw system, message content, selection, RAG/summary text, tokens, or secrets.
- Independent-route event fields remain `start { sessionId }`, `delta { text }`, and its existing `done` fields.
- Chapter completion remains exactly `{ type: "done", messageId }`; no `status` was added. SSE does not establish DB/candidate state.
- Existing route ownership prechecks and candidate mutation contracts were not changed.

## Tests and verification

Executed from `C:\zcode\novel-ai\app`:

```text
npm test -- --project unit tests/unit/payload-observer.test.ts tests/unit/sse.test.ts
RED: before implementation, observer test showed caller-derived sections/current-user/history count; SSE import was absent.
PASS: 2 files, 9 tests.

npm test -- --project http tests/http/chat.test.ts tests/http/chapter-continuation.test.ts
PASS: 2 files, 46 tests.

npx tsc --noEmit
PASS: exit 0.

npm run build
PASS: Next.js 16.3.0 production build, TypeScript and 42 static pages completed.

npx drizzle-kit check
PASS: Everything's fine.
```

The shared-helper tests verify client `reader.cancel()` aborts the signal passed to the route callback, terminal `done`/`error` is emitted only once, and domain event objects are byte-framed without field mutation. HTTP chapter coverage asserts the precise `done` object shape.

An existing broader unit command also reported three failures in `tests/unit/payload-consumer.test.ts`, all in pre-existing chapter replay/compression scenarios (`stopped` history exclusion and compression transport expectation). Slice 4 does not touch `chapter-chat` replay/compression behavior; those failures were not modified or masked. The focused HTTP contracts passed.

## Real one-api smoke

`node scripts/smoke-real-llm.mjs` was actually run with the local `.env` configuration and passed: real chapter generation produced SSE `start`, 22 `delta` frames, and `done`; the assistant candidate persisted, was re-read, applied, and the chapter body was re-read with the generated tail. No credential, raw prompt, full generated text, or test-account detail is recorded here.

## Known limitations

- The real smoke covers the real-provider happy path. It does not deterministically exercise client disconnect, provider failure, or terminal-event races against one-api; those are covered at the shared helper/unit and deterministic HTTP layers.
- Vitest emits existing Vite configuration deprecation warnings; they do not affect the passing commands.

## Schema and workspace baseline

- No schema, migration, Drizzle metadata, or database contract was changed by Slice 4.
- The checkout began with extensive unrelated modified/untracked work. This slice stages only its two routes, observer, SSE helper, tests, and this report; no reset, clean, checkout, or unrelated overwrite was used.
