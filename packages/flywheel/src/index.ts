/**
 * @mozhou/flywheel — 数据飞轮学习者包（Phase 4；t53:C7 随首只 learner 建包）。
 *
 * T22 · #55：AuthorPreferenceLearner——从 readPipelineLedger 只读消费
 * candidate_decision（accepted/rejected 双路强信号）+ UserEditRecorded
 * {action:'edit_blocks'}（source==='author' 过滤）+ FlywheelRecorded（窗口锚），
 * 产出七维偏好画像。本包是纯消费端：不改事件词表、不加事件、不改既有
 * payload（受控增补清单为空，t47-a F4）。
 */

/** 冻结常量与观测类型（t51:A1/A2/A4）。 */
export {
  DRIFT_ALPHA,
  DRIFT_STREAK_MIN,
  KAPPA0,
  M0,
  MIN_SAMPLES_FOR_JUDGMENT,
  OBSERVATION_KINDS,
  PREFERENCE_DIMS,
  W_DECISION,
  W_EDIT_DELETE,
  W_EDIT_PROSE,
} from './types.js';
export type {
  EditActionLevelV1,
  ObservationKind,
  PreferenceDim,
  PreferenceObservation,
} from './types.js';

/** 特征面：七维确定性提取（f1-f7；词表依赖型显式出界）。 */
export {
  dialogueCharRatio,
  extractObservations,
  nearestRankPercentile,
  sentenceLengths,
  tokenizeUnits,
  ttrWin500,
} from './features.js';

/** 推理面：κ₀ 加权增量均值 + 短窗漂移监测（主均值不是 EMA）。 */
export {
  coldStartProfile,
  driftSigma,
  posteriorMean,
  reduce,
} from './inference.js';
export type {
  DimState,
  DriftEvent,
  PreferenceProfileState,
} from './inference.js';

/** 存储面：.mozhou/preference/{observations.jsonl, profile.json}（R3 删除即重置）。 */
export {
  OBSERVATIONS_RELPATH,
  PREFERENCE_DIR,
  PROFILE_RELPATH,
  appendObservations,
  hasMaterializedProfile,
  loadProfileOrColdStart,
  loadProfileSnapshot,
  readPersistedObservations,
  rewriteObservations,
  saveProfileSnapshot,
} from './storage.js';

/** 编排面四导出：extractObservations / reduce / runPreferenceLearning / rebuildPreference。 */
export { rebuildPreference, runPreferenceLearning } from './learner.js';
export type { PreferenceLearningOutcome, PreferenceRebuildOutcome } from './learner.js';

/** 学习核：四场景型 StyleProfile vN 演化（T23 · #56；t51:B6 / t48-b §3-§4）。
 *  纯函数零 IO——持久化归 StyleProfileStore 单口，触发点归 Flywheel Record 步。 */
export {
  STYLE_ALPHA,
  STYLE_ALPHA_BOOST,
  STYLE_DELTA_MAX,
  STYLE_NMIN,
  TABOO_CAPACITY,
  TABOO_PROMOTION_MIN_CHAPTERS,
  TABOO_PROMOTION_MIN_HITS,
  emptyTabooCandidateState,
  updateStyleProfiles,
} from './style-learner.js';
export type {
  ScenarioBatchOutcome,
  StyleEditObservation,
  StyleUpdateReport,
  StyleUpdateResult,
  TabooCandidateEntry,
  TabooCandidateState,
  TabooPromotion,
  UpdateStyleProfilesOptions,
} from './style-learner.js';

/** 归一化写口：StyleProfileStore 唯一写者 + taboo 候选侧账（t51:B1 受控豁免三件套）。 */
export {
  TABOO_STATE_RELPATH,
  loadTabooCandidateState,
  saveTabooCandidateState,
  writeStyleProfiles,
} from './style-store.js';
export type {
  StyleWriteAudit,
  WriteStyleProfilesOutcome,
  WriteStyleProfilesRequest,
} from './style-store.js';

/** 触发点编排：Flywheel Record 步 afterRecord 钩子注入入口（t48-b §6-C）。 */
export { runStyleLearnerForWindow } from './style-runner.js';
export type { RunStyleLearnerOutcome, RunStyleLearnerRequest } from './style-runner.js';

/** 注入缝：StyleProfile → compile() structuralSections（t51:B4 四场景型全注入 ≤800 token）。 */
export {
  STYLE_SECTIONS_TOKEN_BUDGET,
  assertStyleSectionsWithinBudget,
  estimateStyleSectionsTokens,
  renderStyleSections,
} from './style-sections.js';

/** 语义层骨架（T28 · #69）：advisory-only 报告载荷 + 分析器 + 一报一文件存储。 */
export {
  INPUT_TOKEN_CAP,
  OUTPUT_TOKEN_CAP,
  analyzeSemantic,
} from './semantic/analyze.js';
export type { AnalyzeDeps, AnalyzeInput, AnalyzeOutcome } from './semantic/analyze.js';
export {
  SEMANTIC_DIR_RELPATH,
  countSemanticReports,
  readSemanticReports,
  writeSemanticReport,
} from './semantic/report-store.js';
export type {
  AffectedRef,
  SemanticAnalysisReport,
  SemanticFinding,
  SemanticInputStats,
  SemanticVerdict,
} from './semantic/types.js';

/** 语义批次编排与派生投影（T29 · #70；D12/D14/E3/E5）。 */
export { runSemanticBatch } from './semantic/batch.js';
export type { RunSemanticBatchRequest, SemanticBatchItem, SemanticBatchOutcome } from './semantic/batch.js';
export { selectSemanticAnalysisRows } from './semantic/projection.js';
export type { SemanticAnalysisRow } from './semantic/projection.js';
