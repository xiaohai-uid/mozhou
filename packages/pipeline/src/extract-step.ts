/**
 * Final Extract 步（T18 · #42；chapter-pipeline-spec §1 表第 6 行 / S8 Extract 后行）。
 *
 * 终稿全文 → 五族候选 delta（facts/relationships/knowledge/promises/timeline）。
 * 纪律：
 *   - 候选运行期驻留、不落正典：提取产物只存在于本步返回值（内存态），追踪流
 *     零字节触碰——正典写入唯一入口是 Commit（ADR-0024 Decision 2）；
 *   - Extract 后候选丢失可接受——重跑提取即恢复（dual-plane 分层表既有裁定），
 *     故候选不落任何盘面文件，账本只记 CandidateDeltaExtracted 计数指针；
 *   - 提取失败 = failed_recoverable 可重试：提取缝抛错或产物形状违例都不中断
 *     会话——outcome 上报调用方渲染人工模板（M17 三级可见性同款纪律），重跑
 *     本步即重试；
 *   - 提取缝是显式注入点（ADR-0004 语义缝）：终稿→五族的语义判定属 LLM 领地，
 *     V1 不提供确定性缺省实现（宁缺勿猜）；测试注入夹具提取器，禁真网。
 */
import type { DomainEvent } from '@mozhou/kernel';
import { ChapterPhaseError, proseChapterPath, readProseChapter } from '@mozhou/data-plane';
import type { PublishBus } from '@mozhou/runtime';

/** 候选五族词表：与追踪流五 kind 同名（facts/relationships/knowledge/promises/timeline）。 */
export const CANDIDATE_FAMILIES = [
  'temporalFact',
  'knowledgeState',
  'relationshipState',
  'narrativePromise',
  'timelineEvent',
] as const;

export type CandidateFamily = (typeof CANDIDATE_FAMILIES)[number];

/** 候选 delta 批：族名 → 候选行数组（行形状校验归 Continuity Gate，本步只验批形状）。 */
export type CandidateDeltaBatch = Readonly<Partial<Record<CandidateFamily, readonly unknown[]>>>;

/** 全零计数基线（投影/测试断言的稳定形状）。 */
export function emptyCandidateCounts(): Record<CandidateFamily, number> {
  return { temporalFact: 0, knowledgeState: 0, relationshipState: 0, narrativePromise: 0, timelineEvent: 0 };
}

/** 提取缝输入：终稿全文 + 章号（LLM 上下文的最小确定性面）。 */
export interface DeltaExtractionInput {
  readonly chapterIndex: number;
  readonly prose: string;
}

/** 终稿 → 五族候选的提取缝（LLM 注入点；测试注夹具）。 */
export type DeltaExtractor = (input: DeltaExtractionInput) => CandidateDeltaBatch;

/** 提取产物批形状违例（族缺失合法；族存在但不是「对象行数组」即违例）。 */
export class CandidateBatchShapeError extends Error {
  override readonly name = 'CandidateBatchShapeError';
  constructor(detail: string) {
    super('candidate delta batch shape violation: ' + detail);
  }
}

function assertBatchShape(batch: CandidateDeltaBatch): void {
  for (const family of CANDIDATE_FAMILIES) {
    const rows = batch[family];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) {
      throw new CandidateBatchShapeError('family ' + family + ' must be an array');
    }
    rows.forEach((row, index) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new CandidateBatchShapeError('family ' + family + ' row #' + index + ' must be a JSON object');
      }
    });
  }
}

export type FinalExtractStatus = 'extracted' | 'failed_recoverable';

export interface FinalExtractOutcome {
  readonly status: FinalExtractStatus;
  /** 成功时的运行期候选批（不落盘；失败为 null）。丢失可接受——重跑提取。 */
  readonly batch: CandidateDeltaBatch | null;
  readonly counts: Readonly<Record<CandidateFamily, number>>;
  /** 草稿 revision（事件指针回查用）。 */
  readonly revision: number;
  /** failed_recoverable 时的人工模板上报面（M17 三级同款）。 */
  readonly errorDetail: string | null;
}

export interface RunFinalExtractRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 会话窗口任务引用（编排方从 ChapterProductionSession.taskRef 取）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  /** 提取缝（必注入；无缺省实现——终稿→五族的语义判定不容猜测）。 */
  readonly extract: DeltaExtractor;
}

/**
 * Final Extract 步执行：读 phase=draft 终稿 → 提取缝 → 批形状校验 →
 * CandidateDeltaExtracted 落账（成败都落，账面可审计）→ 候选运行期驻留。
 */
export function runFinalExtract(request: RunFinalExtractRequest): FinalExtractOutcome {
  const scan = readProseChapter(request.bookRoot, proseChapterPath(request.chapterIndex));
  if (scan.phase !== 'draft') {
    throw new ChapterPhaseError(
      request.chapterIndex,
      'final extract consumes the final prose at phase=draft, got ' + scan.phase,
    );
  }

  const counts = emptyCandidateCounts();
  let outcome: FinalExtractOutcome;
  try {
    const batch = request.extract({ chapterIndex: request.chapterIndex, prose: scan.body });
    assertBatchShape(batch);
    for (const family of CANDIDATE_FAMILIES) {
      counts[family] = batch[family]?.length ?? 0;
    }
    outcome = { status: 'extracted', batch, counts, revision: scan.revision, errorDetail: null };
  } catch (error) {
    outcome = {
      status: 'failed_recoverable',
      batch: null,
      counts,
      revision: scan.revision,
      errorDetail: (error as Error).message,
    };
  }

  const event: DomainEvent = {
    type: 'CandidateDeltaExtracted',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      outcome: outcome.status,
      counts: outcome.counts,
      revision: outcome.revision,
      ...(outcome.errorDetail === null ? {} : { errorDetail: outcome.errorDetail }),
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  return outcome;
}
