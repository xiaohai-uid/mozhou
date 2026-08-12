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
