/**
 * 章节提交编排（步 6-10 单一事实源 · 工单04 2026-09-28）。
 *
 * 背景：web 提交路由（proseRoutes /api/chapter.commit）曾就地实现 260 行步 6-10 编排，
 * 与本包 module 实现是同一套规则的第二份（ADR-0024 说一遍，module 写一遍，route 又写
 * 一遍）。本模块把编排收进管线边界：路由只保留输入解码、身份/书权限与响应契约映射，
 * 步序规则在此只出现一次。
 *
 * 职责边界（编排规则全部在此，路由不做第二步实现）：
 *   - 步 6 前置守卫：合法相位检查（draft）先于提取缝（工单 02 缺陷 A——重复提交必须
 *     在 0 消耗处拒绝，不得先跑提取再撞 409）；expectedRevision 比对（工单05 Contract
 *     Delta）同列前置守卫——作者所读 revision 与盘不符即在 0 消耗处 409；
 *   - 结果契约 / commitChapter 透传 expectedRevision（TOCTOU 兜底，提取 await 期间的
 *     并发保存由数据平面写路守卫拦截）；
 *   - D06 依赖钉版回读（无暂存 = 不带清单提交；形状非法由回读显式抛错）；
 *   - 窗口键 `web_commit_ch<N>_rev<R>`（webCommitWindowTaskRef）：步 8 提案绑定 /
 *     步 10 窗口锚 / 保存路径编辑信号共用同一格式——**键形状冻结**（风格学习器按
 *     taskRef 精确匹配 + T21 编辑 delta 同键，user-edit-step.ts 注释），漂移 = 学习器
 *     静默读零条编辑；
 *   - 提案续接规则：同 taskRef 未决提案续接（不重跑提取不重落提案）；同章旧正文提案
 *     显式 stale（不静默丢弃作者逐条决策）；
 *   - 步 6 提取（**注入缝**）：管线不 import web 提取器——真实模型调用由调用方注入
 *     （extractDelta），管线供 bookId/chapterIndex/prose 上下文；
 *   - 会话窗口驱动（工单03）：adoptOpenHeads → resume → 回炉判定 → 步锚 → 步进 →
 *     markCommitted → finish；未行走窗口维持作废收口；
 *   - 步 7 门禁（初始 + 已确认集重核检两处）→ 步 8 提案/待决 → 步 9 commitChapter →
 *     ProposalPort.markConsumed（提交成功后才翻 consumed）；
 *   - 步 10 收尾记账（**注入缝** afterRecord）：飞轮窗口锚 + 调用方钩子（StyleLearner
 *     在 @mozhou/flywheel，依赖方向 flywheel→pipeline 禁止反向 import，故由编排方注入，
 *     record-step 的 afterRecord 语义缝同款）。
 *
 * 结果契约：区分「提交成功」与三类显式挂起（stale / gate_conflict / pending），
 * 调用方据此渲染响应；错误（ChapterPhaseError / PreWriteHashMismatchError / ENOENT /
 * 提案落盘即不可读）原样抛出由调用方映射。所有派生面（flywheel / 会话收口）失败不
 * 回退已落定的提交，如实上报（S12 同款）。
 */
import {
  ChapterPhaseError,
  ProseRevisionConflictError,
  proseChapterPath,
  readProseChapter,
  releaseBook,
  retainBook,
} from '@mozhou/data-plane';
import { PublishBus } from '@mozhou/runtime';
import { readPendingDependencyManifest } from './compile-step.js';
import type { CandidateDeltaBatch } from './extract-step.js';
import { runFinalExtract } from './extract-step.js';
import type { HardConflict } from './gate-step.js';
import { runContinuityGate } from './gate-step.js';
import type { CanonProposalRecord } from './proposal-step.js';
import { createCanonProposal, listCanonProposals, loadCanonProposal } from './proposal-step.js';
import { ProposalPort, confirmedAppendsForCommit } from './proposal-port.js';
import type { FlywheelRecordStatus, UsageFact } from './record-step.js';
import { runFlywheelRecord } from './record-step.js';
import { ChapterProductionSession } from './session.js';

