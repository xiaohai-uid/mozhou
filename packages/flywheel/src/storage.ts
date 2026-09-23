/**
 * 偏好派生数据存储（T22 · #55；t47-a §3 落点与形状）。
 *
 *   .mozhou/preference/observations.jsonl  追加日志：每条观测一行
 *   .mozhou/preference/profile.json        当前画像快照（首批观测后延迟物化，t51:A2）
 *
 * IO 纪律复刻 usage.jsonl 先例（record-step）：append-only 写、读侧 id 先到先得
 * 去重、撕裂行跳过（审计容忍）。R3 删除即重置——.mozhou 全区不入 canon hash
 * 基线，删 preference 目录 = 完整重置回冷启动，不触发对账破裂。
 *
 * **R1 标量红线**：本模块只接受/只落盘标量形状（types.ts PreferenceObservation、
 * inference.ts PreferenceProfileState）；任何 P0 正文片段在源头就进不来。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DimState, DriftEvent, PreferenceProfileState } from './inference.js';
import { coldStartProfile } from './inference.js';
import { OBSERVATION_KINDS, PREFERENCE_DIMS } from './types.js';
import type { EditActionLevelV1, ObservationKind, PreferenceDim, PreferenceObservation } from './types.js';

/** 派生目录（运行时区，非 canon）。 */
export const PREFERENCE_DIR = '.mozhou/preference';
export const OBSERVATIONS_RELPATH = `${PREFERENCE_DIR}/observations.jsonl`;
export const PROFILE_RELPATH = `${PREFERENCE_DIR}/profile.json`;

const LEVELS_V1: readonly string[] = ['cursor', 'selection'];

function preferenceAbsPath(bookRoot: string, relPath: string): string {
  return join(bookRoot, relPath);
}

/* ---------------------------------------------------------------------------
 * observations.jsonl —— append-only 观测日志
 * ------------------------------------------------------------------------- */

/** 追加观测行（mkdir -p；空批零写）。 */
export function appendObservations(bookRoot: string, rows: readonly PreferenceObservation[]): void {
  if (rows.length === 0) return;
  mkdirSync(preferenceAbsPath(bookRoot, PREFERENCE_DIR), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row) + '\n').join('');
  appendFileSync(preferenceAbsPath(bookRoot, OBSERVATIONS_RELPATH), Buffer.from(payload, 'utf8'));
}

/** 整表重写（rebuild/自愈路径专用；读侧撕裂容忍使中断安全）。 */
export function rewriteObservations(bookRoot: string, rows: readonly PreferenceObservation[]): void {
  if (rows.length === 0) return;
  mkdirSync(preferenceAbsPath(bookRoot, PREFERENCE_DIR), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row) + '\n').join('');
  writeFileSync(preferenceAbsPath(bookRoot, OBSERVATIONS_RELPATH), Buffer.from(payload, 'utf8'));
}

function narrowObservation(row: Record<string, unknown>): PreferenceObservation | undefined {
  const obsId = row['obsId'];
  const sourcePosition = row['sourcePosition'];
  const kind = row['kind'];
  const taskRef = row['taskRef'];
  const sceneType = row['sceneType'];
  const w = row['w'];
  const featuresRaw = row['features'];
  if (typeof obsId !== 'string' || obsId.length === 0) return undefined;
  if (typeof sourcePosition !== 'number' || !Number.isSafeInteger(sourcePosition)) return undefined;
  if (typeof kind !== 'string' || !(OBSERVATION_KINDS as readonly string[]).includes(kind)) return undefined;
  if (typeof taskRef !== 'string' || taskRef.length === 0) return undefined;
  if (sceneType !== null) return undefined; // V1 冻结：恒 null
  if (typeof w !== 'number' || !Number.isFinite(w)) return undefined;
  if (typeof featuresRaw !== 'object' || featuresRaw === null || Array.isArray(featuresRaw)) return undefined;
  const features: Partial<Record<PreferenceDim, number>> = {};
  for (const [key, value] of Object.entries(featuresRaw as Record<string, unknown>)) {
    if (!(PREFERENCE_DIMS as readonly string[]).includes(key)) return undefined; // 越维即违例
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    features[key as PreferenceDim] = value;
  }
  const levelRaw = row['level'];
  let level: EditActionLevelV1 | undefined;
  if (levelRaw !== undefined) {
    if (typeof levelRaw !== 'string' || !LEVELS_V1.includes(levelRaw)) return undefined;
    level = levelRaw as EditActionLevelV1;
  }
  const chapterIndexRaw = row['chapterIndex'];
  let chapterIndex: number | undefined;
  if (chapterIndexRaw !== undefined) {
    if (typeof chapterIndexRaw !== 'number') return undefined;
    chapterIndex = chapterIndexRaw;
  }
  const degradedRaw = row['degraded'];
  let degraded: boolean | undefined;
  if (degradedRaw !== undefined) {
    if (typeof degradedRaw !== 'boolean') return undefined;
    degraded = degradedRaw;
  }
  const commitIdRaw = row['commitId'];
  let commitId: string | undefined;
  if (commitIdRaw !== undefined) {
    if (typeof commitIdRaw !== 'string') return undefined;
    commitId = commitIdRaw;
  }
  return {
    obsId,
    sourcePosition,
    kind: kind as ObservationKind,
    taskRef,
    ...(chapterIndex === undefined ? {} : { chapterIndex }),
    ...(level === undefined ? {} : { level }),
    sceneType: null,
    features,
    w,
    ...(degraded === undefined ? {} : { degraded }),
    ...(commitId === undefined ? {} : { commitId }),
  };
}

