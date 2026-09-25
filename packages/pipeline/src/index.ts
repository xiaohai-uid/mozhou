/** @mozhou/pipeline — 十步事务管线编排（T16 · #40：ChapterProductionSession + Prepare/Compile 衔接）。 */

/** C2 候选契约（T03）：未经 Accept 只写候选区；WriteBase 唯一领域定义。 */
export {
  CandidateError,
  CANDIDATE_DIR,
  CANDIDATE_TERMINAL,
  acceptDraftCandidate,
  appendCandidateDelta,
  cancelCandidate,
  candidateRelPath,
  createCandidateId,
  createDraftCandidate,
  finishCandidate,
  isServerGeneratedCandidateId,
  listDraftCandidates,
  readDraftCandidate,
} from './draft-candidate.js';
export type { CandidateMode, CandidateStatus, DraftCandidate, DraftCandidateRequest, WriteBase } from './draft-candidate.js';

/** C2 受控采纳（T04）：意图日志 + 幂等恢复 + CAS 落盘。 */
export { AcceptConflictError, acceptDraft, findIntentByKey, proseFileSha256 } from './draft-accept.js';
export type { AcceptDraftRequest, AcceptDraftResult } from './draft-accept.js';

/** 十步步进词表与序关系。 */
export { PIPELINE_STEPS, isPipelineStep, nextStepOf, stepIndex } from './steps.js';
export type { PipelineStep } from './steps.js';

/** 管线侧账本读取（双行格式容读；撕裂行跳过）。 */
export { readPipelineLedger } from './ledger.js';
export type { PipelineLedgerRow } from './ledger.js';

/** 会话步投影（当前步随时可重建；完成态=CanonCommitted 存在性）。 */
export { findOpenSessionWindow, projectSession } from './projection.js';
export type { SessionProjection } from './projection.js';

/** ChapterProductionSession 内存态状态机。 */
export {
  ChapterProductionSession,
  CommitNotRecordedError,
  GateNotPassedError,
  GlobalSingleFlightError,
  HardConflictUnresolvedError,
  QualityReviewNotPassError,
  QualityReworkLimitExceededError,
  QualityReworkNotDrivenError,
  ReworkNotDrivenError,
  SessionAlreadyActiveError,
  SessionNotResumableError,
  StepGuardError,
  StepTransitionError,
} from './session.js';
export type { ChapterProductionSessionDeps } from './session.js';

/** Prepare 步：纯函数查询组合，不落盘。 */
export {
  prepareChapterInputs,
  QUALITY_SECTION,
  qualityStructuralSections,
  READER_EXPERIENCE_PATH,
  MEMORY_ANCHORS_PATH,
  FAILURE_MEMORY_PATH,
} from './prepare.js';
export type {
  ActivePromiseView,
  AuthorIntentView,
  ChapterOutlineView,
  ChapterPrepareInputs,
  QualityPreparationSlice,
  SceneView,
} from './prepare.js';

/**
 * 多候选择优（T17 · #41；ADR-0013）：候选呈现 CandidateCreated + 择优决策
 * accepted/rejected 双路同账落一行方为有效飞轮信号。
 */
export {
  presentCandidates,
  recordCandidateDecision,
} from './multi-candidate.js';
export type { CandidateDecisionRequest, CandidateOption, PresentedCandidate } from './multi-candidate.js';

/**
 * Draft 步（T17 · #41）：正文流写 phase=draft、断流 partial 半稿保留、
 * M17 三级降级可见性接线（静默/attempt 事件/failed_recoverable 上报）。
 */
export {
  DRAFT_STATE_DIR,
  ProviderTransportError,
  draftStateRelPath,
  makeDraftProviderBinding,
  readDraftState,
  runDraftStep,
} from './draft-step.js';
export type {
  DraftBindingOptions,
  DraftMode,
  DraftStateFile,
  DraftStatus,
  DraftStepOutcome,
  DraftStepRequest,
  DraftStreamSource,
} from './draft-step.js';

/**
 * User Edit 步（T17 · #41）：结构化编辑操作块捕获（非字符 diff）、保护位校验、
 * M16 五级动作位 V1 只做光标+选区两级；编辑即时落正文文件。
 */
export {
  EDIT_ACTION_LEVELS_V1,
  EditActionLevelError,
  EditBlockShapeError,
  applyEditBlocks,
  recordAuthorCorrection,
  recordUserEdit,
} from './user-edit-step.js';
export type {
  AuthorCorrectionOutcome,
  EditActionLevel,
  EditDeltaStats,
  EditOperationBlock,
  RecordAuthorCorrectionRequest,
  RecordUserEditRequest,
  UserEditOutcome,
} from './user-edit-step.js';


/**
 * Review 步（T17 · #41；ADR-0025 升级）：draft 产物 → 机械核检输入记录 +
 * 版本绑定 QualityReviewReport（报告落 .mozhou/quality-reviews/，非 Canon）。
 * 事件落账与回炉决策由编排者经 ChapterProductionSession 显式驱动。
 */
export { executeChapterReview, loadDraftForReview, runReviewStep } from './review-step.js';
export type {
  ExecuteChapterReviewOutcome,
  ExecuteChapterReviewRequest,
  MechanicalReviewInput,
  ReviewStepOutcome,
  RunReviewStepRequest,
} from './review-step.js';

/** Compile 步衔接：复用 compile() 缝；stale 警告继续+Receipt 留痕；receiptId 续跑；
 *  依赖钉版产出（D06）：编译入包实体钉版暂存于 .mozhou/dependency-manifests/，提交侧回读。 */