/**
 * web 路径的窗口键（步 8 提案绑定 / 步 10 窗口锚 / 保存路径的编辑信号共用同一格式）：
 * `web_commit_ch<N>_rev<R>`，R = 窗口闭合（提交）时的盘上 revision。
 * 保存路径以**本次保存后的 revision** 落编辑信号，故「保存后即提交」的正常流下
 * 作者编辑与本窗口对齐（runStyleLearnerForWindow 按 taskRef 精确匹配本窗口）。
 * 键形状被 pipeline 学习器链路与 whole-body-edit 测试依赖，**冻结不改**——
 * 格式漂移会让学习器静默读到零条编辑。
 */
export function webCommitWindowTaskRef(chapterIndex: number, revision: number): string {
  return 'web_commit_ch' + chapterIndex + '_rev' + revision;
}

/** 同 taskRef 的未决提案（提交重试的续接锚：同一正文 revision 的提案唯一）。 */
function openProposalForTaskRef(root: string, taskRef: string): CanonProposalRecord | null {
  return (
    listCanonProposals(root).find(
      (record) => record.state === 'open' && record.taskRef === taskRef,
    ) ?? null
  );
}

/** 本章未收口的提案（正文已改 ⇒ 盘上提案描述的是旧正文，编排据此显式拒绝而非静默丢弃）。 */
function openProposalsOfChapterIndex(root: string, chapterIndex: number): CanonProposalRecord[] {
  return listCanonProposals(root).filter(
    (record) => record.state === 'open' && record.chapterIndex === chapterIndex,
  );
}

/** 提取缝的返回形状（web DeltaExtractionResult 的结构镜像；不引入对 web 的依赖）。 */
export interface ChapterCommitExtraction {
  readonly appends: CandidateDeltaBatch;
  readonly counts: Readonly<Record<string, number>>;
  readonly dropped: readonly { readonly family: string; readonly reason: string }[];
  /** 'llm' = 真实提取；'none' = 未配置 provider 或提取失败（此时 appends 为空）。 */
  readonly extractor: 'llm' | 'none';
  readonly reason?: string | undefined;
}

/** 响应面 deltaExtraction 字段（提取摘要，成败如实呈现）。 */
export interface ChapterCommitDeltaSummary {
  readonly extractor: 'llm' | 'none';
  readonly counts: Readonly<Record<string, number>>;
  readonly dropped: readonly { readonly family: string; readonly reason: string }[];
  readonly reason?: string;
}

/** 步 10 收尾记账呈现面（降级与钩子失败都必须可被作者看见）。 */
export interface ChapterCommitFlywheelRecordView {
  readonly status: FlywheelRecordStatus;
  readonly recordedCount: number;
  readonly errorDetail: string | null;
  readonly afterRecordError: string | null;
}

/** 会话窗口驱动呈现面（走完的窗口不需要作废，与作废收口正交）。 */
export interface ChapterCommitSessionWindowView {
  readonly driven: boolean;
  readonly taskRef: string | null;
  readonly completed: boolean;
  readonly errorDetail: string | null;
}

/** 提交后「陈旧重提交窗口」清理呈现面（S9 作废收口；失败不回退已落定的提交）。 */
export interface ChapterCommitCleanupView {
  readonly abandoned: boolean;
  readonly taskRef: string | null;
  readonly errorDetail: string | null;
}

