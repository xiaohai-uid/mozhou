# Task 1 Report — Slice 1: Unified Writing Context Module

## Status

Completed. Slice 1 centralizes writing system-section rendering and final message/current-user construction without changing the provider, SSE, database schema, or compression transport.

## Files Changed

- `app/lib/chat/writing-context.ts`
  - Added the shared `buildWritingContext` builder returning the existing `PreparedChatRequest`.
  - Moved `BASE_IDENTITY`, independent/chapter mode contracts, canonical section ordering, rendering, and current-user normalization here.
- `app/lib/chat/stream-provider.ts`
  - Removed system-prompt/context assembly; it now remains provider transport/adapters only.
- `app/lib/chat/service.ts`
  - Migrated independent chat to collect validated facts and call `buildWritingContext` before `makeChatProvider`.
- `app/lib/novels/chapter-chat.ts`
  - Migrated chapter chat to collect validated facts and call `buildWritingContext` before `makeChatProvider`.
- `app/tests/unit/writing-context.test.ts`
  - Added seven contract tests for canonical sections, optional omissions, system/history separation, both modes, current-user normalization, owner scope, and the existing request shape.

## Test-first Evidence

1. Added `tests/unit/writing-context.test.ts` before implementation.
2. Ran `npm test -- tests/unit/writing-context.test.ts` before adding the module.
   - Expected failure: `Cannot find package '@/lib/chat/writing-context'`.
3. Implemented the smallest builder and ran the focused test again.
   - Passed: 7/7 tests.

## Verification Commands and Outputs

| Command | Output |
| --- | --- |
| `npm test -- tests/unit/writing-context.test.ts` | Passed: 1 file, 7 tests. |
| `npm test -- tests/unit/writing-context.test.ts tests/unit/payload-consumer.test.ts` | Passed: 2 files, 18 tests. |
| `npm run typecheck` | Not available in this checkout (`Missing script: "typecheck"`). |
| `npx tsc --noEmit` | Passed with exit code 0. |
| `npm run build` | Passed: Next.js 16.3.0 production build compiled, typechecked, and generated 42 static pages. |

The plan-provided `--runInBand` flag is unsupported by this repository's Vitest 4.1.10 CLI, so the same target files were run using the supported Vitest invocation above.

## Behavior Preservation

- Both consumers still use `makeChatProvider` and the existing `PreparedChatRequest` seam.
- Provider, SSE, database writes, ownership checks, RAG/style/skill fact collection, and compression call placement remain consumer/domain responsibilities.
- Compression transport was not changed.
- The final `messages` array is normalized as replayable history followed by exactly one final user message; current user content is not appended as a context section.
- System sections now render in one canonical order: `base_identity`, `mode_contract`, `owner_context`, `chapter_reference`, `selection`, `style`, `skill`, `compression_summary`.

## Concerns

- The repository lacks the requested `typecheck` npm script; `npx tsc --noEmit` was used as its direct equivalent.
- Vitest emits pre-existing configuration deprecation warnings about native config loading and `vite-tsconfig-paths`; tests still pass.
- The worktree contains unrelated uncommitted changes, including broader chapter candidate-lifecycle work in `chapter-chat.ts`. The Slice 1 commit stages only the context-builder migration and preserves those unrelated changes unstaged.

## Review Fix — 2026-08-13

### Fixed Findings

1. `buildWritingContext` no longer relies only on object identity to normalize a current-user entry present in history. `WritingContextInput` now accepts an optional `currentUserHistoryIndex` as the safe discriminator for a structurally equal but separately allocated history entry. The builder removes that indexed copy and appends one final `{ role: "user", content }` message. It continues to preserve earlier legitimate identical user messages when no discriminator is supplied.
2. Removed the redundant chapter `extra` context-assembly list. The existing `ChapterChatResult.injected` output is now derived from the structured `contextSections`, preserving its prior RAG-first ordering and excluding only the owner-context entries already represented by `ragLines`.

### Test-first Evidence

Added the focused test `removes a structurally equal current user copy while preserving different replayable history` before the implementation fix.

- Red: `npm test -- tests/unit/writing-context.test.ts` failed 1/8 because the separate `{ role: "user", content: "本轮请求" }` history entry remained before the final current user.
- Green: after adding `currentUserHistoryIndex`, the same command passed 8/8.

### Review Verification Commands and Outputs

| Command | Output |
| --- | --- |
| `npm test -- tests/unit/writing-context.test.ts tests/unit/payload-consumer.test.ts` | Passed: 2 files, 19 tests. These are direct `PreparedChatRequest` capture-seam tests for both `runChat` and `runChapterChat`; they assert final messages/current user and system sections. |
| `npm test -- tests/http/chat.test.ts tests/http/chapter-continuation.test.ts` | Passed: 2 files, 43 tests. The independent HTTP test observes a one-message provider payload and verifies the session DB/API message roles are exactly `["user", "assistant"]`; the chapter HTTP test observes a one-message payload with exactly one current user and verifies its persisted user/assistant records. |
| `node scripts/smoke-real-llm.mjs` | Passed against configured one-api and test database: chapter SSE `start/delta×35/done`, 203 generated characters, one persisted assistant message found after refresh (`messageId=9654`), and inserted chapter text persisted at 233 characters. |
| `npx tsc --noEmit` | Passed with exit code 0. |
| `npm run build` | Passed: Next.js 16.3.0 compiled, ran TypeScript, and generated 42 static pages. |

### External-check Scope

The real-provider harness covers the chapter consumer only. Independent chat has no corresponding real-provider smoke harness, so its strongest available evidence is the passing HTTP/DB suite plus the direct final-request capture seam tests above. No web review was run; that is intentionally left to the controller as instructed.
