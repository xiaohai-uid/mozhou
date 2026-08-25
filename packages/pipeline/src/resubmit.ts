/**
 * S9 重提交管线（T19 · #43）：commit 后章节允许 requestResubmit——相位移回
 * draft（data-plane reopenChapter；I5：旧 commit 物理痕迹永不改写），随后 V1
 * 全量重走十步：新 taskRef 新会话从 prepare 走到 flywheel_record（增量优化留
 * V2）。重提交期间读取真相 = phase=committed 的最新 commitId——latestCommittedTruth
 * 以 ChapterCommitted 事件行为锚返回最新 commit 的 commitId/contentSha256，
 * 不读已翻回 draft 的正文文件；重提交完成后真相前移到新 commit。
 * 纪律：单飞双守卫在 start() 内先于翻相位拒绝（零副作用）；open() 先跑
 * recoverPendingCommit 再动相位；零时钟零外部服务，手工 id 由调用方注入。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LocalDataPlane,
  RUNTIME_EVENTS_PATH,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { ChapterProductionSession } from './session.js';
import type { ChapterProductionSessionDeps } from './session.js';

/** 重提交前置不满足：目标章没有 committed 相位可回退（从未提交或已在重提交中）。 */
export class ResubmitNotCommittedError extends Error {
  override readonly name = 'ResubmitNotCommittedError';

  constructor(readonly chapterIndex: number) {
    super(
      'chapter ' +
        chapterIndex +
        ' is not phase=committed — resubmit requires a CanonCommitted chapter (reopen it via requestResubmit only)',
    );
  }
}

/** 重提交期间的真相锚：phase=committed 最新 commit 的事件行三元组。 */
export interface CommittedTruthAnchor {
  readonly commitId: string;
  readonly contentSha256: string;
  readonly proseRelPath: string;
}

/**
 * 重提交期间的真相读取：扫运行时事件流里本章的 ChapterCommitted 行，后到者胜
 * （append-only ⇒ 最后一行即最新 commit）。正文文件相位与此无关——即便它已被
 * reopen 翻回 draft，真相仍锚在最近一次 committed 上。无提交历史返回 null。
 * 纯读、确定性、逐字段可复算（恢复测试两次独立运行相等）。
 */
export function latestCommittedTruth(root: string, chapterIndex: number): CommittedTruthAnchor | null {
  const eventsAbs = join(root, RUNTIME_EVENTS_PATH);
  let raw: string;
  try {
    raw = readFileSync(eventsAbs, 'utf8');
  } catch {
    return null;
  }
  let anchor: CommittedTruthAnchor | null = null;
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 尾部半行等非致命残渣跳过（宁缺毋脏）
    }
    if (row['type'] !== 'ChapterCommitted' || row['chapterIndex'] !== chapterIndex) continue;
    const commitId = row['commitId'];
    const sha = row['contentSha256'];
    const prosePath = row['prosePath'];
    if (typeof commitId !== 'string' || typeof sha !== 'string' || typeof prosePath !== 'string') continue;
    anchor = { commitId, contentSha256: sha, proseRelPath: prosePath };
  }
  return anchor;
}

export interface ResubmitOutcome {
  /** 被重开的那个 commit（= 重启前的旧正典；其物理痕迹自此只增不改）。 */
  readonly reopenedFromCommitId: string;
  readonly proseRelPath: string;
  /** 重提交完成前的真相锚（恒指 reopenedFromCommitId；完成后由新 commit 前移）。 */
  readonly truthAnchor: CommittedTruthAnchor;
  /** 新 taskRef 新会话：光标停在 prepare，十步全量重走。 */
  readonly session: ChapterProductionSession;
}

/**
 * S9 重提交入口：committed 章 → 相位移回 draft + 开新会话窗口。次序：
 *   1. 前置守卫——正文必须 phase=committed（否则 ResubmitNotCommittedError）；
 *   2. start() 双守卫（同章 SessionAlreadyActive / 别章 GlobalSingleFlight）
 *      在 TaskStarted 落账之前拒绝——故任何拒绝路径都零盘面副作用；
 *   3. LocalDataPlane.open（内含 pending-commit 恢复）→ reopenChapter 翻相位
 *      （revision+1、摘 commitId、ChapterReopened 事件行落账；旧 commit 物理
 *      痕迹——追踪流行与本事件行——永不改写，I5）。
 * 若第 3 步异常中断，新窗口已在账：走 resume/恢复入口续接，不留半开状态机。
 */
export function requestResubmit(deps: ChapterProductionSessionDeps): ResubmitOutcome {
  const proseRel = proseChapterPath(deps.chapterIndex);
  if (!existsSync(join(deps.root, proseRel))) {
    throw new ResubmitNotCommittedError(deps.chapterIndex);
  }
  const scan = readProseChapter(deps.root, proseRel);
  if (scan.phase !== 'committed' || scan.commitId === undefined) {
    throw new ResubmitNotCommittedError(deps.chapterIndex);
  }

  const session = ChapterProductionSession.start(deps);

  const plane = LocalDataPlane.open(deps.root);
  const reopened = plane.reopenChapter(deps.chapterIndex);

  const anchor = latestCommittedTruth(deps.root, deps.chapterIndex);
  if (anchor === null || anchor.commitId !== scan.commitId) {
    // 有相位无事件行＝账实不符：宁败不猜（真相锚是 S9 读真相的唯一凭据）
    throw new Error(
      'chapter ' +
        deps.chapterIndex +
        ' committed phase lacks a matching ChapterCommitted anchor — ledger/prose inconsistent',
    );
  }

  return {
    reopenedFromCommitId: reopened.reopenedFromCommitId,
    proseRelPath: reopened.proseRelPath,
    truthAnchor: anchor,
    session,
  };
}