/** 编排结局：提交成功；或三类显式挂起（调用方渲染 409，本章正典零写入）。 */
export type ChapterCommitOutcome =
  | {
      readonly kind: 'committed';
      readonly commitId: string;
      readonly chapterIndex: number;
      readonly contentSha256: string;
      /** 提交收口后的提案记录（markConsumed 已翻 consumed）；无候选直提为 null。 */
      readonly canonProposal: CanonProposalRecord | null;
      readonly deltaExtraction: ChapterCommitDeltaSummary | null;
      readonly flywheelRecord: ChapterCommitFlywheelRecordView;
      readonly sessionWindow: ChapterCommitSessionWindowView;
      readonly resubmitWindowCleanup: ChapterCommitCleanupView;
    }
  | { readonly kind: 'proposal_stale'; readonly staleProposals: readonly CanonProposalRecord[] }
  | {
      readonly kind: 'proposal_pending';
      readonly record: CanonProposalRecord;
      readonly deltaExtraction: ChapterCommitDeltaSummary | null;
    }
  | {
      readonly kind: 'gate_conflict';
      readonly hardConflicts: readonly HardConflict[];
      /** 已确认集重核检失败时携带提案身份；初始门禁失败为 null。 */
      readonly proposalId: string | null;
      readonly deltaExtraction: ChapterCommitDeltaSummary | null;
    };

export interface RunChapterCommitRequest {
  readonly root: string;
  readonly chapterIndex: number;
  readonly summary: string;
  /**
   * 作者实际读取的章版本（工单05 Contract Delta，照搬 /api/prose.save 冻结契约——
   * 路由已保证在场且为整数）。与盘上 revision 失配即在提取缝之前抛
   * ProseRevisionConflictError（模型调用增量 0、正文/正典零写入），并随
   * plane.commitChapter 透传兜住提取 await 期间的并发保存（TOCTOU）。
   */
  readonly expectedRevision: number;
  /** 步 10 同步侧 usage/cost 事实（形状校验在调用方动盘之前完成）。 */
  readonly usage: readonly UsageFact[];
  /**
   * 步 6 提取缝（ADR-0004 语义缝）：管线供上下文，调用方做真实模型调用（web 侧
   * extractChapterDelta + resolveEndpoint）。提取失败由提取器自表述（空批 + reason），
   * 不阻塞提交——作者的正文必须能定稿，叙事层零增长如实上报。
   */
  readonly extractDelta: (input: {
    readonly bookId: string;
    readonly chapterIndex: number;
    readonly prose: string;
  }) => Promise<ChapterCommitExtraction>;
  /**
   * 窗口闭合钩子（T23 · #56 触发点）：FlywheelRecorded 落账后以本窗口 taskRef 调用——
   * 数据飞轮学习者（StyleLearner）经此自读窗口编辑并更新派生画像。依赖方向：pipeline
   * 不 import flywheel，回调由编排方注入。钩子抛错不阻断正文（S12），错误文本随
   * flywheelRecord.afterRecordError 如实上报。
   */
  readonly afterRecord?: (window: { readonly taskRef: string }) => void;
}

/**
 * 步 6-10 提交编排执行：见模块头注释。整段编排对一个 plane 生命周期内完成
 * （plane 在 finally 关闭，异常照常抛给调用方映射）。
 */
