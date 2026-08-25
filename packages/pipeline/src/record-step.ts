/**
 * Flywheel Record 步（T19 · #43；chapter-pipeline-spec §1 表第 10 行 / S12 / S8 Record 后行）。
 *
 * 任务收尾事件 + usage/cost 投影。纪律：
 *   - FlywheelRecorded 是任务族收尾事件（kernel 词表既有，非成对事件）：成败都落账，
 *     payload 携带 outcome（四态词表收窄为二态：succeeded | state_degraded）；
 *   - 记账失败不阻断正文（S12）：usage 投影写失败 ⇒ outcome=state_degraded 上报，
 *     事件照常落账、会话照常可 finish——记账是派生面，正文与正典早已在 Commit 落定；
 *   - usage 投影表 = `.mozhou/usage.jsonl`（运行时区，非 canon 不参与对账，draft 运行态
 *     同款取舍）：append-only JSONL，读侧按 entryId 先到先得去重（append 序即权威序）；
 *   - usage/cost 类派生记账允许异步回灌（§J.4 边界内）：成本核算等派生面事后经
 *     backfillDerivedUsage 追加进同一投影表——只碰运行时区，Ledger 零字节触碰；
 *     回灌行必须携带 derivedFrom（来源同步行 entryId），宁败不猜；
 *   - 零时钟零外部服务：entryId/时间戳显式注入，缺省铸新 ULID。
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newUlid } from '@mozhou/kernel';
import type { DomainEvent } from '@mozhou/kernel';
import type { PublishBus } from '@mozhou/runtime';

/** usage 投影表落点：`.mozhou` 运行时区（非 canon、不参与对账）。 */
export const USAGE_PROJECTION_PATH = '.mozhou/usage.jsonl';

/** 同步侧语义载荷（调用方给业务字段；机械字段由本步盖章）。 */
export interface UsageFact {
  readonly kind: 'usage' | 'cost';
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costMicros?: number;
}

/** usage 投影行（冻结形状）：同步落表行 derived=false，异步回灌行 derived=true。 */
export interface UsageRecord {
  readonly entryId: string;
  readonly taskRef: string;
  readonly chapterIndex: number;
  /** 本窗口 CanonCommitted 的 commitId（Record 步恒有；回灌行沿用来源窗口）。 */
  readonly commitId: string;
  readonly kind: 'usage' | 'cost';
  readonly derived: boolean;
  /** derived=true 时必填：来源同步行的 entryId。 */
  readonly derivedFrom?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costMicros?: number;
  readonly at?: string;
}

/** 记账结局：投影写成功 succeeded；写失败 state_degraded（不阻断，S12）。 */
export type FlywheelRecordStatus = 'succeeded' | 'state_degraded';

export interface FlywheelRecordOutcome {
  readonly status: FlywheelRecordStatus;
  /** 尝试落表的行（含机械字段盖章；degraded 时也已构建，供人工兜底渲染）。 */
  readonly rows: readonly UsageRecord[];
  readonly recordedCount: number;
  /** state_degraded 时的人工模板上报面（M17 三级同款）。 */
  readonly errorDetail: string | null;
}

export interface RunFlywheelRecordRequest {
  readonly bus: PublishBus;
  readonly bookRoot: string;
  /** 会话窗口任务引用（编排方从 ChapterProductionSession.taskRef 取）。 */
  readonly taskRef: string;
  readonly chapterIndex: number;
  /** 本窗口 CanonCommitted 的 commitId。 */
  readonly commitId: string;
  /** 同步侧 usage/cost 事实（空数组合法——无计量也要落收尾事件）。 */
  readonly usage?: readonly UsageFact[];
  /**
   * 投影写缝（ADR-0004 语义缝）：缺省 = appendUsageRows 直写 `.mozhou/usage.jsonl`；
   * 测试注入抛错夹具模拟记账故障，注入收集夹具断言行内容。
   */
  readonly projectionSink?: (rows: readonly UsageRecord[]) => void;
  /** 测试确定性注入：缺省按序铸 usg_ ULID / 缺省不带时间戳。 */
  readonly newEntryId?: (index: number) => string;
  readonly nowIso?: string;
}

