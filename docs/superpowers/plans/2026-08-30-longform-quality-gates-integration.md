# Long-Form Literary Quality Gates Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不削弱 MoZhou 已有 Story Kernel / Context Compiler / Continuity Gate / ChapterCommit 确定性边界的前提下，把《长生者皆为薪柴》真实长篇生产中验证出的“文学质量审查、规则覆盖、失败记忆、期待兑现、记忆锚、版本绑定”能力产品化，并统一到 `apps/web + packages/*` 的 Novel OS 主线。

**Architecture:** 保持 `Continuity Gate` 纯机械、Canon 真相层不可被 LLM 裁决；把文学质量建成独立 `@mozhou/quality-engine`，由现有 `review` 步消费 exact draft + receipt + project quality policy，输出版本绑定的 `QualityReviewReport`。`review` 可因 blocking 规则失败而显式回炉 `draft`，但最多自动重写 2 次；所有规则、证据、用户纠错原因和历史失败都可追踪，且正文 revision/hash 改变后旧 PASS 自动失效。项目级质量规则不进入 Story Kernel，不把修仙文专属规则污染平台全局 Canon。

**Tech Stack:** TypeScript 5.5+, Node 22, pnpm workspace, Vitest, existing `@mozhou/kernel`, `@mozhou/data-plane`, `@mozhou/context-compiler`, `@mozhou/pipeline`, `@mozhou/runtime`, `@mozhou/flywheel`, React/Vite `apps/web`.

**Spec:** `docs/spikes/2026-08-29-longform-production-quality-cross-audit.md`

## Global Constraints

- `Continuity Gate` 继续只做确定性 Canon/Knowledge/Timeline/Dependency 核检；文学 LLM 判定不得进入 Canon 真伪判定。
- `ChapterCommit`、`TimelineEvent`、历史 commit 继续不可变；重写产生新 draft revision / 新 session / 新 commit，不覆盖旧提交。
- `Protected Author Content` 不得被自动改写；自动重写只能作用于当前 AI/shared draft，且必须由 pipeline 明确进入 rework 状态。
- 每个文学审查结果必须绑定 `chapterIndex + draftRevision + draftContentHash + receiptId + ruleSetDigest + reviewerBinding`；任一正文变化使旧结果 stale。
- blocking 文学规则最多自动重写 2 次；第三次仍失败即停止并交给作者，不允许无限 agent loop。
- 项目专属规则默认只作用于该书；平台默认规则与项目覆盖分层，禁止把《长生者》的题材规则写死进 kernel。
- `app/` 不再新增 Novel OS 核心能力；长期产品主线为 `apps/web + packages/*`。迁移必须保留现有用户数据导出/读取能力，不做破坏性删除。
- 所有新增行为先写失败测试，再做最小实现；不得通过削弱既有测试或把 semantic failure 静默降级为 pass 来完成任务。

---

## File Structure Decision

新增一个独立包，避免把文学软判断污染 Kernel：

```text
packages/quality-engine/
  package.json
  tsconfig.json
  src/types.ts                 # QualityRule / QualityPolicy / QualityReviewReport / evidence
  src/policy.ts                # 平台默认 + 项目覆盖加载、版本摘要
  src/deterministic.ts         # 可机械判断的文学规则
  src/semantic.ts              # 注入式 LLM reviewer，仅产生规则证据与 verdict
  src/review.ts                # 合并 deterministic + semantic，计算 blocking verdict
  src/staleness.ts             # exact draft revision/hash 绑定与 stale 判定
  src/failure-memory.ts        # 用户纠错原因 → FailurePattern 投影
  src/index.ts
```

Book 侧新增非 Canon、但可版本控制的作者质量策略：

```text
质量/quality-policy.yaml
质量/failure-memory.jsonl
质量/memory-anchors.jsonl
```

这些文件属于“作者规划/质量配置”，不进入 TemporalFact / KnowledgeState / TimelineEvent 五族，不参与 Canon 真伪折叠。

现有文件主要修改：