export async function runChapterCommit(request: RunChapterCommitRequest): Promise<ChapterCommitOutcome> {
  const { root, chapterIndex } = request;
  // 句柄所有权跨 await 显式转移（工单 08）：提取缝（真实模型调用）与门禁都在
  // await 之下，而 commitChapter 必须在同一句柄上完成——句柄必须活过 await，
  // 词法借用的 withBook 表达不了（它承诺 await 前就归还）。故走 retain/release：
  // acquire 在函数入口、release 在 finally，二者成对且都在本函数内可见。
  const plane = retainBook(root);
  try {
    const proseFile = readProseChapter(root, proseChapterPath(chapterIndex));
    const prose = proseFile.body;
    // 工单 02 缺陷 A：合法相位检查前移到提取缝（真实 LLM 调用）之前——committed 章
    // 的重复提交必须在 0 消耗处拒绝（同一错误类型 + commitChapter 的同一 detail 文案，
    // 响应契约由调用方渲染）。
    if (proseFile.phase !== 'draft') {
      throw new ChapterPhaseError(chapterIndex, 'chapter is committed — reopen it before re-committing');
    }
    // 工单05 Contract Delta：作者所读 revision 与盘不符 ⇒ 在提取缝（真实 LLM 调用）之前
    // 拒绝——过期提交必须 0 消耗 409，正文/正典/账本零写入。相位守卫在前（照搬
    // saveProseDraft 的检查顺序，chapter.ts:802-806）：已提交章仍回相位 409（工单02
    // 缺陷 A 语义不变）。expectedRevision 同时随 commitChapter 透传（TOCTOU 兜底）。
    if (proseFile.revision !== request.expectedRevision) {
      throw new ProseRevisionConflictError(chapterIndex, request.expectedRevision, proseFile.revision);
    }
    // D06 依赖钉版消费侧：无暂存 = 本章未经编译（手写/结构层降级）⇒ 不带清单，如实
    // 声明「本章不钉任何上游版本」；暂存存在但形状非法则由回读显式抛错（绝不静默丢钉版）。
    const pendingManifest = readPendingDependencyManifest(root, chapterIndex);
    const dependencyManifestFields = pendingManifest === null ? {} : { dependencyManifest: pendingManifest };
    // 步 8 提案与正文 revision 绑定：同一 revision 的提交重试续接同一提案
    // （否则每次重试都重跑提取、再落一份同内容提案，且新提案的行 id 与作者
    // 已确认的行对不上——「只写已确认集」就无从谈起）。
    const taskRef = webCommitWindowTaskRef(chapterIndex, proseFile.revision);
    const port = new ProposalPort({ root });

    // 步 10 收尾记账：两条提交分支共用同一调用点语义（同一窗口恰一条
    // FlywheelRecorded）。记账是派生面——正文与正典此刻已落定，本函数
    // 的任何失败都只降级上报，绝不回退提交。
    const recordFlywheel = (commitId: string): ChapterCommitFlywheelRecordView => {
      let afterRecordError: string | null = null;
      const outcome = runFlywheelRecord({
        bus: new PublishBus(),
        bookRoot: root,
        taskRef,
        chapterIndex,
        commitId,
        usage: request.usage,
        afterRecord: () => {
          // 窗口闭合钩子（T23 · #56）：调用方注入的学习器（StyleLearner）自读本窗口
          // author 编辑并更新派生画像。record-step 会吞掉钩子抛错（S12），故此处先
          // 留痕再原样抛出——静默吞掉会让「学习器从未运行」看起来像「一切正常」。
          try {
            request.afterRecord?.({ taskRef });
          } catch (cause) {
            afterRecordError = (cause as Error).message;
            throw cause;
          }
        },
      });
      return {
        status: outcome.status,
        recordedCount: outcome.recordedCount,
        errorDetail: outcome.errorDetail,
        afterRecordError,
      };
    };

    // S9 收口：作者经 web 重新定稿 ⇒ 本章残留的会话窗口（requestResubmit 开的、
    // 或 session.open 开的）已过时，就地作废。只在 commitChapter 落定之后调用
    // （提交成功才代表窗口过时；被拒的提交必须零副作用）。作废发布
    // TaskFinished{outcome:'abandoned'} 闭合配对并释放全局单飞，绝不发
    // CanonCommitted（完成态语义不动）。失败不回退已落定的提交，如实上报。
    const cleanupStaleResubmitWindow = (): ChapterCommitCleanupView => {
      try {
        const abandonedRef = ChapterProductionSession.abandonOpenWindow(
          { bus: new PublishBus(), root, chapterIndex },
          'author_resubmitted',
        );
        return { abandoned: abandonedRef !== null, taskRef: abandonedRef, errorDetail: null };
      } catch (cause) {
        return { abandoned: false, taskRef: null, errorDetail: (cause as Error).message };
      }
    };

    // 工单03（session 走完第 9/10 步）：会话窗口驱动器。本章存在活动会话窗口时
    // （requestResubmit / session.open 开出，TaskStarted 已在第 1 步落账、findOpenSessionWindow
    // 由此看见它），作者已把会话走到 user_edit 及之后（session.advance / chapter.review
    // 驱动步 2-5），本次提交即沿十步收口该窗口；光标停在 prepare..review 的未行走窗口
    // 驱动面全部空转（driveEngaged=false），维持作废收口。
    // adoptOpenHeads：TaskStarted / CanonProposalCreated 配对头只活在发布总线实例内存里，
    // 恢复请求发尾事件（CanonCommitted / TaskFinished）前必须认领，否则 PAIRING_TAIL_WITHOUT_HEAD。
    const driveBus = new PublishBus();
    driveBus.adoptOpenHeads({ root });
    const drive = ChapterProductionSession.resume({ bus: driveBus, root, chapterIndex });
    const driveEngaged =
      drive !== null &&
      (drive.currentStep === 'user_edit' ||
        drive.currentStep === 'final_extract' ||
        drive.currentStep === 'continuity_gate' ||
        drive.currentStep === 'canon_proposal' ||
        drive.currentStep === 'commit');

    // 工单03 步 9/10 收口：markCommitted（窗口内 CanonProposalCreated 的配对尾）→
    // 步进 flywheel_record → finish（TaskFinished{outcome:'succeeded'}）。仅在驱动
    // 生效时执行；失败不回退已落定的提交（派生面，S12 同款），errorDetail 如实上报。
    const completeDrivenSession = (commitId: string): ChapterCommitSessionWindowView => {
      if (drive === null || !driveEngaged) {
        return { driven: false, taskRef: null, completed: false, errorDetail: null };
      }
      // 经函数读取当前步：advance() 的运行时副作用 TS 的属性收窄看不见，
      // 直接比较 getter 会被上一行的字面量收窄误判（TS2367）。
      const stepOf = (): string => drive.currentStep;
      try {
        if (stepOf() === 'canon_proposal') drive.advance('commit');
        if (stepOf() === 'commit' && !drive.isCompleted()) drive.markCommitted(commitId);
        if (stepOf() === 'commit') drive.advance('flywheel_record');
        if (stepOf() === 'flywheel_record' && !drive.project().finished) drive.finish();
        return { driven: true, taskRef: drive.taskRef, completed: true, errorDetail: null };
      } catch (cause) {
        return { driven: true, taskRef: drive.taskRef, completed: false, errorDetail: (cause as Error).message };
      }
    };

    // 工单03 步 8 步锚：会话窗口内的 CanonProposalCreated 配对头（markCommitted 的
    // CanonCommitted 是它的配对尾，发布总线当场强制）。幂等：头已在账（上一请求落了
    // 锚、本次崩溃恢复续跑）则跳过——重复开锚即 PAIRING_HEAD_UNCLOSED。这是窗口内
    // 的任务事件步锚（payload 携带 web 提案记录 proposalId 作关联），不落 .mozhou/
    // proposals/ 提案文件，不会污染 listPendingProposalRefs 的文件扫描。
    const anchorDrivenProposal = (payload: Record<string, unknown>): void => {
      if (drive === null || !driveEngaged || drive.currentStep !== 'canon_proposal') return;
      if (drive.project().openHeads.includes('CanonProposalCreated#' + drive.taskRef)) return;
      drive.recordProposal(payload);
    };

    let record = openProposalForTaskRef(root, taskRef);
    let deltaExtraction: ChapterCommitDeltaSummary | null = null;

    if (record === null) {
      const stale = openProposalsOfChapterIndex(root, chapterIndex);
      if (stale.length > 0) {
        // 正文已改（revision 变）：盘上未决提案描述的是旧正文。既不能拿旧行写正典，
        // 也不能静默丢弃作者的逐条决策——显式拒绝并给出收口入口。
        return { kind: 'proposal_stale', staleProposals: stale };
      }

      // 工单03 步 5→6 边界：门禁 hard_conflict 悬置的窗口，作者改文再提交即显式
      // 回炉驱动（S7：requestRework 承认错误改文，回炉重走 Final Extract 全量重提取
      // ——S7 无自动迭代，重提交就是作者的显式动作）；光标在 user_edit 的窗口步进
      // final_extract。悬置判据读当下投影（崩溃恢复后同样可判），不是内存光标。
      if (drive !== null && driveEngaged) {
        if (drive.currentStep === 'continuity_gate' && drive.project().lastGateVerdict === 'hard_conflict') {
          drive.requestRework();
        }
        if (drive.currentStep === 'user_edit') drive.advance('final_extract');
      }

      // 步 6 Final Extract 接线：终稿 → 五族叙事状态增量。提取走注入缝（调用方的
      // 真实模型实现）；提取失败不阻塞提交（作者的正文必须能定稿），但必须在响应里
      // 如实报出，否则「提交后叙事层零增长」会被误读为「一切正常」。
      const delta = await request.extractDelta({ bookId: plane.book.id, chapterIndex, prose });
      deltaExtraction = {
        extractor: delta.extractor,
        counts: delta.counts,
        dropped: delta.dropped,
        ...(delta.reason === undefined ? {} : { reason: delta.reason }),
      };

      // 工单03 步 6 步锚：复用管线 extract-step 模块（runFinalExtract）把提取产物以
      // 会话 taskRef 落账 CandidateDeltaExtracted（成败都落，账面可审计）；注入缝的
      // 提取产物作为显式注入（ADR-0004 语义缝），单次提取双消费。
      // 光标已越过 final_extract 的崩溃恢复续跑不再补锚（步锚只归属所属步）。
      if (drive !== null && driveEngaged && drive.currentStep === 'final_extract') {
        runFinalExtract({
          bus: driveBus,
          bookRoot: root,
          taskRef: drive.taskRef,
          chapterIndex,
          extract: () => delta.appends,
        });
      }

      if (Object.keys(delta.appends).length === 0) {
        // 无候选可路由：步 8 不落空提案（无内容的 CanonProposalCreated 只会污染
        // 悬挂扫描），直接提交——叙事层零增长由 deltaExtraction 如实报出。
        // 工单03 驱动面：步 7 空批空过（与响应 continuityGate.verdict='pass'
        // 同一判据——零候选无冲突可检，不为此强拉快照）→ 步 8 空步锚（只进窗口
        // 事件流配对 markCommitted，不落提案文件）→ 步 9。
        if (drive !== null && driveEngaged && drive.currentStep === 'final_extract') {
          drive.advance('continuity_gate', { verdict: 'pass' });
        }
        if (drive !== null && driveEngaged && drive.currentStep === 'continuity_gate') {
          drive.advance('canon_proposal');
        }
        anchorDrivenProposal({ candidates: 0, note: 'no_candidates' });
        if (drive !== null && driveEngaged && drive.currentStep === 'canon_proposal') {
          drive.advance('commit');
        }
        const result = plane.commitChapter({
          chapterIndex,
          summary: request.summary,
          expectedRevision: request.expectedRevision,
          ...dependencyManifestFields,
        });
        return {
          kind: 'committed',
          commitId: result.commitId,
          chapterIndex: result.chapterIndex,
          contentSha256: result.contentSha256,
          canonProposal: null,
          deltaExtraction,
          flywheelRecord: recordFlywheel(result.commitId),
          sessionWindow: completeDrivenSession(result.commitId),
          resubmitWindowCleanup: cleanupStaleResubmitWindow(),
        };
      }

      // 步 7 Continuity Gate：候选 delta 写正典前过机械核检。冲突 = 硬门禁，
      // 提案不落盘、commitChapter 一步不调（正典零写入），冲突清单经调用方
      // 回给作者——回炉重提取是唯一出路，不许静默放行。
      const gate = runContinuityGate({ bookRoot: root, chapterIndex, delta: delta.appends, prose });
      // 工单03 步 7 步进：verdict 与 hardConflicts 随 TaskStepTransitioned 的 Result
      // 字段进账（§1 表第 7 行）——pass / hard_conflict 都落（悬置窗口的回炉判据读
      // 投影，S7/S8）；冲突时正典零写入、窗口悬置在 continuity_gate。
      if (drive !== null && driveEngaged && drive.currentStep === 'final_extract') {
        drive.advance('continuity_gate', { verdict: gate.verdict, hardConflicts: gate.hardConflicts });
      }
      if (gate.verdict === 'hard_conflict') {
        return { kind: 'gate_conflict', hardConflicts: gate.hardConflicts, proposalId: null, deltaExtraction };
      }

      // 工单03 步 7→8 步进（含崩溃恢复续跑：光标已在 continuity_gate 且 pass 的
      // 窗口——上次请求在步进 canon_proposal 前中断——直接前进，不重复步 7 步进）。
      if (drive !== null && driveEngaged && drive.currentStep === 'continuity_gate') {
        drive.advance('canon_proposal');
      }

      // 步 8 Canon Proposal：riskClass 三档分流（low 入场即 confirmed，medium/high 挂起）。
      const created = createCanonProposal({
        bus: new PublishBus(),
        bookRoot: root,
        taskRef,
        chapterIndex,
        delta: delta.appends,
      });
      record = loadCanonProposal(root, created.proposalId);
      if (record === null) {
        // 刚落盘即读不回 = 盘面故障：绝不降级为「无提案直接提交」把未确认行写进正典
        throw new Error('canon proposal ' + created.proposalId + ' unreadable right after persist');
      }
    }

    // 工单03 步 8 步锚（汇聚点）：新建提案与崩溃恢复续跑（record 已存在）两条路径
    // 都在此落窗口内的提案配对头。
    if (drive !== null && driveEngaged && record !== null) {
      anchorDrivenProposal({ proposalId: record.proposalId });
    }
    // 待决 = 挂起（S6）：medium 等队列确认、high 等显式确认——本章正典零写入、
    // 相位不翻转；提案记录已落盘，跨重启保持待决。
    if (record.items.some((item) => item.state === 'pending')) {
      return { kind: 'proposal_pending', record, deltaExtraction };
    }

    // Commit 只写已确认集（S6）：confirmed + edit_accepted（含 patch 后载荷），
    // rejected 排除在外。ProposalPort 在仍有未决条目时拒读（上方已拦）。
    const appends = confirmedAppendsForCommit(root, record.proposalId);

    // 写前门禁：续接路径的载荷可能经作者 editAccept 改动，写正典前必须重过核检
    // （Gate 是确定性纯核检，幂等重算；此处不通过则提案保持未收口，正典零写入）。
    const confirmedGate = runContinuityGate({ bookRoot: root, chapterIndex, delta: appends, prose });
    if (confirmedGate.verdict === 'hard_conflict') {
      return {
        kind: 'gate_conflict',
        hardConflicts: confirmedGate.hardConflicts,
        proposalId: record.proposalId,
        deltaExtraction,
      };
    }

    const hasAppends = Object.keys(appends).length > 0;
    // 工单03 步 8→9 步进：先步进 commit 再动盘——崩溃窗口不留「盘已提交、
    // 光标未步进」的不可续跑态（光标停在 commit 的窗口恢复后直接 markCommitted）。
    if (drive !== null && driveEngaged && drive.currentStep === 'canon_proposal') {
      drive.advance('commit');
    }
    const result = plane.commitChapter({
      chapterIndex,
      summary: request.summary,
      expectedRevision: request.expectedRevision,
      ...(hasAppends ? { appends } : {}),
      ...dependencyManifestFields,
    });

    // 提案收口：commitChapter 成功之后才翻 consumed——提交失败时作者的逐条决策
    // 必须留在提案记录里供重试，收口过早等于丢弃作者劳动。
    port.markConsumed({ port: 'pipeline', proposalId: record.proposalId });

    return {
      kind: 'committed',
      commitId: result.commitId,
      chapterIndex: result.chapterIndex,
      contentSha256: result.contentSha256,
      canonProposal: loadCanonProposal(root, record.proposalId) ?? record,
      deltaExtraction,
      flywheelRecord: recordFlywheel(result.commitId),
      sessionWindow: completeDrivenSession(result.commitId),
      resubmitWindowCleanup: cleanupStaleResubmitWindow(),
    };
  } finally {
    releaseBook(plane);
  }
}
