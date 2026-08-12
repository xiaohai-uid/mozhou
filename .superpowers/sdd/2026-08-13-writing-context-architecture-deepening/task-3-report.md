# Task 3 Report — Slice 3: chapter replay policy, candidate lifecycle, ownership

Date: 2026-08-13

## Scope delivered

- Added `app/lib/novels/chapter-replay.ts`: replayable persistence rows are converted to provider history only when they are `user/done`, `assistant/completed_candidate`, or `assistant/applied`. The current user and active candidate are excluded; `writing-context` remains responsible for appending the final current user message.
- Added `app/lib/novels/chapter-candidate.ts`: candidate preparation/reuse, stale `generating` recovery, provider settlement, owner/status/revision/content application guards, race-safe single-writer apply / duplicate returns 400, and discard transitions are centralized here.
- Added `app/lib/novels/ownership.ts`: a single owner resolver is used for route precheck and the domain transaction. The route retains synchronous HTTP 404 before it creates the SSE stream/provider; the transaction is authoritative.
- Refactored `app/lib/novels/chapter-chat.ts` to orchestrate context, transport, and events while delegating replay/candidate mutation decisions to the focused modules.
- Updated the chapter chat route to use the ownership resolver; added focused replay/lifecycle tests and strengthened the HTTP test to prove a non-owner request produces no provider observation.

No schema, transport, compression, SSE framing, or public event contract was intentionally changed by this slice. Existing `generationKey`, `requestHash`, `baseRevision`, status, and revision facts remain the persistence source of truth.

## State matrix

| Persisted row | Replayed to provider | Candidate application |
| --- | --- | --- |
| `user + done` | yes | n/a |
| `assistant + completed_candidate` | yes | allowed only for owner, non-empty content, matching revision/content guard |
| `assistant + applied` | yes | 历史上已应用；再次 apply 必须 400，且不重复修改正文 |
| `assistant + generating` | no | rejected |
| `assistant + stopped` | no | allowed only with owner and matching revision/content guard |
| `assistant + error` | no | rejected |
| `assistant + discarded` | no | rejected |
| current user / current assistant candidate | no | n/a |

## Test-first evidence

The new unit test files were created before the modules existed. The first run failed as expected with module-resolution errors for `@/lib/novels/chapter-replay` and `@/lib/novels/chapter-candidate`; that established the red state. After implementation, the focused tests passed.

## Verification evidence

Executed from `C:\zcode\novel-ai\app`:

```text
npx vitest run tests/unit/chapter-replay.test.ts tests/unit/chapter-candidate-lifecycle.test.ts
RED: failed as expected before implementation: both required modules were absent.

npx vitest run tests/unit/chapter-replay.test.ts tests/unit/chapter-candidate-lifecycle.test.ts tests/http/chapter-continuation.test.ts
PASS: 3 test files, 45 tests.

npx tsc --noEmit
PASS: exit 0.

npm run build
PASS: Next.js 16.3.0 production build; compiled, TypeScript, and 42 static pages completed.

npx drizzle-kit check
PASS: Everything's fine.

node scripts/smoke-real-llm.mjs
PASS: real one-api chapter generation, SSE 52 deltas/done, assistant persistence and refresh, then apply and chapter-body verification. Candidate messageId=10050; reply=340 chars; resulting body=370 chars.
```

The focused HTTP suite covers same-generation-key reuse, exactly-once candidate persistence, complete/stopped/error state handling, owner/status/revision/expected-content guards, duplicate application returning 400, concurrent application, and the non-owner `provider_call_count=0` equivalent (no new provider observation).

## DB evidence

- `drizzle-kit check` confirmed the available database/migration configuration.
- The real smoke persisted the generated assistant candidate, re-read it through the chapter message API, applied it, and re-read the chapter with the generated text at its tail.
- The real smoke did not alter schema.

## Real smoke coverage and limits

- Passed: real generation, streaming completion, candidate persistence/refresh, and application/body verification.
- Not available as a dedicated real smoke scenario: stop, same-key retry, duplicate application, and revision conflict. `scripts/smoke-real-llm.mjs` only exercises the golden generation/apply path; the local HTTP suite covers those scenarios against the deterministic provider. No claim is made that those four variants were exercised against a real provider in this slice.

## Concerns

- The checkout began dirty with pre-existing candidate-lifecycle/schema/migration work in the same files. This slice preserves it; its commit stages only the focused module/extraction/test/report work and does not include unrelated existing changes.
- Vitest reports existing Vite configuration deprecation warnings (`configLoader: native` and `vite-tsconfig-paths`); they do not fail the required checks.

---

## Fix round 1 — review corrections (2026-08-13)

### Corrected contracts

- Restored the frozen V1.2 insertion contract from `docs/release-report-v1.2.md`: insertion uses non-empty client-supplied text, including partial author edits. It no longer substitutes persisted candidate content when the client omits text.
- Restored duplicate insertion to `400` through `CandidateAlreadyAppliedError`; an applied candidate no longer returns a successful `alreadyApplied` response and client-text validation is performed before that duplicate status is checked.
- Preserved target/range/expectedContent/force validation and candidate owner/status/base-revision/race guards. Concurrent applies now have one successful mutation and one `400` or `409`, without a second body write.
- Removed the unapproved `status` field from chapter `done` SSE events. The event is again `{ type: "done", messageId }`.
- Added DB-backed chapter HTTP coverage for exact stopped persistence, same-key reuse row counts, concurrent same-key row counts, and stale-generation recovery. The stale test marks an existing candidate old, verifies same-key retry reports terminal failure after recovery, and verifies a new key creates exactly one fresh user/candidate pair.

### Schema baseline clarification

This slice does **not** add schema or migrations. `revision`, `generationKey`, `baseRevision`, `requestHash`, and `updatedAt` are pre-existing dirty working-tree baseline prerequisites supplied by earlier user changes. Slice 3 consumes those fields; it is not self-contained from a clean pre-baseline commit, and no schema/migration path is staged by either Slice 3 commit.

### Fix-round verification

Executed from `C:\zcode\novel-ai\app`:

```text
npx vitest run tests/http/chapter-continuation.test.ts
PASS: 1 file, 30 tests.

npx vitest run tests/unit/chapter-replay.test.ts tests/unit/chapter-candidate-lifecycle.test.ts tests/http/chapter-continuation.test.ts
PASS: 3 files, 47 tests.

npx tsc --noEmit
PASS: exit 0.

npm run build
PASS: Next.js production build; compiled, TypeScript, and 42 static pages completed.

npx drizzle-kit check
PASS: Everything's fine.

node scripts/smoke-real-llm.mjs
PASS: real one-api generation, SSE 31 deltas/done, persistence/refresh, and client-text apply/body verification. Candidate messageId=10312; reply=195 chars; resulting body=225 chars.
```

### Real-smoke limitation

`smoke-real-llm.mjs` covers only the real-provider happy path (generate, persist, refresh, apply). It does not deterministically drive stop, same-key retry, duplicate apply, stale recovery, concurrent generation, or revision conflict. Those behaviors are verified against the real local test database through the HTTP harness; they are not claimed as real-provider smoke coverage.