export {
  PENDING_DEPENDENCY_MANIFEST_DIR,
  STALE_WARNING_SECTION,
  buildDependencyManifest,
  loadReceiptForResume,
  pendingDependencyManifestPath,
  persistPendingDependencyManifest,
  readPendingDependencyManifest,
  renderStaleWarningContent,
  runCompileStep,
} from './compile-step.js';
export type { CompileStepOutcome, CompileStepRequest } from './compile-step.js';

/**
 * Final Extract 步（T18 · #42）：终稿全文 → 五族候选 delta（运行期驻留不落正典，
 * 丢失可接受重跑即恢复）；提取失败 = failed_recoverable 可重试；提取缝显式注入。
 */
export {
  CANDIDATE_FAMILIES,
  CandidateBatchShapeError,
  emptyCandidateCounts,
  runFinalExtract,
} from './extract-step.js';
export type {
  CandidateDeltaBatch,
  CandidateFamily,
  DeltaExtractor,
  DeltaExtractionInput,
  FinalExtractOutcome,
  FinalExtractStatus,
  RunFinalExtractRequest,
} from './extract-step.js';

/**
 * Continuity Gate 步（T18 · #42）：纯机械核检编排整合——M2 时间线单调 + 四族行校验
 * + POV 秘密零泄漏 + dependency 引用完整性；失败输出 Result 字段 hardConflicts[]
 * {factId, assertion, suggestion}；LLM 审查只许旁路建议（advisoryReviewer 独立可选
 * 调用，结论不入判定不入账——S5 死事件裁定）。
 */
export {
  runContinuityGate,
} from './gate-step.js';
export type {
  AdvisoryReviewer,
  AdvisorySuggestion,
  ContinuityGateOutcome,
  ContinuityGateRequest,
  GateCheckedCounts,
  GateVerdict,
  HardConflict,
} from './gate-step.js';

/**
 * Canon Proposal 步（T18 · #42）：通过 Gate 的候选 delta → riskClass 三档分流提案
 * 记录（low 自动落 canon；medium 队列挂起等待程序化确认；high 显式确认方可进
 * Commit）。记录持久化 .mozhou/proposals/——未确认提案跨重启待决的盘面凭据。
 */
export {
  ProposalRoutingError,
  createCanonProposal,
  listCanonProposals,
  loadCanonProposal,
  routeItemRisk,
  saveCanonProposal,
} from './proposal-step.js';
export type {
  CanonProposalItem,
  CanonProposalOutcome,
  CanonProposalRecord,
  CreateCanonProposalRequest,
  ProposalItemState,
  RoutingCounts,
} from './proposal-step.js';

/**
 * ProposalPort 统一确认面（T18 · #42 架构核心）：confirm / reject / editAccept
 * 逐条粒度，一个 Port 两个调用方——管线 Canon 提案与 T5 五态对账共用同一协议；
 * 未决提案跨重启待决（决策缓冲持久化 + listPendingProposalRefs 恢复入口）。
 */
export {
  ProposalPort,
  ProposalPortError,
  confirmedAppendsForCommit,
  listPendingProposalRefs,
} from './proposal-port.js';
export type { PortAction, ProposalMutationOutcome, ProposalPortDeps, ProposalPortRef } from './proposal-port.js';

/**
 * Flywheel Record 步（T19 · #43）：任务收尾事件 + usage/cost 投影；记账失败
 * 不阻断正文（state_degraded）；派生记账允许异步回灌至 usage 投影表。
 */
export {
  USAGE_PROJECTION_PATH,
  appendUsageRows,
  backfillDerivedUsage,
  readUsageProjection,
  runFlywheelRecord,
} from './record-step.js';
export type {
  FlywheelRecordOutcome,
  FlywheelRecordStatus,
  RunFlywheelRecordRequest,
  UsageFact,
  UsageRecord,
} from './record-step.js';

/**
 * S9 重提交管线（T19 · #43）：commit 后章节 requestResubmit——相位移回 draft
 * （I5：旧 commit 物理痕迹永不改写），新 taskRef 新会话全量重走十步；重提交
 * 期间读取真相 = phase=committed 的最新 commitId（事件行锚）。
 */
export {
  ResubmitNotCommittedError,
  latestCommittedTruth,
  requestResubmit,
} from './resubmit.js';
export type { CommittedTruthAnchor, ResubmitOutcome } from './resubmit.js';

/**
 * S10 watcher × S3（T19 · #43）：步边界检查点响应 EXTERNAL_MODIFIED（步内不打断）；
 * 对账软门禁=警告不硬阻塞，适用整条管线。
 */
export {
  CheckpointSuspendedError,
  guardedPipelineStep,
  pipelineReconciliationGate,
  stepBoundaryCheckpoint,
} from './watcher-checkpoint.js';
export type { ReconciliationWarning } from './watcher-checkpoint.js';

export {
  buildRevisionBriefsForMatrix,
  generateRevisionBrief,
} from './revision-cascading.js';

export type {
  ConflictFactItem,
  RevisionTaskBrief,
} from './revision-cascading.js';

export {
  createStagedOverlay,
  invalidateDownstreamStages,
  mergeStagedOverlay,
  stageScene,
} from './scene-stage.js';
export type {
  InvalidationResult,
  SceneStageRecord,
  StagedOverlay,
} from './scene-stage.js';

