/** @mozhou/pipeline — 十步事务管线编排（T16 · #40：ChapterProductionSession + Prepare/Compile 衔接）。 */

/** 十步步进词表与序关系。 */
export { PIPELINE_STEPS, isPipelineStep, nextStepOf, stepIndex } from './steps.js';
export type { PipelineStep } from './steps.js';

/** 管线侧账本读取（双行格式容读；撕裂行跳过）。 */
export { readPipelineLedger } from './ledger.js';
export type { PipelineLedgerRow } from './ledger.js';

/** 会话步投影（当前步随时可重建；完成态=CanonCommitted 存在性）。 */
export { projectSession } from './projection.js';
export type { SessionProjection } from './projection.js';

/** ChapterProductionSession 内存态状态机。 */
export {
  ChapterProductionSession,
  SessionAlreadyActiveError,
  SessionNotResumableError,
  StepGuardError,
  StepTransitionError,
} from './session.js';
export type { ChapterProductionSessionDeps } from './session.js';

/** Prepare 步：纯函数查询组合，不落盘。 */
export { prepareChapterInputs } from './prepare.js';
export type {
  ActivePromiseView,
  AuthorIntentView,
  ChapterOutlineView,
  ChapterPrepareInputs,
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
  recordUserEdit,
} from './user-edit-step.js';
export type {
  EditActionLevel,
  EditOperationBlock,
  RecordUserEditRequest,
  UserEditOutcome,
} from './user-edit-step.js';

/**
 * Review 步消费入口（T17 · #41）：draft 产物 → 机械核检输入记录；
 * 硬门禁本体归 T18，本票只保证可被核检入口消费。
 */
export { loadDraftForReview } from './review-step.js';
export type { MechanicalReviewInput } from './review-step.js';

/** Compile 步衔接：复用 compile() 缝；stale 警告继续+Receipt 留痕；receiptId 续跑。 */
export {
  STALE_WARNING_SECTION,
  loadReceiptForResume,
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
