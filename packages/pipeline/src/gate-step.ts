/**
 * Continuity Gate 步（T18 · #42；chapter-pipeline-spec §1 表第 7 行 / S5）。
 *
 * Gate = 纯机械核检的编排整合（M15 拍板）：四项核检全部是对 kernel/data-plane
 * 既有实现的调用组合，本模块不发明任何新校验语义——
 *   1. 四族行校验：kernel 冻结 Schema 解析器逐行过（TrackingRowError 收集而非
 *      首错即断，区别于 commitChapter 的写前门禁）；伏笔流原样字节透传
 *      （narrativePromise 行语义随其实现票扩张，data-plane T4 既有裁定）；
 *   2. dependency 引用完整性：认知行 factId 与时间线 impactFactIds 必须解析到
 *      「存量活跃 ∪ 本批」事实集；
 *   3. M2 时间线单调：assertTimelineBatchOrdered（批内严格递增 ∧ 全部严格大于
 *      存量活跃最大序数）；
 *   4. POV 秘密零泄漏：每个候选 secret.* 事实必须存在授权认知行（holder 匹配 ∧
 *      knownSinceChapter ≤ 本章）——判据与 queryActiveFacts 读路径同源；可查询视角
 *      （protagonist/char:*）直接经 queryActiveFacts 探针复核，reader 不是可查询
 *      视角（零泄漏门禁不接受全知视角），按同款授权判据并入可见集。
 *
 * 失败输出 = Result 字段 hardConflicts[] {factId, assertion, suggestion}——由编排方
 * 随 session.advance('continuity_gate', result) 进 TaskStepTransitioned payload，
 * 本模块零事件发射、零盘面副作用（Gate 是纯读核检）。
 *
 * LLM 审查只许旁路建议（S5）：advisoryReviewer 是独立可选注入，其产物原样透传在
 * outcome.advisory——从不入 Gate 判定、从不落账。AutomatedReviewCompleted 已从
 * ADR-0007 词表删除（死事件不留），旁路结论因此没有任何账面通道。
 */
import {
  TrackingRowError,
  TimelineOrderViolationError,
  assertTimelineBatchOrdered,
  isSecretPredicate,
  liveMaxTimelineOrder,
  parseKnowledgeStateRow,
  parseRelationshipStateRow,
  parseTemporalFactRow,
  parseTimelineEventRow,
  queryActiveFacts,
} from '@mozhou/kernel';
import type {
  FactId,
  KnowledgeHolder,
  KnowledgeState,
  NarrativeStateSnapshot,
  RelationshipState,
  TemporalFact,
  TimelineEvent,
} from '@mozhou/kernel';
import { ChapterPhaseError, proseChapterPath, readNarrativeSnapshot, readProseChapter } from '@mozhou/data-plane';
import { CANDIDATE_FAMILIES, emptyCandidateCounts } from './extract-step.js';
import type { CandidateDeltaBatch, CandidateFamily } from './extract-step.js';

/** Gate 硬冲突（规格冻结形状：{factId, assertion, suggestion}）。 */
export interface HardConflict {
  /** 定位键：可解析行的 id；形状坏行用 '<family>#<index>' 兜底（宁败不猜 id）。 */
  readonly factId: string;
  readonly assertion: string;
  readonly suggestion: string;
}

export type GateVerdict = 'pass' | 'hard_conflict';

/** 旁路建议（LLM 审查产物；独立可选调用，结论不入判定不入账）。 */
export interface AdvisorySuggestion {
  readonly targetId: string;
  readonly note: string;
}

/** 旁路审查缝：独立可选注入；抛错直通（集成缺陷宁败不吞）。 */
export type AdvisoryReviewer = (input: {
  readonly chapterIndex: number;
  readonly prose: string;
  readonly delta: CandidateDeltaBatch;
}) => readonly AdvisorySuggestion[];

export interface ContinuityGateRequest {
  readonly bookRoot: string;
  readonly chapterIndex: number;
  readonly delta: CandidateDeltaBatch;
  /** 终稿全文（旁路审查消费；缺省读盘上 draft 正文）。 */
  readonly prose?: string;
  readonly advisoryReviewer?: AdvisoryReviewer | undefined;
}

