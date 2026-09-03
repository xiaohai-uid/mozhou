# MoZhou Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v0.1 Technical Preview safe to distribute, remove false-success behavior, and connect the primary draft flow to real book context.

**Architecture:** Harden the existing Vite same-process API rather than replacing it. Add one server security boundary, one server draft-context adapter, make release surfaces truthful, and extend existing Vitest/CI gates. Preserve the current package boundaries and local-first design.

**Tech Stack:** TypeScript 5.5, Node 22 HTTP, Vite 6.4.3, React 18, Vitest 2.1, Tauri 2, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-release-hardening-design.md`

## Global Constraints
- No unrelated refactor or directory restructure.
- Production/local launcher binds to loopback by default.
- Placeholder success responses are forbidden.
- Existing core contracts stay typed; no `any` escape hatches.
- Every behavioral fix begins with a failing test.

---

### Task 1: HTTP boundary RED/GREEN

**Files:**
- Create: `apps/web/server/security.ts`
- Modify: `apps/web/server/router.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Produces `assertTrustedRequest(req): void` and `readJsonBody(req, maxBytes?): Promise<Record<string, unknown>>`.

- [ ] Add tests that start the real HTTP middleware and assert an untrusted `Host` returns 403, a foreign `Origin` returns 403, malformed non-empty JSON returns 400, and a body over 1 MiB returns 413.
- [ ] Push tests alone and confirm PR CI fails for the expected missing behavior.
- [ ] Implement `security.ts` with loopback host/origin checks and bounded body parsing. Throw typed HTTP errors carrying status/code.
- [ ] Update `ApiRouter.dispatch` to run the boundary before routing and map typed errors to explicit JSON status responses.
- [ ] Re-run CI and require the new tests plus the existing API suite to pass.

### Task 2: Distribution exposure RED/GREEN

**Files:**
- Modify: `scripts/launcher.mjs`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `src-tauri/tauri.conf.json`
- Test: `apps/web/src/release-config.test.ts`

**Interfaces:**
- Launcher default host is exactly `127.0.0.1`.
- Compose publishes only the user-facing app by default; legacy infrastructure is profile-gated/internal.
- Tauri `app.security.csp` is non-null.

- [ ] Add a text/config regression test reading these files and asserting loopback default, no default publication of PostgreSQL/Crawl4AI/one-api, absence of fixed production secrets, and non-null CSP.
- [ ] Push tests and observe failure.
- [ ] Change launcher default host to `127.0.0.1`; keep explicit `HOST=0.0.0.0` possible for intentional LAN/container use.
- [ ] Put `crawl4ai`, `postgres`, `one-api`, and legacy `app` behind a `legacy-infra` profile; remove their host `ports` in favor of `expose`; remove fixed secrets/default passwords and require env inputs for profile use.
- [ ] Set a restrictive Tauri CSP: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.deepseek.com https://api.openai.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- [ ] Require CI green.

### Task 3: Truthful backup/membership/progress RED/GREEN

**Files:**
- Modify: `apps/web/server/routes/systemRoutes.ts`
- Modify: `apps/web/src/workbench/WorkbenchView.tsx`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- `/api/cloud-sync.backup` returns `501`, `{ok:false, code:'BACKUP_NOT_IMPLEMENTED'}` until a real artifact writer exists.
- `/api/membership` returns `license:null` and marks paid plans unavailable in Technical Preview.
- `/api/membership.activate` returns `501`, `LICENSE_ACTIVATION_NOT_IMPLEMENTED`.

- [ ] Replace existing success-oriented tests with behavior tests asserting explicit unavailability and absence of fabricated digest/path/license.
- [ ] Add UI test that hard-coded `3,420 / 4,000` and `连更12天` are absent.
- [ ] Push tests and observe failure.
- [ ] Implement the truthful 501/null responses and remove the fake progress badge.
- [ ] Require CI green.

### Task 4: Skill contract + chapter index RED/GREEN

