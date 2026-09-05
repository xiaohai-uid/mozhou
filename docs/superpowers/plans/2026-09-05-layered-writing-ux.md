# Layered Writing UX Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth isolated UX prototype variant D that preserves MoZhou's original product model while reducing constant visual competition through layered information disclosure.

**Architecture:** Extend the existing throwaway `UxGoldenPathPrototype` rather than touching production UI. Variant D owns a local state machine for Candidate → Accepted → Committed and a contextual Inspector; all global capabilities live in a secondary drawer. Existing Ink Orbit tokens and the already-gated DEV-only prototype entry remain unchanged.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Ink Orbit CSS tokens.

**Spec:** `docs/superpowers/specs/2026-09-05-layered-writing-ux-design.md`

## Global Constraints

- Work only in `C:\zcode\novel-ai-ux-golden-path-prototype`.
- Do not modify `master`, production backends, package manifests, or dependencies.
- Preserve A/B/C; add D as the new experiment.
- Candidate must not mutate manuscript before explicit accept.
- Accepted must remain distinguishable from durable Committed.
- Keep all 17-ish global capabilities reachable through a secondary drawer, not permanently visible.
- Verify at 1440×1000 and 1280×900 in real Chrome.

---

### Task 1: Lock the D-state contract with tests

**Files:**
- Create: `apps/web/src/prototype/UxGoldenPathPrototype.test.tsx`
- Modify: `apps/web/src/prototype/UxGoldenPathPrototype.tsx`

**Interfaces:**
- Consumes: existing DEV-only `?prototype=ux-golden-path` entry.
- Produces: variant `D`, `data-prototype-phase`, explicit Candidate/Accepted/Committed labels, “全部能力” drawer.

- [ ] **Step 1: Write failing tests** for D default shell, candidate non-mutation, accept-not-commit, explicit commit, contextual Inspector, and capability drawer.
- [ ] **Step 2: Run** `pnpm --filter @mozhou/web test -- UxGoldenPathPrototype.test.tsx` and confirm RED.
- [ ] **Step 3: Add only the minimal state/types/labels** needed to make the contract representable.
- [ ] **Step 4: Re-run targeted tests** and confirm GREEN.

### Task 2: Implement the layered D layout

**Files:**
- Modify: `apps/web/src/prototype/UxGoldenPathPrototype.tsx`
- Modify: `apps/web/src/prototype/ux-golden-path-prototype.css`

**Interfaces:**
- Consumes: D state contract from Task 1.
- Produces: project-context rail, low-weight 8-stage strip, chapter canvas, contextual Inspector, capability drawer.

- [ ] **Step 1: Implement left project-context rail** with current book, chapters, story context, and secondary capability entry.
- [ ] **Step 2: Implement central writing surface** with prose, author intent, candidate card, AI dock, accepted/committed status.
- [ ] **Step 3: Implement contextual Inspector** with Quality / Story / Context / Impact tabs and auto-focus on Quality after candidate generation.
- [ ] **Step 4: Implement compact eight-stage pipeline** whose active state follows prototype phase.
- [ ] **Step 5: Implement capability drawer** containing global functions without keeping them visible during writing.
- [ ] **Step 6: Add 1280px rules** that preserve three-region readability without clipping.
- [ ] **Step 7: Run targeted tests** again.

### Task 3: Real-browser UX verification

**Files:**
- No production files.
- Temporary screenshots only under `C:\zcode\tmp`.

**Interfaces:**
- Consumes: variant D URL.
- Produces: evidence for the 9-step golden task at two desktop sizes.

- [ ] **Step 1: Build** `pnpm --filter @mozhou/web build`.
- [ ] **Step 2: Run all web tests** `pnpm --filter @mozhou/web test`.
- [ ] **Step 3: Start/reuse Vite dev server** on `127.0.0.1:4175`.
- [ ] **Step 4: In real Chrome at 1440×1000**, execute generate → inspect context → accept → commit → capability drawer → save/refresh.
- [ ] **Step 5: Repeat at 1280×900** and capture screenshots.
- [ ] **Step 6: Check console/page errors**; fix only prototype-owned defects and repeat verification.

### Task 4: Isolated checkpoint

**Files:**
- All above.

- [ ] **Step 1: Run** `git diff --check` and `git status --short`.
- [ ] **Step 2: Run secret scan** on the isolated worktree.
- [ ] **Step 3: Commit only the Spike** with message `prototype(ux): preserve novel-os model with layered disclosure`.
- [ ] **Step 4: Do not push or merge.** Open variant D in the user's local browser for direct evaluation.