export interface GateCheckedCounts {
  readonly batch: Readonly<Record<CandidateFamily, number>>;
  readonly liveFacts: number;
}

export interface ContinuityGateOutcome {
  readonly verdict: GateVerdict;
  readonly hardConflicts: readonly HardConflict[];
  /** 旁路建议原样透传（无 reviewer 时为空数组）。 */
  readonly advisory: readonly AdvisorySuggestion[];
  readonly checked: GateCheckedCounts;
}

interface ParsedBatch {
  temporalFact: TemporalFact[];
  knowledgeState: KnowledgeState[];
  relationshipState: RelationshipState[];
  timelineEvent: TimelineEvent[];
}

type RowParser = (row: unknown) => unknown;

/** 四族可校验族（伏笔流字节透传不计）。 */
const PARSEABLE_FAMILIES = ['temporalFact', 'knowledgeState', 'relationshipState', 'timelineEvent'] as const;

type ParseableFamily = (typeof PARSEABLE_FAMILIES)[number];

const FAMILY_PARSERS: Record<ParseableFamily, RowParser> = {
  temporalFact: parseTemporalFactRow,
  knowledgeState: parseKnowledgeStateRow,
  relationshipState: parseRelationshipStateRow,
  timelineEvent: parseTimelineEventRow,
};