/**
 * 读已持久化观测：撕裂/非法行跳过；obsId 先到先得（append 序即权威序，
 * 重放同 obsId 幂等）。缺失文件返回空数组。
 */
export function readPersistedObservations(bookRoot: string): PreferenceObservation[] {
  const path = preferenceAbsPath(bookRoot, OBSERVATIONS_RELPATH);
  if (!existsSync(path)) return [];
  const seen = new Set<string>();
  const rows: PreferenceObservation[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 撕裂行
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const observation = narrowObservation(parsed as Record<string, unknown>);
    if (observation === undefined || seen.has(observation.obsId)) continue;
    seen.add(observation.obsId);
    rows.push(observation);
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * profile.json —— 画像快照（延迟物化）
 * ------------------------------------------------------------------------- */

/** 快照是否已物化（首批观测后才有字节）。 */
export function hasMaterializedProfile(bookRoot: string): boolean {
  return existsSync(preferenceAbsPath(bookRoot, PROFILE_RELPATH));
}

/** 写画像快照。调用方负责「首批观测后物化」门槛（obsCount>0 才许调）。 */
export function saveProfileSnapshot(bookRoot: string, profile: PreferenceProfileState): void {
  mkdirSync(preferenceAbsPath(bookRoot, PREFERENCE_DIR), { recursive: true });
  writeFileSync(preferenceAbsPath(bookRoot, PROFILE_RELPATH), Buffer.from(JSON.stringify(profile, null, 2), 'utf8'));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function narrowDimState(value: unknown): DimState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!isFiniteNumber(raw['S']) || !isFiniteNumber(raw['W']) || !isFiniteNumber(raw['M'])) return undefined;
  if (!isFiniteNumber(raw['emVar']) || !isFiniteNumber(raw['kappaEff']) || !isFiniteNumber(raw['driftStreak'])) return undefined;
  if (!Number.isSafeInteger(raw['driftStreak'])) return undefined;
  return {
    S: raw['S'],
    W: raw['W'],
    M: raw['M'],
    emVar: raw['emVar'],
    kappaEff: raw['kappaEff'],
    driftStreak: raw['driftStreak'],
  };
}

function narrowDriftEvent(value: unknown): DriftEvent | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const dim = raw['dim'];
  if (typeof dim !== 'string' || !(PREFERENCE_DIMS as readonly string[]).includes(dim)) return undefined;
  if (!isFiniteNumber(raw['sourcePosition']) || !isFiniteNumber(raw['shortMean']) || !isFiniteNumber(raw['mean']) || !isFiniteNumber(raw['sigma'])) {
    return undefined;
  }
  return {
    dim: dim as PreferenceDim,
    sourcePosition: raw['sourcePosition'],
    shortMean: raw['shortMean'],
    mean: raw['mean'],
    sigma: raw['sigma'],
  };
}

/**
 * 读画像快照：缺失或形状不符（损坏/异版本）返回 null——调用方走冷启动自愈
 * （从账本全量重折即可无损恢复，S/W 累积态是账本的纯函数）。
 */
export function loadProfileSnapshot(bookRoot: string): PreferenceProfileState | null {
  const path = preferenceAbsPath(bookRoot, PROFILE_RELPATH);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // 撕裂/损坏 → 自愈
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw['version'] !== 1) return null;
  if (!isFiniteNumber(raw['obsCount']) || !isFiniteNumber(raw['cursor']) || !isFiniteNumber(raw['degradedWindows'])) return null;
  if (!Array.isArray(raw['driftLog'])) return null;
  const dimsRaw = raw['dims'];
  if (typeof dimsRaw !== 'object' || dimsRaw === null || Array.isArray(dimsRaw)) return null;
  const dimsPartial = dimsRaw as Record<string, unknown>;
  const dims = {} as Record<PreferenceDim, DimState>;
  for (const dim of PREFERENCE_DIMS) {
    const state = narrowDimState(dimsPartial[dim]);
    if (state === undefined) return null;
    dims[dim] = state;
  }
  const driftLog: DriftEvent[] = [];
  for (const item of raw['driftLog']) {
    const event = narrowDriftEvent(item);
    if (event === undefined) return null;
    driftLog.push(event);
  }
  return {
    version: 1,
    dims,
    obsCount: raw['obsCount'],
    cursor: raw['cursor'],
    degradedWindows: raw['degradedWindows'],
    driftLog,
  };
}

/** 冷启动兜底读：快照缺失/损坏时返回 m₀ 冷启动画像（不触盘）。 */
export function loadProfileOrColdStart(bookRoot: string): PreferenceProfileState {
  return loadProfileSnapshot(bookRoot) ?? coldStartProfile();
}
