/**
 * 会话步投影（T16 · #40；chapter-pipeline-spec S1）。
 *
 * 会话态 = 投影的一种（无第三处真源）：当前步随时可从 Ledger 事件流纯折叠重建
 * （T1 状态≠事件；折叠幂等，同一输入重复折叠逐字段相等）。折叠规则：
 *   - TaskStarted(chapterIndex=N) 开启会话窗口；窗口内 TaskStepTransitioned 的
 *     payload.to 即当前步；TaskFinished 收卷；
 *   - 同章再次 TaskStarted ⇒ 新窗口取代旧窗口（重提交 = 新 session，S9）——
 *     旧 commit 不构成新会话的完成态；
 *   - 完成态单一事实源 = 窗口内 CanonCommitted 存在性（ANWA #90），两种行格式
 *     均认（平铺行按 position 落在窗口内判定）；
 *   - 窗口内 CHAPTER_DRAFTING 的 ContextCompiled 指针记录 lastReceiptId——
 *     Compile 后崩溃恢复按 receiptId 续跑的凭据（INV-R1 先证后指针 ⇒ 指针存在
 *     即凭证必在盘上）。
 */
import { EVENT_PAIRS } from '@mozhou/kernel';
import type { ContextReceiptId } from '@mozhou/kernel';
import type { PipelineLedgerRow } from './ledger.js';
import { isPipelineStep, type PipelineStep } from './steps.js';

export interface SessionProjection {
  readonly chapterIndex: number;
  /** 存在未走完的会话窗口（重提交/恢复判定的主锚）。 */
  readonly sessionOpen: boolean;
  readonly taskRef: string | null;
  /** 开卷事件在账本中的 position（完成态/凭证的窗口判定基准）。 */
  readonly openedAtPosition: number | null;
  readonly currentStep: PipelineStep | null;
  readonly finished: boolean;
  /** 完成态单一事实源：本窗口内 CanonCommitted 已存在。 */
  readonly committed: boolean;
  /** CanonCommitted 行携带的 commitId（payload 或平铺字段；缺省 null）。 */
  readonly commitId: string | null;
  /** 本窗口内最近一张 CHAPTER_DRAFTING 凭证（receiptId 续跑凭据）。 */
  readonly lastReceiptId: ContextReceiptId | null;
  /** 成对约束悬挂 head 键（head#taskRef；投影合并侧呈现，规格 §3）。 */
  readonly openHeads: readonly string[];
}

function rowChapterIndex(row: PipelineLedgerRow): number | undefined {
  if (row.kind === 'task') {
    return row.event.chapterIndex;
  }
  const value = row.row['chapterIndex'];
  return typeof value === 'number' ? value : undefined;
}

function rowType(row: PipelineLedgerRow): string | undefined {
  return row.kind === 'task' ? row.event.type : (row.row['type'] as string | undefined);
}

/** 折叠账本 → 指定章的会话步投影。纯函数、无 IO、幂等。 */
export function projectSession(rows: readonly PipelineLedgerRow[], chapterIndex: number): SessionProjection {
  let taskRef: string | null = null;
  let openedAtPosition: number | null = null;
  let currentStep: PipelineStep | null = null;
  let finished = false;
  let committed = false;
  let commitId: string | null = null;
  let lastReceiptId: ContextReceiptId | null = null;
  const openHeads: string[] = [];

  for (const row of rows) {
    const type = rowType(row);

    /* ---- 任务族事件：仅当属于本章 ---- */
    if (row.kind === 'task') {
      const event = row.event;
      if (event.chapterIndex === chapterIndex) {
        if (type === 'TaskStarted') {
          // 新窗口取代旧窗口（重提交 = 新 session）
          taskRef = event.taskRef;
          openedAtPosition = row.position;
          currentStep = null;
          finished = false;
          committed = false;
          commitId = null;
          lastReceiptId = null;
          openHeads.length = 0;
          const step = event.payload?.['step'];
          currentStep = typeof step === 'string' && isPipelineStep(step) ? step : 'prepare';
        } else if (event.taskRef === taskRef && openedAtPosition !== null) {
          if (type === 'TaskStepTransitioned') {
            const to = event.payload?.['to'];
            if (typeof to === 'string' && isPipelineStep(to)) {
              currentStep = to;
            }
          } else if (type === 'TaskFinished') {
            finished = true;
          } else if (type === 'CanonCommitted') {
            committed = true;
            const payloadCommit = event.payload?.['commitId'];
            commitId = typeof payloadCommit === 'string' ? payloadCommit : null;
          } else if (type === 'ContextCompiled') {
            const rid = event.payload?.['receiptId'];
            if (typeof rid === 'string') {
              lastReceiptId = rid as ContextReceiptId;
            }
          }
        }
      }

      // 成对约束悬挂视图：窗口内、同 taskRef 才计入
      if (openedAtPosition !== null && row.position >= openedAtPosition && event.chapterIndex === chapterIndex) {
        const pair = EVENT_PAIRS.find(([h, t]) => h === type || t === type);
        if (pair) {
          const key = `${pair[0]}#${event.taskRef}`;
          if (type === pair[0]) {
            if (!openHeads.includes(key)) openHeads.push(key);
          } else {
            const idx = openHeads.indexOf(key);
            if (idx >= 0) openHeads.splice(idx, 1);
          }
        }
      }
      continue;
    }

    /* ---- 平铺领域行：CanonCommitted / ContextCompiled 指针（无 taskRef 可归，
     *     以 chapterIndex + position 窗口归属）---- */
    if (openedAtPosition !== null && row.position > openedAtPosition && !finished && !committed) {
      if (rowChapterIndex(row) !== chapterIndex) {
        continue;
      }
      if (type === 'CanonCommitted') {
        committed = true;
        const flatCommit = row.row['commitId'];
        commitId = typeof flatCommit === 'string' ? flatCommit : null;
      } else if (
        type === 'ContextCompiled' &&
        row.row['taskType'] === 'CHAPTER_DRAFTING' &&
        typeof row.row['receiptId'] === 'string'
      ) {
        lastReceiptId = row.row['receiptId'] as ContextReceiptId;
      }
    }
  }

  return {
    chapterIndex,
    sessionOpen: openedAtPosition !== null && !finished && !committed,
    taskRef,
    openedAtPosition,
    currentStep,
    finished,
    committed,
    commitId,
    lastReceiptId,
    openHeads: [...openHeads],
  };
}