```text
packages/pipeline/src/steps.ts
packages/pipeline/src/session.ts
packages/pipeline/src/review-step.ts
packages/pipeline/src/index.ts
packages/runtime/src/domain-events.ts (若事件词表位于 kernel，则修改对应现有单一事实源)
packages/benchmark/src/metrics.ts
packages/benchmark/src/types.ts
packages/flywheel/src/evaluator/*
packages/kernel/src/kernel-schema.ts          # 仅 P1 KnowledgeState 认知层级扩展
packages/kernel/src/narrative-state.ts
apps/web/server/api.ts
apps/web/src/App.tsx
CONTEXT.md
docs/specs/chapter-pipeline-spec.md
docs/specs/data-flywheel-v1-spec.md
docs/adr/00xx-literary-quality-review-boundary.md
```

---

### Task 1: Freeze Product Authority and Contract Delta

**Files:**
- Create: `docs/adr/0025-literary-quality-review-boundary.md`
- Modify: `CONTEXT.md`
- Modify: `docs/specs/chapter-pipeline-spec.md`
- Modify: `README.md`
- Modify: `app/README.md` if present; otherwise create `app/LEGACY.md`

**Interfaces:**
- Consumes: current ten-step pipeline contract and `docs/spikes/2026-08-29-longform-production-quality-cross-audit.md`.
- Produces: one authoritative decision: Novel OS core development targets `apps/web + packages/*`; `app/` is legacy application surface and receives only migration/security/reliability fixes.

- [x] **Step 1: Write the ADR before code changes**

ADR decisions must state all of the following verbatim in substance:

