/**
 * 语义层节流与入账（T29 · #70；t66 D12/D14/E3/E5）。
 *
 * - D12 节流：调用方按 pin→对账命中→stale→主线 排序后传入有序受影响章；
 *   本模块按序处理、每章单报一文件（批量仅传输层优化，结论逐章落账不放松）；
 *   预算超限章标 deferred（不产报告、事件带 refusal 码）。
 * - D14 入账序：报告文件先写 → SemanticAnalyzed 指针事件后发（崩溃对：孤儿报告
 *   合法、悬空指针非法，沿 INV-R1 精神）；SemanticAnalyzed 不成对（词表 18 词条、
 *   EVENT_PAIRS 不动），payload 只含指针摘要，taskRef/chapterIndex 走顶层槽位。
 * - D16 保留：V1 全保留（报告目录不裁剪）。
 */
import type { PublishBus } from '@mozhou/runtime';
import type { DomainEvent } from '@mozhou/kernel';
import { analyzeSemantic } from './analyze.js';
import type { AnalyzeDeps, AnalyzeInput } from './analyze.js';
import type { SemanticVerdict } from './types.js';

/** 单章语义分析请求（受排序批次驱动；chapterIndex 走事件顶层槽）。 */
export interface SemanticBatchItem {
  readonly taskRef: string;
  readonly chapterIndex: number;
  readonly reportId: string;
  readonly receiptId: string;
  readonly recomputationHash: string;
  readonly taskType: string;
  readonly affectedRefs: AnalyzeInput['affectedRefs'];
  readonly contextTokens: number;
  readonly provider: string;
  /** 批次锚（reconciliationRef? 传入走 anchor）。 */
  readonly reconciliationRef?: { readonly proposalId: string; readonly changeSummaryDigest: string };
}

export interface SemanticBatchOutcome {
  readonly reported: number;
  readonly refused: number;
  readonly deferred: number;
  /** 各章结局（报告 id / 状态 / 悬置理由）。 */
  readonly items: readonly {
    readonly chapterIndex: number;
    readonly status: 'reported' | 'refused' | 'deferred';
    readonly reportId: string | null;
    readonly verdict: SemanticVerdict | null;
    readonly reason?: string;
  }[];
}

export interface RunSemanticBatchRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  readonly items: readonly SemanticBatchItem[];
  readonly deps: AnalyzeDeps;
}

function publishPointer(bus: PublishBus, root: string, item: SemanticBatchItem, payload: Record<string, unknown>): void {
  const event: DomainEvent = {
    type: 'SemanticAnalyzed',
    taskRef: item.taskRef,
    ...(item.chapterIndex === undefined ? {} : { chapterIndex: item.chapterIndex }),
    payload,
  };
  bus.publish({ root }, event);
}

/** 按序处理批次：每章一报告一指针事件；budget 超限标 deferred 不产文件。 */
export async function runSemanticBatch(request: RunSemanticBatchRequest): Promise<SemanticBatchOutcome> {
  const outcomes: NonNullable<SemanticBatchOutcome['items'][number]>[] = [];
  let reported = 0;
  let refused = 0;
  let deferred = 0;

  for (const item of request.items) {
    // D12 预算闸：单章超限 → deferred（不产报告、不静默、不上报为 refusal——超限是节流不是故障）
    if (item.contextTokens > 16_384) {
      deferred += 1;
      outcomes.push({ chapterIndex: item.chapterIndex, status: 'deferred', reportId: null, verdict: null, reason: 'budget_exceeded' });
      continue;
    }

    const input: AnalyzeInput = {
      reportId: item.reportId,
      bookRoot: request.bookRoot,
      anchor: {
        receiptId: item.receiptId,
        recomputationHash: item.recomputationHash,
        taskType: item.taskType,
        ...(item.chapterIndex === undefined ? {} : { chapterIndex: item.chapterIndex }),
        ...(item.reconciliationRef === undefined ? {} : { reconciliationRef: item.reconciliationRef }),
      },
      affectedRefs: item.affectedRefs,
      contextTokens: item.contextTokens,
      provider: item.provider,
    };

    const outcome = await analyzeSemantic(input, request.deps);
    if (outcome.status === 'reported' && outcome.report !== null) {
      reported += 1;
      publishPointer(request.bus, request.bookRoot, item, {
        reportId: outcome.report.reportId,
        receiptId: item.receiptId,
        verdict: outcome.report.verdict,
        findingCount: outcome.report.findings.length,
      });
      outcomes.push({ chapterIndex: item.chapterIndex, status: 'reported', reportId: outcome.report.reportId, verdict: outcome.report.verdict });
    } else {
      // provider 不可用或预算触发 → refusal 指针事件（显式，绝不静默 mock）
      refused += 1;
      publishPointer(request.bus, request.bookRoot, item, {
        reportId: null,
        receiptId: item.receiptId,
        refusal: outcome.refusalCode ?? 'provider_unavailable',
      });
      outcomes.push({ chapterIndex: item.chapterIndex, status: 'refused', reportId: null, verdict: null, reason: outcome.refusalCode ?? 'provider_unavailable' });
    }
  }

  return { reported, refused, deferred, items: outcomes };
}