function stampRow(fact: UsageFact, index: number, request: RunFlywheelRecordRequest): UsageRecord {
  const entryId = request.newEntryId !== undefined ? request.newEntryId(index) : 'usg_' + newUlid();
  return {
    entryId,
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    commitId: request.commitId,
    kind: fact.kind,
    derived: false,
    ...(fact.provider === undefined ? {} : { provider: fact.provider }),
    ...(fact.model === undefined ? {} : { model: fact.model }),
    ...(fact.inputTokens === undefined ? {} : { inputTokens: fact.inputTokens }),
    ...(fact.outputTokens === undefined ? {} : { outputTokens: fact.outputTokens }),
    ...(fact.costMicros === undefined ? {} : { costMicros: fact.costMicros }),
    ...(request.nowIso === undefined ? {} : { at: request.nowIso }),
  };
}

/**
 * Flywheel Record 步执行：usage 事实 → 机械字段盖章 → 投影写缝（失败降级不抛）→
 * FlywheelRecorded 成败都落账（outcome 进 payload，账面可审计）。
 */
export function runFlywheelRecord(request: RunFlywheelRecordRequest): FlywheelRecordOutcome {
  const facts = request.usage ?? [];
  const rows = facts.map((fact, index) => stampRow(fact, index, request));

  let status: FlywheelRecordStatus = 'succeeded';
  let errorDetail: string | null = null;
  try {
    if (request.projectionSink !== undefined) {
      request.projectionSink(rows);
    } else {
      appendUsageRows(request.bookRoot, rows);
    }
  } catch (error) {
    // 记账失败不阻断正文：降级上报，事件照常落账（S12）
    status = 'state_degraded';
    errorDetail = (error as Error).message;
  }

  const event: DomainEvent = {
    type: 'FlywheelRecorded',
    taskRef: request.taskRef,
    chapterIndex: request.chapterIndex,
    payload: {
      outcome: status,
      commitId: request.commitId,
      recordedCount: status === 'succeeded' ? rows.length : 0,
      ...(errorDetail === null ? {} : { errorDetail }),
    },
  };
  request.bus.publish({ root: request.bookRoot }, event);

  return { status, rows, recordedCount: status === 'succeeded' ? rows.length : 0, errorDetail };
}

/* ---------------------------------------------------------------------------
 * usage 投影表 IO（append-only JSONL；读侧 entryId 先到先得去重）
 * ------------------------------------------------------------------------- */

function usageProjectionAbsPath(bookRoot: string): string {
  return join(bookRoot, USAGE_PROJECTION_PATH);
}

function assertDerivationLegality(row: UsageRecord): void {
  if (!row.derived) {
    throw new Error('backfillDerivedUsage only accepts derived rows (derived=false is the synchronous path)');
  }
  if (row.derivedFrom === undefined || row.derivedFrom.length === 0) {
    throw new Error('derived row must name its source via derivedFrom (' + row.entryId + ')');
  }
}

/** 追加 usage 行进投影表（运行时区；mkdir -p；append-only）。 */
export function appendUsageRows(bookRoot: string, rows: readonly UsageRecord[]): void {
  if (rows.length === 0) return;
  mkdirSync(join(bookRoot, '.mozhou'), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row) + '\n').join('');
  appendFileSync(usageProjectionAbsPath(bookRoot), Buffer.from(payload, 'utf8'));
}

/**
 * 异步回灌：usage/cost 类派生记账追加进投影表（§J.4 边界内）。
 * 只接受 derived=true 且带 derivedFrom 的行——宁败不猜，绝不静默把派生行记成同步行。
 */
export function backfillDerivedUsage(bookRoot: string, rows: readonly UsageRecord[]): void {
  rows.forEach(assertDerivationLegality);
  appendUsageRows(bookRoot, rows);
}

/**
 * 读 usage 投影表：撕裂行跳过（审计容忍）；同 entryId 先到先得（append 序即权威序，
 * 重复回灌同 entryId 幂等）。缺失文件返回空数组。
 */
export function readUsageProjection(bookRoot: string): UsageRecord[] {
  const path = usageProjectionAbsPath(bookRoot);
  if (!existsSync(path)) {
    return [];
  }
  const seen = new Set<string>();
  const rows: UsageRecord[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 撕裂行
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const row = parsed as Record<string, unknown>;
    if (typeof row['entryId'] !== 'string') continue;
    if (seen.has(row['entryId'])) continue;
    seen.add(row['entryId']);
    rows.push(parsed as UsageRecord);
  }
  return rows;
}