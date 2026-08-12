# Task 2 Report — Slice 2: unified model transport and compression adapter

Date: 2026-08-13

## Delivered

- Added `app/lib/chat/llm-transport.ts`, the single one-api transport implementation for completion and streaming requests.
- Moved one-api URL/token lookup, request construction, JSON parsing, SSE parsing, and bounded/redacted transport error normalization into that module.
- Converted `stream-provider.ts` into an adapter from `LlmTransport.stream()` to the existing pipeline `StreamProvider` seam; payload observation/capture behavior remains at that seam.
- Changed `compressHistory(messages, completionAdapter)` to use only its injected completion adapter. `compress.ts` no longer contains fetch calls, environment reads, provider selection, or mock behavior.
- Both independent and chapter chat create one transport per request, send that same instance to compression and to `makeChatProvider` for streaming.
- Preserved `PreparedChatRequest`, system/message construction, SSE events, persistence, candidate lifecycle behavior, compression threshold, `KEEP_RECENT`, summary limit, kept-history validation, and fail-open behavior.

## Tests added or updated

- `tests/unit/llm-transport.test.ts`
  - completion uses `stream: false`, shared endpoint/auth, response usage parsing
  - streaming uses `stream: true`, shared endpoint/auth, SSE parsing
  - empty choices, non-2xx error JSON, bounded token-redacted errors, and network error normalization
- `tests/unit/compress-adapter.test.ts`
  - injected completion adapter is used with no direct compression fetch
  - completion failure fails open with kept history
- `tests/unit/compress.test.ts`
  - migrated existing compression expectations to injected fake adapters
- `tests/unit/payload-observer.test.ts`
  - supplied the transport explicitly to the stream adapter seam

## Verification

The plan-specified command was attempted first:

```powershell
npm test -- --runInBand tests/unit/llm-transport.test.ts tests/unit/compress-adapter.test.ts
```

It failed before running tests because Vitest 4.1.10 does not support Jest's `--runInBand` flag. The equivalent repository-supported serial invocation was used:

```powershell
npm test -- tests/unit/llm-transport.test.ts tests/unit/compress-adapter.test.ts tests/unit/compress.test.ts tests/unit/payload-consumer.test.ts --maxWorkers=1 --fileParallelism=false
```

Result: 4 files, 26 tests passed.

```powershell
npx tsc --noEmit
```

Result: exit 0.

```powershell
npm run build
```

Result: exit 0; Next.js 16.3.0 production build completed and generated 42 static pages.

```powershell
git diff --check
```

Result: exit 0.

## Payload behavior

- The transport inserts the existing `PreparedChatRequest.system` as one system message before the unchanged request messages.
- Completion and streaming calls use the same base URL, token, `/v1/chat/completions` endpoint, model request shape, and error normalization.
- The completion adapter receives the existing fixed summary prompt and early history; compression prefixes a non-empty returned summary with `（历史摘要）` and preserves the original recent suffix.
- If completion fails, returns empty choices, or returns unusable output, compression returns no summary and both consumers send full history plus the existing exactly-one final current user message.

## Smoke status and concerns

- Real one-api compression/streaming smoke was not run. `.env` contains a non-empty localhost one-api configuration and token, but a 3-second TCP probe of the configured endpoint timed out. The local gateway must be started or `ONEAPI_BASE_URL` changed to a reachable gateway before running `node scripts/smoke-real-llm.mjs` or a dedicated compression smoke.
- Vitest emits existing configuration deprecation warnings (`configLoader: native` and `vite-tsconfig-paths`) even though the tests pass; this task did not alter test infrastructure.
- `lib/novels/chapter-chat.ts` was already dirty with unrelated Slice 3 candidate-lifecycle work. Only the Slice 2 import, one transport construction, injected completion call, and injected stream adapter call are included in this task commit.

## Review-fix addendum — selected model and real smoke

Date: 2026-08-13

### Fixed finding

`compressHistory` no longer imports or selects `DEFAULT_MODEL`. Its contract is now:

```ts
compressHistory(messages, completionAdapter, model)
```

Both independent and chapter consumers pass their selected `input.model`, which is also the model in their `PreparedChatRequest` streaming path. This keeps completion and streaming on the same model while preserving the existing summary prompt, summary prefix/limit, kept-history validation, current-user/system construction, and fail-open behavior. `compress.ts` still has no direct `fetch`, environment lookup, or provider selection.

### Regression test

`tests/unit/compress-adapter.test.ts` adds a non-default `glm-4.5-flash` case using one fake one-api transport for both operations. It asserts the completion request has `{ model: "glm-4.5-flash", stream: false }` and the stream request has `{ model: "glm-4.5-flash", stream: true }`.

### Smoke recovery and evidence

The first raw `TcpClient` probe against the configured `http://localhost:3001` reported `TCP connect timeout after 3000ms`, but repository inspection showed the configured `mozhou-one-api` Docker container was running and mapped `0.0.0.0:3001->3000/tcp`.

The recoverability probe used the configured non-empty token without printing it:

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3001/v1/models' -Headers @{ Authorization = "Bearer <configured token>" } -TimeoutSec 15
```

Result: HTTP 200, body length 723.

The existing harness was then run unchanged:

```powershell
node scripts/smoke-real-llm.mjs
```

Result: exit 0. It started Next on port 51020, received `start/delta×33/done` in 5373ms, persisted the 208-character candidate, and inserted it so the chapter became 238 characters. The harness reported `A1 SMOKE: PASS`.

An additional real transport probe, with no prompt/completion text logged, ran `compressHistory` and the streaming adapter through the configured one-api transport:

```powershell
@'...real transport compression + stream probe...'@ | npx tsx -
```

Result: exit 0, `{"compression":"ok","kept":6,"stream":"ok","delta_count":2}`.

### Review-fix verification

```powershell
npm test -- tests/unit/llm-transport.test.ts tests/unit/compress-adapter.test.ts tests/unit/compress.test.ts tests/unit/payload-consumer.test.ts tests/unit/payload-observer.test.ts --maxWorkers=1 --fileParallelism=false
```

Result: 5 files, 31 tests passed.

```powershell
npx tsc --noEmit
npm run build
git diff --check
```

Result: all exit 0; Next.js 16.3.0 production build completed and generated 42 static pages.

### Remaining concerns

- Vitest retains existing Vite configuration deprecation warnings; no test infrastructure was changed.
- The worktree still contains unrelated dirty Slice 3/candidate-lifecycle and product work. The follow-up commit stages only this selected-model fix, its regression tests, and this report addendum.
