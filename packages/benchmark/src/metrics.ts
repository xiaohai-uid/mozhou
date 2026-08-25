/**
 * 六指标 L1 机械判定器（T20 · #44；ADR-0008 §2 / chapter-pipeline-spec S12）。
 *
 * 输入面 = 十步管线产物类型：ContinuityGateOutcome（gate 步）、ActivePromiseView
 * （prepare 步）、ContextReceipt.entries（compile 步）、CandidateDeltaBatch（final
 * extract 步）、DependencyManifestEntry（kernel 正典面）——消费真实结构，不造平行世界。
 * 全部纯函数：零时钟零 IO 零 LLM 调用；同输入同值（L1 机械判定边界）。
 */
import type { ContextReceipt, DependencyManifestEntry, KnowledgeHolder } from '@mozhou/kernel';
import type { ActivePromiseView, CandidateDeltaBatch, ContinuityGateOutcome } from '@mozhou/pipeline';

/** 正典知情视图（KnowledgeState 结构子集——真实行可直接赋值）。 */
export type CanonKnowledgeView = readonly {
  readonly id: string;
  readonly factId: string;
  readonly holder: KnowledgeHolder;
  readonly knownSinceChapter: number;
}[];

/** 本章正文提取出的知情引用行（factId × holder 最小对）。 */
export interface ExtractedKnowledgeRow {
  readonly factId: string;
  readonly holder: KnowledgeHolder;
}

/** 章级依赖钉（data-plane readChapterDependencyPins 的结构投影）。 */
export interface ChapterDependencyPinView {
  readonly chapterIndex: number;
  readonly dependencies: readonly DependencyManifestEntry[];
}

// ---------------------------------------------------------------------------
// CANON_ACCURACY：本章候选批核检通过率 = (核检数 - 硬冲突数) / 核检数
// ---------------------------------------------------------------------------

/**
 * 从 Gate 步产物机械折算设定一致率。空批空判 1（无核检即无矛盾可证）；
 * 冲突数超过核检数时钳到 0（脏输入不产生负率）。
 */
export function judgeCanonAccuracy(gate: ContinuityGateOutcome): number {
  const checked = Object.values(gate.checked.batch).reduce((sum, n) => sum + n, 0);
  if (checked === 0) return 1;
  return Math.max(0, (checked - gate.hardConflicts.length) / checked);
}

// ---------------------------------------------------------------------------
// KNOWLEDGE_LEAK_RATE：未知情者引用秘密的比率（ADR-0008 目标恒 0）
// ---------------------------------------------------------------------------

/** 形状守卫：knowledgeState 批行 → {factId, holder} 最小对；坏行剔除不计分母。 */
function isKnowledgeRow(row: unknown): row is ExtractedKnowledgeRow {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
  const rec = row as Record<string, unknown>;
  const factId = rec['factId'];
  const holder = rec['holder'];
  if (typeof factId !== 'string' || factId.length === 0) return false;
  if (typeof holder !== 'string') return false;
  return holder === 'reader' || holder === 'protagonist' || holder.startsWith('char:');
}

/** Final Extract 批的 knowledgeState 族收窄（unknown[] → 机械可判行集）。 */
export function readKnowledgeRowsFromBatch(batch: CandidateDeltaBatch): readonly ExtractedKnowledgeRow[] {
  const rows = batch['knowledgeState'] ?? [];
  return rows.filter(isKnowledgeRow).map((row) => ({ factId: row.factId, holder: row.holder }));
}

/**
 * 泄漏判据（纯机械）：章 N 提取出的 holder×fact 引用，正典中不存在
 * 「同 holder 同事实 knownSinceChapter ≤ N」的知情行 ⇒ 泄漏。零引用空判 0。
 */
export interface KnowledgeLeakInput {
  readonly chapterIndex: number;
  readonly canonKnowledge: CanonKnowledgeView;
  readonly extractedKnowledge: readonly ExtractedKnowledgeRow[];
}

export function judgeKnowledgeLeakRate(input: KnowledgeLeakInput): number {
  const total = input.extractedKnowledge.length;
  if (total === 0) return 0;
  let leaks = 0;
  for (const row of input.extractedKnowledge) {
    const covered = input.canonKnowledge.some(
      (k) => k.factId === row.factId && k.holder === row.holder && k.knownSinceChapter <= input.chapterIndex,
    );
    if (!covered) leaks += 1;
  }
  return leaks / total;
}

