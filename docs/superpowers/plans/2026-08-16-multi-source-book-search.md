# Multi-Source Book Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MoZhou's book-source search return verifiable results from Qidian, Fanqie, Qimao, and JJWXC, while rejecting malformed Fanqie metadata and preserving explicit degraded states.

**Architecture:** Keep ranking ingestion separate from interactive search. The search route will call a small provider registry; each provider uses its verified official search endpoint, parses only metadata, and returns a provider-local degraded result on failure. The pipeline will prefer live multi-source results, fall back to the local ranking index only when live sources return nothing, and never fabricate production results.

**Tech Stack:** Next.js 16 route handlers, Node.js `fetch`, TypeScript, Vitest, existing Fanqie `a_bogus` signer.

## Global Constraints

- Do not change UI styling in this batch; settings routing and dialog polish remain Batch 2.
- Use only Qidian, Fanqie, Qimao, and JJWXC official/public metadata endpoints.
- Do not fetch or expose chapter正文 in interactive source search.
- Any provider timeout, anti-bot page, malformed response, or PUA metadata must be represented by `degraded`; never substitute fixed production examples.
- Keep the existing local ranking-index fallback and shelf import contract working.

### Task 1: Freeze provider contracts with failing tests

**Files:**
- Create: `app/tests/unit/source-providers.test.ts`
- Modify: `app/tests/unit/fanqie-search.test.ts`

**Interfaces:**
- Tests will require `searchQidian`, `searchQimao`, and `searchJjwxc` to return `{ books, ok, degraded }`.
- Fanqie tests will require detail-page metadata to replace PUA title and author, and the API's `category` field to be accepted.

- [x] **Step 1: Add fixture-driven failing tests**

  Cover one valid result and one failure/empty response for each new provider. Add a Fanqie fixture where the search response contains PUA title/author and the detail response contains plain title/author/category.

- [x] **Step 2: Run the focused tests and verify the expected red state**

  Run: `npm test -- --run tests/unit/source-providers.test.ts tests/unit/fanqie-search.test.ts`

  Expected: FAIL because the three provider modules do not exist and Fanqie does not decode author/category metadata.

### Task 2: Implement the four source adapters

**Files:**
- Create: `app/lib/search/qidian.ts`
- Create: `app/lib/search/qimao.ts`
- Create: `app/lib/search/jjwxc.ts`
- Modify: `app/lib/search/fanqie.ts`

**Interfaces:**
- Each provider exports a `searchX(query: string)` function with a typed outcome and a bounded timeout.
- Qidian uses `https://m.qidian.com/search?kw=...` and extracts book id, title, author, category, status, and official URL from mobile SSR HTML.
- Qimao uses `https://www.qimao.com/api/search/result?keyword=...&page=1&page_size=15` and extracts `book_id`, `title`, `author`, `category2_name`, `is_over_txt`, and `read_url`.
- JJWXC uses `https://www.jjwxc.net/search/search_ajax.php?action=search&keywords=...&type=1&version=1&getfull=1` and extracts novel id, name, author, and official book URL.
- Fanqie keeps its signed search endpoint, but detail fallback must decode title/author/category together and reject unresolved PUA titles instead of returning damaged text.

- [x] **Step 1: Implement the minimal parser and timeout behavior for Qidian**
- [x] **Step 2: Implement the minimal JSON adapter for Qimao**
- [x] **Step 3: Implement the minimal JSON adapter for JJWXC**
- [x] **Step 4: Update Fanqie detail decoding and category-field handling**
- [x] **Step 5: Run the provider tests and keep them green**

  Run: `npm test -- --run tests/unit/source-providers.test.ts tests/unit/fanqie-search.test.ts`

### Task 3: Replace the single-source route path with a provider registry

**Files:**
- Modify: `app/lib/source/engine.ts`
- Modify: `app/lib/search/pipeline.ts`
- Modify: `app/app/api/v1/search/route.ts`
- Create: `app/tests/unit/source-engine.test.ts`

**Interfaces:**
- `searchSources(query)` fans out to all four providers with `Promise.all`, maps all valid books to the existing `SourceResult` contract, and reports partial failure without hiding valid results.
- `decide(query, localHits, sourceOutcome)` returns live source results when available, local-index results when live sources are empty, and a degraded empty response when both are unavailable.
- `SOURCE_PROVIDER=mock` remains test-only and never runs in production.

- [x] **Step 1: Add a failing source-engine test for four-source fan-out and partial degradation**
- [x] **Step 2: Run the source-engine test and verify it fails**
- [x] **Step 3: Wire the four adapters into `searchSources` and add `bookId` to `SourceResult`**
- [x] **Step 4: Update the pipeline and route to consume the registry**
- [x] **Step 5: Run source-engine, pipeline, and route-adjacent tests**

### Task 4: Verify the functional boundary

**Files:**
- Modify: `app/components/features/search-view.tsx` only if the new `bookId` is required for stable result keys; no visual redesign.
- Modify: `docs/mozhu-commercial-readiness-final-2026-08-12.md` only if the current source statement is now factually stale.

- [x] **Step 1: Run focused unit tests**

  Run: `npm test -- --run tests/unit/source-providers.test.ts tests/unit/fanqie-search.test.ts tests/unit/source-engine.test.ts tests/unit/search-pipeline.test.ts`

- [x] **Step 2: Run TypeScript validation**

  Run: `npx tsc --noEmit`

- [x] **Step 3: Run the production build**

  Run: `npm run build`

- [x] **Step 4: Re-run the real read-only probes for Qidian, Fanqie, Qimao, and JJWXC**

  Record only status, result count, metadata quality, and provider degradation; do not save or commit fetched content.

- [x] **Step 5: Leave UI Batch 2 untouched and report that deployment is not performed in this source-fix pass**
