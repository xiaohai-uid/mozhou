# Product-State & UX Reliability Baseline — 2026-08-18

Task 0 evidence note for `mozhou-product-state-ux-reliability-implementation-plan.md`.
Contains only file paths, symbol names, route names, state locations, failure observations, test names, and sanitized error classes. No user content or secrets.

## 0.1 Working tree baseline

- Branch: `main`
- HEAD: `39910d0333c5f292efc7b5a626c992c596c24ad5`
- Node: `v22.23.2`
- npm: `10.9.8`
- `git status --short`: **not clean** — large pre-existing working-tree modification set (repo docs, `.scratch/`, `app/` source/tests, `app/lib/story/vendor/oh-story/**`, `app/package.json`/lock). Do not discard; treat as current reality.
- Commands run from repo root for git; from `app/` for Node/npm/test/build.

## 0.2 Current-novel / create-novel flow

- Create-novel UI: `app/components/features/projects-view.tsx` → `createBook()`.
- Create-novel API: `app/app/api/v1/novels/route.ts` → `POST /api/v1/novels`.
- Create-novel service: `app/lib/novels/service.ts` → `quickStartNovel()`; response contains `{ novel: { id }, chapter: { id } }`.
- Post-create navigation: `projects-view.tsx` `router.push('/chapter/${chapter.id}?novelId=...&novel=...&ch=...&title=...')`.
- Workbench current-novel state: `app/components/features/workbench-view.tsx`
  - `useState<number | null>(null)` `activeNovelId`
  - `useState<NovelSummary[]>` `novels`
  - `loadNovel(novelId)` sets `activeNovelId` when user selects.
  - `GET /api/v1/novels` loads list on mount but **never auto-selects** `activeNovelId`.
  - Visible labels: `SectionLabel` `Current Work`, `当前作品`, `还没有作品`, `未选择`.
- Persistence mechanism for current novel selection: **none found** — no `localStorage`/`sessionStorage`/cookie/URL key for current-work selection. `sessions.novelId` exists but is session binding, not current-novel selection.
- Likely P0-A root-cause candidate: create success returns `novelId` and routes to chapter, but nothing writes that id into an existing current-novel source; Workbench remounts with `activeNovelId = null`.

## 0.3 Workbench panel state

- Only Workbench component: `app/components/features/workbench-view.tsx`.
- Desktop sub-nav state: `railExpanded: "chapters" | "characters" | "worldviews" | null` (left-rail accordion). Buttons: `章节与大纲`, `人物关系`, `世界规则`.
- Main content renderer: **always the writing/chat panel**; there is no separate Outline/Characters/World main panel in the current component.
- Mobile state: `mobileTab: "write" | "chapters" | "story" | "tools"`; highlight and secondary content panel both derive from `mobileTab`.
- Current evidence: no independent nav-highlight vs main-panel state mismatch in `workbench-view.tsx`; the reported P0-B pattern is not reproduced in this component as of this baseline.

## 0.4 AI error path (chapter “AI 起笔”)

- Provider boundary: `app/lib/ai/provider-boundary.ts` — source classes `PUBLIC_FREE | PLATFORM_PAID | USER_BYOK | TEST_MOCK`; terminal codes `FREE_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `PROVIDER_NOT_CONFIGURED`, `TEST_MOCK_FORBIDDEN`.
- Error classification: `app/lib/novels/chapter-chat-errors.ts`
  - `ChapterChatErrorCode`: `FREE_UNAVAILABLE | AiNoApiKey | AiRateLimited | AiServerError | AiTimeout | AiNetworkError | AiInvalidResponse | AiCancelled | AiGenerationFailed`
  - `classifyChapterChatError(value)` → stable code.
- Service: `app/lib/novels/chapter-chat.ts` `runChapterChat()` → throws `ChapterChatError(code)` on non-stopped failure.
- SSE route: `app/app/api/v1/novels/[id]/chapters/chat/route.ts` → `writer.error({ type: "error", code, message })`.
- SSE contract/parser: `app/lib/chat/chapter-stream-contract.ts` → `parseChapterSseEvent()`, `classifyChapterStream()`.
- Client state: `app/components/features/chapter-editor-view.tsx` → `m.status = "error"`, `m.errorCode = data.code ?? "UNKNOWN"`.
- Visible copy: `humanizeError(code)` in `chapter-editor-view.tsx` (lines ~556-582) maps codes to title/guidance; already covers `AiNoApiKey/AiRateLimited/AiServerError/AiTimeout/AiNetworkError/AiInvalidResponse/FREE_UNAVAILABLE/PROTOCOL_ERROR/AiCancelled/ContentChanged/ChapterNotFound` + generic default `操作没有成功`.
- Retry handler in chapter editor: **missing** — failed assistant messages show humanized text but no one-click retry control.
- Workbench error path: `workbench-view.tsx` `send()` catches raw error and stores `setError(message)`; has a generic retry button only when `lastSentContent` is set; no structured error-class mapping.

## 0.5 Browser automation

- Existing E2E/browser harness: **none** (`@playwright/test` not in `app/package.json` dependencies; no project E2E convention found).
- Existing scripts: `app/scripts/smoke-real-llm.mjs` (real-provider smoke only); docs mention Playwright research but no repo E2E files.
- Decision per plan: add `@playwright/test` as a dev dependency and create a focused E2E spec.

## 0.6 Baseline commands & results

From `app/`:

- `npx tsc --noEmit` → **PASS** (exit 0).
- `npm test` (Vitest, unit + http):
  - After starting local Postgres on `127.0.0.1:5433` (`postgres:18-alpine`, `postgres://mozhou:mozhou_dev@localhost:5433/mozhou`) and `npm run db:migrate`:
  - **80/81 files passed; 476/477 tests passed**.
  - Failure: `tests/http/chapter-continuation.test.ts > 章节对话引擎（工单 17） > 断开请求（abort）→ assistant 候选精确持久化为 stopped` — expects `attemptStatus?.status` to be `"cancelled"`, received `undefined`. Looks timing/state related, unrelated to this plan’s four slices (recorded as pre-existing baseline failure).