**Files:**
- Modify: `apps/web/src/workbench/DialogueStream.tsx`
- Modify: `apps/web/src/workbench/WorkbenchView.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/server/routes/pipelineRoutes.ts`
- Test: `apps/web/src/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Request field is named `activeSkills` end-to-end.
- `DialogueStream` receives `chapterIndex: number` instead of hard-coding `1`.

- [ ] Add API test proving `activeSkills:['suspense']` changes the emitted `start.prompt` to include the suspense constraint.
- [ ] Add component test proving a non-1 chapter index is posted to `/api/draft.stream` and propagated to the quality panel/request surface.
- [ ] Push tests and observe failure.
- [ ] Rename the UI payload field from `skills` to `activeSkills` and thread `chapterIndex` as a prop/state value through App/Workbench/Dialogue.
- [ ] Keep initial selected chapter at 1 for compatibility, but make it mutable/contractual rather than embedded inside request code.
- [ ] Require CI green.

### Task 5: Real draft ContextPacket RED/GREEN

**Files:**
- Create: `apps/web/server/draftContext.ts`
- Modify: `apps/web/server/routes/pipelineRoutes.ts`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**
- Produces `buildDraftContext({root, chapterIndex, prompt}): Promise<ContextPacket>`.
- The packet must contain book/chapter structural context and available canon/entity/recent-prose context; `runDraftStep` receives this packet.

- [ ] Add API regression test creating a book with an entity card and chapter prose, call `/api/draft.stream` in mock-provider mode, and assert the start/debug surface or persisted receipt proves the entity/book context entered compilation rather than `structural=[]/settings=[]/story=''`.
- [ ] Push tests and observe failure.
- [ ] Implement `draftContext.ts` using existing `readBookRecord`, `readCanonState`, entity cards/recent prose, and context-compiler assembly/compile primitives. Use a deterministic local tokenizer adapter based on UTF-8/codepoint count only if the existing exact tokenizer contract supports it; otherwise consume the repository's existing tokenizer utility.
- [ ] For brand-new books with no recallable cards, return a minimal structural packet that explicitly contains book title/chapter/task and recent prose; do not claim a Receipt-driven recall occurred.
- [ ] Pass the built packet to `runDraftStep` and use `packet.text` as the upstream user content.
- [ ] Require CI green.

### Task 6: Long-form benchmark evidence

**Files:**
- Create: `packages/benchmark/fixtures/long-novel-50.json`
- Create: `packages/benchmark/src/long-novel.test.ts`

**Interfaces:**
- Fixture encodes at least 50 chapter positions and includes a secret reveal boundary, expired fact, dead-character state, due promise, and retroactive upstream change affecting later chapters.

- [ ] Add a failing benchmark test that runs generated continuity assertions across representative chapter checkpoints and asserts secret leak/expired/dead/promise rules plus deterministic change-impact expectations.
- [ ] Implement the fixture/helper data needed by the existing benchmark engine without adding a new runtime subsystem.
- [ ] Require package benchmark tests green.

### Task 7: CI/release security gates

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Create: `.github/workflows/codeql.yml`

**Interfaces:**
- CI runs `pnpm audit --audit-level high` (or an equivalent lockfile-aware audit command that is supported by the pinned pnpm), CodeQL scans JS/TS, release assets get a SHA-256 manifest.

- [ ] Add workflow syntax/config regression assertions if an existing repository test pattern exists; otherwise treat workflow YAML as configuration exception to TDD.
- [ ] Add CodeQL workflow with least required permissions.
- [ ] Add dependency audit step to CI without suppressing failures.
- [ ] Add release step `sha256sum release-artifacts/* > release-artifacts/SHA256SUMS.txt` and publish the manifest.
- [ ] Pin new third-party workflow actions to stable major versions consistent with the repository's current policy; do not add write permissions to CI.

### Task 8: Final verification and PR

**Files:** none unless verification exposes a scoped defect.

- [ ] Compare branch against `master` and confirm only planned files changed.
- [ ] Confirm PR CI has successful build/test/typecheck/web build/security jobs for the final head SHA.
- [ ] Review the PR diff for secrets, mock/fake success strings, `HOST || '0.0.0.0'`, `csp:null`, `chapterIndex:1` inside draft request code, and `skills:selectedSkills`.
- [ ] Mark the PR ready only when every blocking check is green; otherwise leave it unmerged with the exact remaining blocker documented.
