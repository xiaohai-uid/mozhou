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

/** Compile 步衔接：复用 compile() 缝；stale 警告继续+Receipt 留痕；receiptId 续跑。 */
export {
  STALE_WARNING_SECTION,
  loadReceiptForResume,
  renderStaleWarningContent,
  runCompileStep,
} from './compile-step.js';
export type { CompileStepOutcome, CompileStepRequest } from './compile-step.js';