- `npm run build` → **PASS** (Next.js production build, exit 0).

## Notes

- All four slices start from the evidence above; no production code was changed during Task 0.

---

# Task 1-6 outcome summary (same date)

## P0-A Current novel state consistency

- Root cause: `WorkbenchView` loaded `/api/v1/novels` but never resolved/selected a current novel; create flow routed to chapter without writing the new id to any current-novel source.
- Fix:
  - New `app/lib/novels/current-novel.ts` — `resolveCurrentNovelId`, `readCurrentNovelId`, `writeCurrentNovelId` (localStorage key `mozhou:current-novel-id`).
  - `app/components/features/projects-view.tsx` — after successful create, `writeCurrentNovelId(data.novel.id)`.
  - `app/components/features/workbench-view.tsx` — auto-resolve persisted/fallback current novel after novels+sessions load; `loadNovel()` persists the selected id.
- Tests:
  - `app/tests/unit/current-novel.test.ts` (4 tests)
  - `app/tests/e2e/product-state-current-novel.spec.ts` (4 tests: first novel current, switch persistence, refresh, delete fallback)
- Browser evidence: 4/4 passed.

## P0-B Workbench panel state consistency

- Not reproduced in current component: `railExpanded` is the single source for desktop sub-nav highlight and expanded list; `mobileTab` is the single source for mobile.
- Added regression `app/tests/e2e/workbench-panel-state.spec.ts`; 1/1 passed. No production change for this slice.

## P0-C AI error UX and retry

- Backend already emitted structured SSE `error.code`; chapter editor already humanized codes.
- Gap: no one-click retry on failed assistant messages.
- Fix:
  - New `app/lib/chat/user-facing-error.ts` — `toUserFacingAiError()` pure mapper (kind/title/guidance/retryable).
  - `app/components/features/chapter-editor-view.tsx` — use mapper; add `retryMessage()` and visible `重新尝试` button for retryable errors.
- Tests:
  - `app/tests/unit/user-facing-error.test.ts` (5 tests)
  - `app/tests/e2e/ai-error-retry.spec.ts` (2 tests: network retry success, FREE_UNAVAILABLE copy)
- Browser evidence: 2/2 passed.

## P1-D Intermittent navigation

- Added `app/tests/e2e/navigation-first-click.spec.ts`: 30 iterations × 2 routes (`书源搜索`, `书源书架`), real AppShell clicks.
- Result: **NOT_REPRODUCED_CURRENT_BUILD** — 30/30 passed.
- Dev-server-only Turbopack HMR “conflicting effects” noise was observed; it did not affect navigation assertions.

## Task 5 Golden Journey

- Added `app/tests/e2e/golden-journey.spec.ts`; 1/1 passed.
- Covers register → create → current novel → Workbench panels → chapter entry → AI failure/retry → leave/return → refresh → resource nav.
- During this journey a real Workbench bug was found and fixed: chapter links were `/chapter/:id` without `novelId` query params, so the chapter page could not load body/chat. Fixed in `workbench-view.tsx` by emitting the same query params as Projects (`chapterHref`).

## Task 6 Final gates (as-run)

- `npx tsc --noEmit` → PASS
- `npx vitest run tests/unit` → PASS (60 files / 314 tests)
- `npx playwright test` → PASS (9 E2E tests)
- `npm run build` → PASS
- `npm test` (full unit+http): 82/83 files, 484/486 tests passed; 2 intermittent failures in `tests/http/chapter-continuation.test.ts` (payload-observer race and abort attempt-status timing). Both pass in isolation; pre-existing test-suite flakiness, not caused by these slices.
- `git diff --check`: repo-wide reports pre-existing CRLF/trailing-whitespace noise in already-modified files; our new files have no such issues.

## Remaining known issue (outside the four slices)

- Turbopack dev server logs repeated `FATAL: conflicting effects for the same key` during long E2E runs. Tests pass; appears dev-only HMR noise, not user-facing in production build.
