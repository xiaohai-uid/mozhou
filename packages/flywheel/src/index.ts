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
