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