```text
1. Continuity Gate remains deterministic and Canon-authoritative.
2. Literary Quality Review is a separate pre-Canon quality boundary.
3. The existing pipeline step id `review` is retained; its contract expands from “load draft for review” to “produce a version-bound QualityReviewReport”.
4. A blocking literary failure may drive an explicit review_rework edge back to `draft`.
5. Automatic review-driven rework is capped at 2 attempts per ChapterProductionSession; attempt 3 stops for author action.
6. `apps/web + packages/*` is the Novel OS product line. `app/` is legacy and must not receive new Story Kernel / quality-engine capabilities.
7. Project literary policy is not Canon and must not be stored as TemporalFact.
```

- [x] **Step 2: Update `chapter-pipeline-spec.md` review row**

Change step 4 semantics to:

```text
Review | exact draft + ContextReceipt + QualityPolicy | QualityReviewReport | provider unavailable=explicit refusal; blocking fail=review_rework eligible | QualityReviewCompleted
```

Do not change step 7 `Continuity Gate` semantics.

- [x] **Step 3: Document legacy-app boundary**

`README.md` must identify `apps/web` as Novel OS 2.0 UI and `app/` as legacy web app pending migration. Do not delete `app/` in this task.

- [x] **Step 4: Commit**

```bash
git add docs/adr/0025-literary-quality-review-boundary.md docs/specs/chapter-pipeline-spec.md CONTEXT.md README.md app/LEGACY.md
git commit -m "docs: freeze literary quality review boundary"
```

---

### Task 2: Add the Quality Rule and Report Domain Package

**Files:**
- Create: `packages/quality-engine/package.json`
- Create: `packages/quality-engine/tsconfig.json`
- Create: `packages/quality-engine/src/types.ts`
- Create: `packages/quality-engine/src/policy.ts`
- Create: `packages/quality-engine/src/staleness.ts`
- Create: `packages/quality-engine/src/index.ts`
- Test: `packages/quality-engine/src/policy.test.ts`
- Test: `packages/quality-engine/src/staleness.test.ts`

**Interfaces:**
- Produces:

```ts
export type QualityRuleKind = 'deterministic' | 'semantic';
export type QualitySeverity = 'blocking' | 'advisory';
export type QualityRuleVerdict = 'pass' | 'fail' | 'na' | 'unknown';

export interface QualityRuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly scope: 'platform' | 'project';
  readonly kind: QualityRuleKind;
  readonly severity: QualitySeverity;
  readonly description: string;
  readonly evidenceRequired: boolean;
  readonly enabled: boolean;
}

export interface QualityPolicy {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly rules: readonly QualityRuleDefinition[];
  readonly maxAutomaticReworks: 2;
}

export interface QualityEvidence {
  readonly ruleId: string;
  readonly excerpt?: string;
  readonly location?: { readonly start: number; readonly end: number };
  readonly note: string;
}

export interface QualityRuleEvaluation {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly verdict: QualityRuleVerdict;
  readonly evidence: readonly QualityEvidence[];
}

export interface ReviewerBinding {
  readonly providerId: string;
  readonly model: string;
  readonly recipeVersion: string;
}

export interface QualityReviewAnchor {
  readonly chapterIndex: number;
  readonly draftRevision: number;
  readonly draftContentHash: string;
  readonly receiptId: string;
  readonly ruleSetDigest: string;
}

export interface QualityReviewReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  readonly anchor: QualityReviewAnchor;
  readonly reviewer: ReviewerBinding;
  readonly evaluations: readonly QualityRuleEvaluation[];
  readonly verdict: 'pass' | 'blocking_fail' | 'refused';
}
```

- [x] **Step 1: Write policy merge failing test**

```ts
it('project rule overrides platform rule only by the same id', () => {
  const platform = policy('book-a', [rule('NARR-001', 'advisory'), rule('PARA-001', 'blocking')]);
  const project = policy('book-a', [rule('NARR-001', 'blocking')]);
  const merged = mergeQualityPolicies(platform, project);
  expect(merged.rules.find((r) => r.id === 'NARR-001')?.severity).toBe('blocking');
  expect(merged.rules.find((r) => r.id === 'PARA-001')?.severity).toBe('blocking');
  expect(merged.maxAutomaticReworks).toBe(2);
});
```

- [x] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @mozhou/quality-engine test -- policy.test.ts
```

Expected: FAIL because `mergeQualityPolicies` does not exist.

- [x] **Step 3: Implement deterministic policy merge and digest**

Export:

```ts
export function mergeQualityPolicies(platform: QualityPolicy, project: QualityPolicy): QualityPolicy;
export function qualityRuleSetDigest(policy: QualityPolicy): string;
```

Digest must be SHA-256 of canonical JSON of enabled rules sorted by `id`, including `id/version/kind/severity/description/evidenceRequired`.

- [x] **Step 4: Write staleness failing test**

```ts
it('invalidates a pass when draft hash changes', () => {
  const report = fakePass({ draftRevision: 7, draftContentHash: 'aaa' });
  expect(isQualityReviewCurrent(report, { draftRevision: 8, draftContentHash: 'bbb' })).toBe(false);
});
```

- [x] **Step 5: Implement exact-version validation**

```ts
export function isQualityReviewCurrent(
  report: QualityReviewReport,
  draft: { readonly draftRevision: number; readonly draftContentHash: string },
): boolean {
  return report.anchor.draftRevision === draft.draftRevision
    && report.anchor.draftContentHash === draft.draftContentHash;
}
```

- [x] **Step 6: Run package tests**

```bash
pnpm --filter @mozhou/quality-engine test
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/quality-engine pnpm-lock.yaml
git commit -m "feat: add project quality rule domain"
```

---

### Task 3: Implement Literary Rule Evaluation Without Polluting Canon

**Files:**
- Create: `packages/quality-engine/src/deterministic.ts`
- Create: `packages/quality-engine/src/semantic.ts`
- Create: `packages/quality-engine/src/review.ts`
- Test: `packages/quality-engine/src/deterministic.test.ts`
- Test: `packages/quality-engine/src/review.test.ts`

**Interfaces:**
- Consumes: exact prose string, `QualityPolicy`, `QualityReviewAnchor`, injected semantic evaluator.
- Produces:

```ts
export interface SemanticQualityEvaluator {
  evaluate(input: {
    readonly prose: string;
    readonly rules: readonly QualityRuleDefinition[];
    readonly projectFailurePatterns: readonly FailurePattern[];
  }): Promise<readonly QualityRuleEvaluation[]>;
}

export async function runQualityReview(input: {
  readonly prose: string;
  readonly policy: QualityPolicy;
  readonly anchor: QualityReviewAnchor;
  readonly reviewer: ReviewerBinding;
  readonly failurePatterns: readonly FailurePattern[];
  readonly semanticEvaluator?: SemanticQualityEvaluator;
}): Promise<QualityReviewReport>;
```

- [x] **Step 1: Add deterministic paragraph waterfall rule**

Define platform rule id `PARA-001`: three consecutive one-sentence narrative paragraphs are a blocking failure unless all three are dialogue or explicit action beats tagged by the caller. V1 implementation may conservatively detect plain prose paragraphs and return evidence spans; it must never rewrite prose itself.

Test fixture:

```ts
const prose = '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。';
const result = evaluateDeterministicRules(prose, policyWith('PARA-001'));
expect(result.find((x) => x.ruleId === 'PARA-001')?.verdict).toBe('fail');
expect(result.find((x) => x.ruleId === 'PARA-001')?.evidence.length).toBeGreaterThan(0);
```

- [x] **Step 2: Add version/hash coverage rule**

Define `REV-001`: review anchor must match current draft revision/hash before report can be used as a pass. This rule is mechanical and blocking.

- [x] **Step 3: Add semantic rule contract, not hard-coded genre prompts**

The semantic evaluator must receive rule definitions by id. Initial reusable ids:

```text
NARR-001 outline_expansion
CHAR-001 character_toolization
KNOW-001 knowledge_overreach
PAY-001 payoff_zeroed
PAY-002 information_only_reward_streak
PAT-001 repeated_solution_algorithm
STYLE-001 forced_golden_line
MEM-001 memory_anchor_repetition_without_added_meaning
MEM-002 forced_anchor_creation
```

Do not hard-code `bloodworm`, `cultivation`, `陈缺`, or any specific novel terms in package code.

- [x] **Step 4: Make blocking aggregation explicit**

`runQualityReview` returns `blocking_fail` iff at least one enabled blocking rule returns `fail`. `unknown` from a semantic provider outage must not become `pass`; if any required blocking semantic rule is `unknown`, overall verdict is `refused`.

- [x] **Step 5: Run tests**

```bash
pnpm --filter @mozhou/quality-engine test
```

- [x] **Step 6: Commit**

```bash
git add packages/quality-engine/src
git commit -m "feat: evaluate literary quality rules"
```

---

### Task 4: Upgrade Pipeline `review` Into a Version-Bound Blocking Quality Step

**Files:**
- Modify: `packages/pipeline/package.json`
- Modify: `packages/pipeline/src/review-step.ts`
- Modify: `packages/pipeline/src/session.ts`
- Modify: `packages/pipeline/src/index.ts`
- Modify: pipeline event vocabulary single source
- Test: `packages/pipeline/src/review-step.test.ts`
- Test: `packages/pipeline/src/session.test.ts`
- Add: `packages/pipeline/src/quality-rework.test.ts`

**Interfaces:**
- `review-step.ts` exports:

```ts
export interface RunReviewStepRequest {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  readonly receiptId: string;
  readonly reviewer: ReviewerBinding;
  readonly semanticEvaluator?: SemanticQualityEvaluator;
}

export interface ReviewStepOutcome {
  readonly input: MechanicalReviewInput;
  readonly report: QualityReviewReport;
}

export async function runReviewStep(request: RunReviewStepRequest): Promise<ReviewStepOutcome>;
```

- [x] **Step 1: Write failing exact-hash review test**

Create a draft, run review, mutate the draft body through the existing draft edit path, then assert:

```ts
expect(isQualityReviewCurrent(oldReport, newDraftIdentity)).toBe(false);
```

- [x] **Step 2: Compute draft hash from exact body consumed by review**

Use SHA-256 over the exact UTF-8 body returned by `readProseChapter`. Do not hash a truncated context packet or a summary.

- [x] **Step 3: Persist review report outside Canon**

Use path:

```text
.mozhou/quality-reviews/chapter_<N>/report_<ULID>.json
```

Report is runtime audit evidence; it is not Canon truth.

- [x] **Step 4: Add explicit `requestQualityRework()` session edge**

Rules:

```ts
requestQualityRework(): void
```

Legal only when current step is `review` and last quality verdict is `blocking_fail`. It emits `TaskStepTransitioned { from:'review', to:'draft', reason:'quality_rework', reworkAttempt:n }` and increments the projected quality rework count.

When `n > 2`, throw:

```ts
export class QualityReworkLimitExceededError extends Error {}
```

No automatic loop exists inside `session.ts`; an orchestrator may call at most twice based on the explicit report.

- [x] **Step 5: Prevent forward progress on blocking fail or refused review**

`advance('user_edit')` must reject if the last review verdict is not `pass`.

- [x] **Step 6: Add session tests**

Required cases:

```text
pass review -> user_edit allowed
blocking_fail -> user_edit denied
blocking_fail -> requestQualityRework -> draft allowed
second rework allowed
third rework denied
refused -> user_edit denied and no silent pass
crash/resume restores last review verdict and rework count from ledger
```

- [x] **Step 7: Run pipeline tests**

```bash
pnpm --filter @mozhou/pipeline test
```

- [x] **Step 8: Commit**

```bash
git add packages/pipeline packages/runtime packages/kernel
git commit -m "feat: enforce literary review before user edit"
```

---

### Task 5: Add Failure Memory and Structured User Correction Reasons

**Files:**
- Create: `packages/quality-engine/src/failure-memory.ts`
- Modify: `packages/pipeline/src/user-edit-step.ts`
- Modify: event vocabulary source
- Modify: `packages/flywheel/src/evaluator/types.ts`
- Modify: `packages/flywheel/src/evaluator/project.ts`
- Test: `packages/quality-engine/src/failure-memory.test.ts`
- Test: `packages/flywheel/src/evaluator/project.test.ts`

**Interfaces:**

```ts
export type CorrectionReason =
  | 'outline_expansion'
  | 'character_toolization'
  | 'knowledge_overreach'
  | 'payoff_zeroed'
  | 'information_only_reward'
  | 'repeated_solution_algorithm'
  | 'forced_golden_line'
  | 'memory_anchor_misuse'
  | 'style_drift'
  | 'other';

export interface FailurePattern {
  readonly code: CorrectionReason;
  readonly firstSeenChapter: number;
  readonly lastSeenChapter: number;
  readonly occurrences: number;
  readonly active: boolean;
  readonly authorNote?: string;
}
```

- [x] **Step 1: Extend user edit recording request**

Add optional structured correction metadata without changing character-diff semantics:

```ts
readonly correctionReasons?: readonly CorrectionReason[];
readonly correctionNote?: string;
```

- [x] **Step 2: Emit `AuthorCorrectionRecorded` only when reasons are supplied**

Event payload contains chapterIndex, reasons, and a digest of the note; do not put raw private prose into telemetry/flywheel rows.

- [x] **Step 3: Project project-local failure memory**

Persist book-local:

```text
质量/failure-memory.jsonl
```

Repeated same code increments `occurrences` and updates `lastSeenChapter` append-only through event-derived projection semantics.

- [x] **Step 4: Feed active failure patterns into future semantic review**

`runQualityReview` receives active patterns and reviewer instructions must explicitly test recurrence. This does not make past author judgment a Canon fact; it is a quality prior.

- [x] **Step 5: Add flywheel metric**

Add:

```ts
s7: {
  correctedChapters: number;
  repeatedCorrections: number;
  repeatCorrectionRate: number | null;
}
```

A correction is repeated when the same reason occurs in a later chapter while its FailurePattern is active.

- [x] **Step 6: Run tests and commit**

```bash
pnpm --filter @mozhou/quality-engine test
pnpm --filter @mozhou/pipeline test
pnpm --filter @mozhou/flywheel test
git add packages
git commit -m "feat: learn from structured author corrections"
```

---

### Task 6: Productize Expectation/Payoff, Narrative Pattern, and Memory Anchors as Quality/Planning Data

**Files:**
- Create: `packages/quality-engine/src/reader-experience.ts`
- Create: `packages/quality-engine/src/memory-anchor.ts`
- Test: corresponding tests
- Modify: `packages/pipeline/src/prepare.ts`
- Modify: `packages/context-compiler/src/assemble.ts` only if a new structural section is required; otherwise inject through existing structural-section mechanism without changing budgeting algorithm.

**Interfaces:**

```ts
export interface ReaderExperienceDelta {
  readonly chapterIndex: number;
  readonly pressureDelta: -2 | -1 | 0 | 1 | 2;
  readonly expectationDelta: -2 | -1 | 0 | 1 | 2;
  readonly tangibleGain: 'none' | 'power' | 'resource' | 'status' | 'access' | 'relationship_leverage' | 'freedom';
  readonly payoff: 'none' | 'advanced' | 'partial' | 'paid';
  readonly solutionPattern: string;
}

export interface MemoryAnchor {
  readonly anchorId: string;
  readonly type: 'scene' | 'line' | 'action' | 'object' | 'relationship' | 'theme';
  readonly description: string;
  readonly plantedChapter: number;
  readonly lastEchoChapter: number | null;
  readonly status: 'planted' | 'echoed' | 'retired';
}
```

- [x] **Step 1: Keep NarrativePromise as Canon-adjacent promise truth, but store reader-experience diagnostics outside Kernel**

Do not add `ReaderExperienceDelta` or `MemoryAnchor` to TemporalFact.

- [x] **Step 2: Add review rules**

Required semantic rules:

```text
PAY-003: repeated pressure without expectation growth
PAY-004: tangible gain immediately fully erased without compensating agency
PAT-002: same high-level solutionPattern repeated across recent chapters
MEM-003: anchor echoed with no added meaning
MEM-004: chapter manufactures a new anchor solely to satisfy quota
```

- [x] **Step 3: Compile only the recent bounded slice**

For chapter N, include at most recent 5 `ReaderExperienceDelta` rows, active/near-due NarrativePromises, active FailurePatterns, and at most 8 relevant MemoryAnchors. These items compete in the normal context budget; no new unlimited prompt channel.

- [x] **Step 4: Test budget preservation**

Existing `ContextReceipt` must still account for every included/excluded item. No quality item may bypass `storyTextQuota` or exact tokenizer accounting.

- [x] **Step 5: Commit**

```bash
git add packages/quality-engine packages/pipeline packages/context-compiler
git commit -m "feat: track reader payoff and memory anchors"
```

---

### Task 7: Extend KnowledgeState With Epistemic Level Without Breaking POV Safety

**Files:**
- Modify: `packages/kernel/src/kernel-schema.ts`
- Modify: `packages/kernel/src/narrative-state.ts`
- Modify: `packages/pipeline/src/gate-step.ts`
- Modify: extraction schema/prompt at the existing single source
- Test: `packages/kernel/src/narrative-state.test.ts`
- Test: `packages/pipeline/src/gate-step.test.ts`
- Add ADR: `docs/adr/0026-knowledge-epistemic-level.md`

**Interfaces:**

Extend:

```ts
export type EpistemicLevel = 'knows' | 'suspects' | 'believes';

export interface KnowledgeState extends KernelEntityHead {
  readonly id: KnowledgeStateId;
  readonly factId: FactId;
  readonly holder: KnowledgeHolder;
  readonly level: EpistemicLevel;
  readonly knownSinceChapter: number;
  readonly knownSinceSceneId?: SceneId;
  readonly distortion?: string;
}
```

Migration rule:

```text
existing KnowledgeState rows with no `level` in pre-migration data are migrated once to level='knows'; runtime parser after migration remains strict and does not silently default forever.
```

- [x] **Step 1: Write migration tests**

- [x] **Step 2: Define POV semantics**

`queryActiveFacts` may expose a fact as authoritative character knowledge only for `level='knows'`.

For `suspects`, context compiler may expose:

```text
CHARACTER SUSPECTS: <fact proposition>; do not narrate or act as confirmed knowledge.
```

For `believes`, expose the believed proposition; when `distortion` exists, expose the distortion, not the true fact.

- [x] **Step 3: Update leakage gate**

A secret referenced as confirmed knowledge in extracted prose requires `level='knows'`; `suspects` must not authorize a definitive secret statement.

- [x] **Step 4: Run kernel/pipeline tests and commit**

```bash
pnpm --filter @mozhou/kernel test
pnpm --filter @mozhou/pipeline test
git add packages/kernel packages/pipeline docs/adr/0026-knowledge-epistemic-level.md
git commit -m "feat: distinguish knowledge suspicion and belief"
```

---

### Task 8: Add Long-Novel Quality Regression Benchmarks

**Files:**
- Modify: `packages/benchmark/src/types.ts`
- Modify: `packages/benchmark/src/metrics.ts`
- Create: `packages/benchmark/fixtures/quality-regression-cases.json`
- Test: `packages/benchmark/src/metrics.test.ts`
- Modify: `docs/specs/migration-and-phasing-plan.md`

**Interfaces:**

Add metrics:

```ts
export interface LiteraryQualitySignals {
  readonly staleReviewPassRate: number;
  readonly blockingRuleCoverage: number;
  readonly repeatCorrectionRate: number;
  readonly tangibleGainRecall: number;
  readonly solutionPatternRepeatRate: number;
}
```

- [x] **Step 1: Add exact stale-review benchmark**

Case: review draft revision 3/hash A -> edit to revision 4/hash B -> attempt delivery using old pass. Expected hard failure; `staleReviewPassRate` counts this as regression.

- [x] **Step 2: Add outline-expansion case**

Provide an outline with 6 beats and a draft that converts each beat into one report-like paragraph with no scene causality. Expected `NARR-001=fail`.

- [x] **Step 3: Add tool-character case**

Supporting character exists only to deliver protagonist-required information and has no independent goal/action. Expected `CHAR-001=fail`.

- [x] **Step 4: Add payoff-zeroing case**

Three chapters accumulate pressure; chapter 4 grants a power/resource then removes all practical agency in the same scene without compensating advantage. Expected `PAY-004=fail`.

- [x] **Step 5: Add false-belief/knowledge case**

Character has `suspects` only, prose states secret as certainty. Expected Continuity/Knowledge Gate failure after Task 7.

- [x] **Step 6: Add repeat-correction case**

Same correction reason appears in later chapter while active. Expected `repeatCorrectionRate > 0`.

- [x] **Step 7: Run benchmark tests**

```bash
pnpm --filter @mozhou/benchmark test
```

- [x] **Step 8: Commit**

```bash
git add packages/benchmark docs/specs/migration-and-phasing-plan.md
git commit -m "test: add long-form literary quality regressions"
```

---

### Task 9: Surface Quality Review and Rework in `apps/web`

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/server/api.ts`
- Modify: `apps/web/src/App.tsx`
- Add focused UI components under `apps/web/src/quality/`
- Test: `apps/web/src/api.test.ts`

**Interfaces:**

Server endpoints:

```text
POST /api/chapter.review      { root, chapterIndex }
POST /api/chapter.rework      { root, chapterIndex }
POST /api/chapter.corrections { root, chapterIndex, reasons[], note? }
POST /api/chapter.quality     { root, chapterIndex }
```

Responses expose report ids, verdicts, evidence, draft revision/hash, rework count, and stale/current status. Raw model chain-of-thought is never returned or persisted.

- [x] **Step 1: Add API contract tests**

Required behaviors:

```text
review pass returns current=true
editing draft after pass makes /quality return current=false
blocking fail prevents forward action
rework endpoint works for attempt 1 and 2
attempt 3 returns explicit 409/422 style error with code QualityReworkLimitExceeded
correction reasons persist without raw manuscript telemetry upload
```

- [x] **Step 2: Add UI quality panel**

Display:

```text
Literary Review: PASS / NEEDS REWORK / REFUSED
Exact draft revision + short hash
Blocking failures first
Evidence excerpts
Rework attempt 0/2, 1/2, 2/2
“Apply rework” explicit action
“Record my correction” reason selector
```

- [x] **Step 3: Preserve author agency**

No auto-commit after quality pass. No quality failure can mutate Canon. No rework can start without the explicit orchestrator/user action defined in Task 4.

- [x] **Step 4: Run UI verification**

```bash
pnpm --filter @mozhou/web test
pnpm --filter @mozhou/web typecheck
pnpm --filter @mozhou/web build
```

- [x] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: surface literary quality review in web"
```

---

### Task 10: Full Verification and Migration Guard

**Files:**
- Modify only if verification exposes causal defects in files touched by Tasks 1-9.
- Create: `docs/spikes/2026-08-30-quality-gates-verification-report.md`

**Interfaces:**
- Produces one verification report with exact commit SHA, commands, pass/fail counts, known limitations, and confirmation that `app/` legacy data remains readable.

- [x] **Step 1: Run repository typecheck/build/tests**

```bash
pnpm test
pnpm build
```

- [x] **Step 2: Run the golden chapter journey three consecutive times**

Each run:

```text
create/open book
prepare
compile exact receipt
draft
literary review
(optional rework)
user edit
final extract
continuity gate
canon proposal
commit
reload
verify committed prose + deltas + quality report anchor
```

All three must pass without manual state repair.

- [x] **Step 3: Run stale-pass negative journey**

Review PASS -> mutate draft -> attempt forward delivery. Expected: blocked because report hash/revision is stale.

- [x] **Step 4: Run two-rework-limit negative journey**

Produce blocking fail three times. Expected: only first two reworks are allowed; third stops for author.

- [x] **Step 5: Verify legacy boundary**

Existing `app/` build/tests remain unchanged unless a documented migration shim is necessary. No deletion of old database migrations or user manuscript data.

- [x] **Step 6: Write verification report**

The report must include exact commands and outputs summarized by status; do not write “tests passed” without command evidence.

- [x] **Step 7: Final commit**

```bash
git add docs/spikes/2026-08-30-quality-gates-verification-report.md
git commit -m "docs: record quality gates verification"
```

---

# Implementation Order and Stop Conditions

Implement in this order only:

```text
Task 1 architecture/contract
→ Task 2 domain package
→ Task 3 rule evaluator
→ Task 4 pipeline enforcement
→ Task 5 failure memory
→ Task 6 reader experience + memory anchors
→ Task 7 knowledge levels
→ Task 8 benchmark
→ Task 9 UI
→ Task 10 verification
```

Stop and request architectural review rather than guessing if any implementation would require one of these:

```text
- making LLM literary output mutate Canon directly
- changing ChapterCommit immutability
- moving project quality rules into TemporalFact
- bypassing ContextReceipt/token budgeting for quality context
- removing `app/` user data or migrations
- allowing more than 2 automatic quality reworks
- weakening an existing deterministic Continuity Gate to accommodate a semantic reviewer
```

# Acceptance Definition

The feature is complete only when all of the following are true:

1. A chapter cannot be handed forward on the basis of a PASS generated for an older draft revision/hash.
2. A blocking literary rule has id/version/evidence and can prevent forward pipeline progression without claiming a Canon contradiction.
3. Continuity Gate remains deterministic and its existing hard-conflict tests still pass.
4. User corrections can be categorized and a repeated correction becomes a measurable flywheel signal.
5. Expectation/payoff, solution-pattern repetition, and memory-anchor misuse can be reviewed without becoming Canon facts.
6. `suspects` and `believes` no longer grant the same authority as `knows`.
7. `apps/web` exposes review/rework state from the Novel OS packages rather than reimplementing a second quality system.
8. `app/` is clearly legacy and receives no new core Novel OS feature work.
9. Three clean golden journeys pass consecutively.
10. Stale-review and third-rework negative journeys fail closed exactly as designed.