function rowLocator(row: unknown, family: string, index: number): string {
  if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
    const id = (row as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return family + '#' + index;
}

/**
 * Continuity Gate 步执行：存量折叠 → 批逐项核检（收集全部冲突，不做首错即断）
 * → verdict + hardConflicts。纯读组合，零盘面副作用、零事件发射。
 */
export function runContinuityGate(request: ContinuityGateRequest): ContinuityGateOutcome {
  const live = readNarrativeSnapshot(request.bookRoot);
  const conflicts: HardConflict[] = [];

  /* ---- 1. 四族行校验（逐行收集；伏笔流字节透传不计） ---- */
  const parsed: ParsedBatch = { temporalFact: [], knowledgeState: [], relationshipState: [], timelineEvent: [] };
  for (const family of PARSEABLE_FAMILIES) {
    const parser = FAMILY_PARSERS[family];
    const rows = request.delta[family] ?? [];
    rows.forEach((row, index) => {
      try {
        // parser 已按族分派（FAMILY_PARSERS 字面量逐键对型）；此处收拢进对应桶
        (parsed[family] as unknown[]).push(parser(row));
      } catch (error) {
        if (!(error instanceof TrackingRowError)) throw error;
        conflicts.push({
          factId: rowLocator(row, family, index),
          assertion: error.message,
          suggestion: '将该候选行修正至冻结 Schema 后重跑提取与门禁（回炉 Final Extract 全量重提取）',
        });
      }
    });
  }

  /* ---- 2. dependency 引用完整性：认知/时间线引用必须落在「存量活跃 ∪ 本批」 ---- */
  const factUniverse = new Set<FactId>(live.facts.keys());
  for (const fact of parsed.temporalFact) factUniverse.add(fact.id);
  for (const ks of parsed.knowledgeState) {
    if (!factUniverse.has(ks.factId)) {
      conflicts.push({
        factId: ks.id,
        assertion: 'knowledgeState.factId ' + ks.factId + ' resolves to no live or batch fact',
        suggestion: '补齐被引事实或改指存量活跃事实（跨批悬空引用即断链）',
      });
    }
  }
  for (const event of parsed.timelineEvent) {
    const missing = event.impactFactIds.filter((factId) => !factUniverse.has(factId));
    if (missing.length > 0) {
      conflicts.push({
        factId: event.id,
        assertion: 'timelineEvent.impactFactIds entries ' + missing.join(', ') + ' resolve to no live or batch fact',
        suggestion: 'impactFactIds 只许指向存量活跃 ∪ 本批事实；修正引用后重提',
      });
    }
  }

  /* ---- 3. M2 时间线单调（批内严格递增 ∧ 全部严格大于存量活跃最大序数） ---- */
  try {
    assertTimelineBatchOrdered(parsed.timelineEvent, liveMaxTimelineOrder(live));
  } catch (error) {
    if (!(error instanceof TimelineOrderViolationError)) throw error;
    conflicts.push({
      factId: 'timeline:max:' + String(error.offendingOrder),
      assertion: error.message,
      suggestion: '重排 worldTimeOrder 使批内严格递增且大于存量活跃最大序数（M2 硬门禁不许乱序插入）',
    });
  }

  /* ---- 4. POV 秘密零泄漏：候选秘密必须存在授权认知行 ---- */
  const chapter = request.chapterIndex;
  const combined = combineWithBatch(live, parsed);
  const visibleFactIds = collectVisibleFactIds(combined, chapter);
  for (const fact of parsed.temporalFact) {
    if (!isSecretPredicate(fact.predicate)) continue;
    if (!visibleFactIds.has(fact.id)) {
      conflicts.push({
        factId: fact.id,
        assertion:
          "secret fact '" + fact.predicate + "' has no authorizing knowledge row at chapter " + chapter +
          ' (visible to no authorized holder)',
        suggestion:
          '为该秘密补一条 KnowledgeState 披露行（holder=reader|protagonist|char:*，knownSinceChapter ≤ ' +
          chapter + '）或剔除该候选后重跑提取',
      });
    }
  }

  /* ---- 旁路建议：独立可选调用，结论只透传 ---- */
  const prose = request.prose ?? readDraftProse(request.bookRoot, request.chapterIndex);
  const advisory = request.advisoryReviewer
    ? [...request.advisoryReviewer({ chapterIndex: request.chapterIndex, prose, delta: request.delta })]
    : [];

  const counts = emptyCandidateCounts();
  for (const family of CANDIDATE_FAMILIES) {
    counts[family] = request.delta[family]?.length ?? 0;
  }

  return {
    verdict: conflicts.length === 0 ? 'pass' : 'hard_conflict',
    hardConflicts: conflicts,
    advisory,
    checked: {
      batch: counts,
      liveFacts: live.facts.size,
    },
  };
}

/**
 * 存量活跃视图 ∪ 本批（同 id 本批末行胜出——折叠语义一致）。
 * 输入行已过冻结 Schema 校验，直接按 id 归并，无需再折原始字节。
 */
function combineWithBatch(live: NarrativeStateSnapshot, batch: ParsedBatch): NarrativeStateSnapshot {
  const facts = new Map(live.facts);
  for (const fact of batch.temporalFact) facts.set(fact.id, fact);
  const knowledgeStates = new Map(live.knowledgeStates);
  for (const ks of batch.knowledgeState) knowledgeStates.set(ks.id, ks);
  const relationships = new Map(live.relationships);
  for (const rel of batch.relationshipState) relationships.set(rel.id, rel);
  const timelineEvents = new Map(live.timelineEvents);
  for (const event of batch.timelineEvent) timelineEvents.set(event.id, event);
  return { facts, knowledgeStates, relationships, timelineEvents };
}

/**
 * 合成视图上第 chapter 章的可见事实集：可查询视角经 queryActiveFacts 生产探针
 * 复核；reader 非可查询视角（全知拒绝），其授权行按与 queryActiveFacts 完全同构
 * 的判据（holder 匹配 ∧ knownSinceChapter ≤ 章）并入。
 */
function collectVisibleFactIds(state: NarrativeStateSnapshot, chapter: number): Set<FactId> {
  const visible = new Set<FactId>();
  const holders = new Set<KnowledgeHolder>();
  for (const ks of state.knowledgeStates.values()) holders.add(ks.holder);
  for (const holder of holders) {
    if (holder === 'reader') continue;
    for (const fact of queryActiveFacts(state, { chapter, pov: holder })) {
      visible.add(fact.id);
    }
  }
  for (const ks of state.knowledgeStates.values()) {
    // ADR-0026：reader 披露行也须 level=knows——suspects/believes 不得授权
    // 确定性秘密陈述（宁败不猜）
    if (ks.holder === 'reader' && ks.knownSinceChapter <= chapter && ks.level === 'knows') {
      visible.add(ks.factId);
    }
  }
  return visible;
}

function readDraftProse(bookRoot: string, chapterIndex: number): string {
  const scan = readProseChapter(bookRoot, proseChapterPath(chapterIndex));
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      chapterIndex,
      'continuity gate consumes the final prose at phase=draft, got ' + scan.phase,
    );
  }
  return scan.body;
}