// ---------------------------------------------------------------------------
// PROMISE_RECALL：到期承诺进编译上下文的召回率（ADR-0008 目标恒 100%）
// ---------------------------------------------------------------------------

/** 活跃态词表（沿 pipeline/prepare.ts ACTIVE_PROMISE_STATUSES；overdue 仍活跃）。 */
const ACTIVE_PROMISE_STATUSES: readonly string[] = ['introduced', 'reinforced', 'due', 'overdue'];

export interface PromiseRecallInput {
  readonly chapterIndex: number;
  readonly activePromises: readonly ActivePromiseView[];
  readonly compiledReceipt: Pick<ContextReceipt, 'entries'>;
}

/**
 * 到期 = 活跃态且 targetChapter ≤ 当前章；召回 = promiseId 出现在 receipt 中
 * included=true 条目的 identifier 集。无到期承诺空判 1。
 */
export function judgePromiseRecall(input: PromiseRecallInput): number {
  const due = input.activePromises.filter(
    (p) => ACTIVE_PROMISE_STATUSES.includes(p.status)
      && p.targetChapter !== null
      && p.targetChapter <= input.chapterIndex,
  );
  if (due.length === 0) return 1;
  const placed = new Set(input.compiledReceipt.entries.filter((e) => e.included).map((e) => e.identifier));
  const recalled = due.filter((p) => placed.has(p.promiseId)).length;
  return recalled / due.length;
}

// ---------------------------------------------------------------------------
// CHANGE_IMPACT_RECALL：上游变更下游 stale 标记召回率（ADR-0008 目标恒 100%）
// ---------------------------------------------------------------------------

export interface ChangeImpactRecallInput {
  readonly pins: readonly ChapterDependencyPinView[];
  /** 被修改的上游实体（kind+id 定位；revision 为新值不参与匹配）。 */
  readonly modified: readonly DependencyManifestEntry[];
  readonly staleFlaggedChapters: ReadonlySet<number> | readonly number[];
}

/** 期望标记章 = 依赖含任一被改实体的读章；全命中 ⇒ 1，无期望章空判 1。 */
export function judgeChangeImpactRecall(input: ChangeImpactRecallInput): number {
  const flagged = input.staleFlaggedChapters instanceof Set
    ? input.staleFlaggedChapters
    : new Set<number>(input.staleFlaggedChapters);
  const expected = input.pins
    .filter((pin) => pin.dependencies.some((d) => input.modified.some((m) => m.kind === d.kind && m.id === d.id)))
    .map((pin) => pin.chapterIndex);
  if (expected.length === 0) return 1;
  const hit = expected.filter((ch) => flagged.has(ch)).length;
  return hit / expected.length;
}

// ---------------------------------------------------------------------------
// CONTEXT_BUDGET_OVERFLOW：编译总量超配额指示（单 receipt 0/1，目标恒 0）
// ---------------------------------------------------------------------------

export interface BudgetOverflowInput {
  /** 配额来自 recipe.contextBudget（版本矩阵钩子的 recipe 快照轴）。 */
  readonly allocatedTokens: number;
  /** 实际占用来自 ContextReceipt.totalTokens。 */
  readonly actualTokens: number;
}

export function judgeContextBudgetOverflow(input: BudgetOverflowInput): number {
  return input.actualTokens > input.allocatedTokens ? 1 : 0;
}

// ---------------------------------------------------------------------------
// USER_EDIT_RATIO_REDUCTION：新迭代人工改写下降率（ADR-0008：须下降 ⇒ > 0）
// ---------------------------------------------------------------------------

export interface UserEditReductionInput {
  readonly baselineEditCount: number;
  readonly currentEditCount: number;
}

/**
 * 下降率 = (基线 - 当前) / 基线；负值 = 改写变多（门限 >0 判否）。
 * 零基线退化定义：当前亦零 ⇒ 1（无可降仍达标），否则 0（新增改写即失败）。
 */
export function judgeUserEditRatioReduction(input: UserEditReductionInput): number {
  if (input.baselineEditCount === 0) return input.currentEditCount === 0 ? 1 : 0;
  return (input.baselineEditCount - input.currentEditCount) / input.baselineEditCount;
}
