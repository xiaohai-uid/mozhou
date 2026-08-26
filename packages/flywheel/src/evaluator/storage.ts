/**
 * 评估器派生面存储（T24 · #57；C6 派生面不入真源账本）。
 *
 *   .mozhou/suggestions/suggestions.jsonl   建议物追加日志（promote/demote/watch）
 *   .mozhou/benchmark/matrix-rows.jsonl     VersionMatrixRow 存档（只读消费面）
 *
 * IO 纪律复刻 usage.jsonl / observations.jsonl 先例：append-only 写、读侧 id 先到
 * 先得去重、撕裂行跳过（审计容忍）。R3 删除即重置——删 suggestions 目录即清空
 * 建议派生面，不触发对账破裂。矩阵存档是 T20 benchmark 运行的落档投影，本包
 * **只读**（写侧归基准运行集成票）；缺失文件 = 无证据 = 资格门不通过。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METRIC_IDS } from '@mozhou/benchmark';
import type { MetricId, VersionMatrixRow } from '@mozhou/benchmark';
import type { RoutingSuggestion } from './types.js';

/** 建议派生目录与文件（规格 §5 R3 点名 suggestions 派生目录）。 */
export const SUGGESTIONS_DIR = '.mozhou/suggestions';
export const SUGGESTIONS_RELPATH = `${SUGGESTIONS_DIR}/suggestions.jsonl`;

/** 矩阵行存档只读路径。 */
export const MATRIX_ROWS_RELPATH = '.mozhou/benchmark/matrix-rows.jsonl';

/* ---------------------------------------------------------------------------
 * suggestions.jsonl
 * ------------------------------------------------------------------------- */

function suggestionsAbsPath(bookRoot: string): string {
  return join(bookRoot, SUGGESTIONS_RELPATH);
}

/** 追加建议物（mkdir -p；空批零写）。派生面唯一写口——账本零字节触碰。 */
export function appendSuggestions(bookRoot: string, rows: readonly RoutingSuggestion[]): void {
  if (rows.length === 0) return;
  mkdirSync(join(bookRoot, SUGGESTIONS_DIR), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row) + '\n').join('');
  appendFileSync(suggestionsAbsPath(bookRoot), Buffer.from(payload, 'utf8'));
}

function narrowSuggestion(row: Record<string, unknown>): RoutingSuggestion | undefined {
  const suggestionId = row['suggestionId'];
  const createdAtUtc = row['createdAtUtc'];
  const kind = row['kind'];
  const status = row['status'];
  if (typeof suggestionId !== 'string' || !suggestionId.startsWith('sug_')) return undefined;
  if (typeof createdAtUtc !== 'string' || createdAtUtc.length === 0) return undefined;
  if (kind !== 'promote' && kind !== 'demote' && kind !== 'watch') return undefined;
  if (status !== 'sufficient_sample' && status !== 'insufficient_sample') return undefined;

  const cellRaw = row['cell'];
  const routeRaw = row['proposedRoute'];
  const basisRaw = row['basis'];
  if (typeof cellRaw !== 'object' || cellRaw === null || Array.isArray(cellRaw)) return undefined;
  if (typeof routeRaw !== 'object' || routeRaw === null || Array.isArray(routeRaw)) return undefined;
  if (typeof basisRaw !== 'object' || basisRaw === null || Array.isArray(basisRaw)) return undefined;
  const cell = cellRaw as Record<string, unknown>;
  const route = routeRaw as Record<string, unknown>;
  const basis = basisRaw as Record<string, unknown>;
  const taskType = cell['taskType'];
  const providerId = cell['providerId'];
  const model = cell['model'];
  const recipeVersion = cell['recipeVersion'];
  const routeProviderId = route['providerId'];
  const routeModel = route['model'];
  if (typeof taskType !== 'string' || typeof providerId !== 'string') return undefined;
  if (typeof model !== 'string' || typeof recipeVersion !== 'string' && recipeVersion !== null) return undefined;
  if (typeof routeProviderId !== 'string' || typeof routeModel !== 'string') return undefined;

  const sampleSizeRaw = basis['sampleSize'];
  const challengerWilson = basis['challengerAcceptanceWilson'];
  const incumbentWilson = basis['incumbentAcceptanceWilson'];
  const editRatioDeltaPct = basis['editRatioDeltaPct'];
  const benchmarkGatePassed = basis['benchmarkGatePassed'];
  const matrixRowRef = basis['matrixRowRef'];
  if (typeof sampleSizeRaw !== 'object' || sampleSizeRaw === null || Array.isArray(sampleSizeRaw)) return undefined;
  const sampleSize = sampleSizeRaw as Record<string, unknown>;
  if (typeof sampleSize['decisions'] !== 'number' || typeof sampleSize['chapterWindows'] !== 'number') return undefined;
  if (!isPair(challengerWilson) || !isPair(incumbentWilson)) return undefined;
  if (typeof editRatioDeltaPct !== 'number') return undefined;
  if (typeof benchmarkGatePassed !== 'boolean') return undefined;
  if (matrixRowRef !== null && typeof matrixRowRef !== 'string') return undefined;

  return {
    suggestionId,
    createdAtUtc,
    kind,
    cell: { taskType, providerId, model, recipeVersion },
    proposedRoute: { providerId: routeProviderId, model: routeModel },
    basis: {
      sampleSize: { decisions: sampleSize['decisions'], chapterWindows: sampleSize['chapterWindows'] },
      challengerAcceptanceWilson: challengerWilson,
      incumbentAcceptanceWilson: incumbentWilson,
      editRatioDeltaPct,
      benchmarkGatePassed,
      matrixRowRef,
    },
    status,
  };
}

function isPair(value: unknown): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return typeof value[0] === 'number' && typeof value[1] === 'number';
}

/** 读建议面：撕裂行跳过；同 suggestionId 先到先得（重复回放幂等）。缺失返回空数组。 */
export function readSuggestions(bookRoot: string): RoutingSuggestion[] {
  const path = suggestionsAbsPath(bookRoot);
  if (!existsSync(path)) return [];
  const seen = new Set<string>();
  const rows: RoutingSuggestion[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 撕裂行
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const narrowed = narrowSuggestion(parsed as Record<string, unknown>);
    if (narrowed === undefined) continue;
    if (seen.has(narrowed.suggestionId)) continue;
    seen.add(narrowed.suggestionId);
    rows.push(narrowed);
  }
  return rows;
}

/* ---------------------------------------------------------------------------
 * matrix-rows.jsonl —— VersionMatrixRow 存档（只读）
 * ------------------------------------------------------------------------- */

/** 存档行：T20 版本矩阵行 + 该次运行的 CASE 覆盖清单（R1 全集复跑判据原料）。 */
export interface ArchivedMatrixRow {
  /** 稳定引用（内容寻址：recipeVersion@recordedAtUtc；basis.matrixRowRef 指向它）。 */
  readonly matrixRowRef: string;
  /** T20 matrixRowFor 原样形状（六指标读数含门限判定随读数携带）。 */
  readonly row: VersionMatrixRow;
  /** 该次基准运行的 CASE-NNNN 清单（回归守卫的覆盖面证据）。 */
  readonly caseIds: readonly string[];
}

/** 存档行稳定引用：内容寻址、零时钟铸法（同 recordedAtUtc 的重复行先到先得去重）。 */
export function matrixRowRefFor(recipeVersion: string | null, recordedAtUtc: string): string {
  return `mxr_${recipeVersion ?? 'null'}@${recordedAtUtc}`;
}

function narrowArchivedRow(parsed: Record<string, unknown>, position: number): ArchivedMatrixRow | undefined {
  const rowRaw = parsed['row'];
  if (typeof rowRaw !== 'object' || rowRaw === null || Array.isArray(rowRaw)) return undefined;
  const row = rowRaw as Record<string, unknown>;
  const recipeVersion = row['recipeVersion'];
  const benchmarkVersion = row['benchmarkVersion'];
  const recordedAtUtc = row['recordedAtUtc'];
  const metricsRaw = row['metrics'];
  if (recipeVersion !== null && typeof recipeVersion !== 'string') return undefined;
  if (typeof benchmarkVersion !== 'string' || benchmarkVersion.length === 0) return undefined;
  if (typeof recordedAtUtc !== 'string' || recordedAtUtc.length === 0) return undefined;
  if (typeof metricsRaw !== 'object' || metricsRaw === null || Array.isArray(metricsRaw)) return undefined;
  const metrics: Partial<Record<MetricId, { readonly metric: MetricId; readonly value: number; readonly passed: boolean }>> = {};
  for (const metric of METRIC_IDS) {
    const reading = (metricsRaw as Record<string, unknown>)[metric];
    if (typeof reading !== 'object' || reading === null || Array.isArray(reading)) return undefined;
    const rec = reading as Record<string, unknown>;
    if (rec['metric'] !== metric || typeof rec['value'] !== 'number' || typeof rec['passed'] !== 'boolean') {
      return undefined;
    }
    metrics[metric] = { metric, value: rec['value'], passed: rec['passed'] };
  }
  const caseIdsRaw = parsed['caseIds'];
  if (!Array.isArray(caseIdsRaw) || caseIdsRaw.some((id) => typeof id !== 'string')) return undefined;
  // 显式 ref 缺失时按位置兜底（append 序即权威序），读取面永不改写文件
  const refRaw = parsed['matrixRowRef'];
  const matrixRowRef = typeof refRaw === 'string' && refRaw.length > 0 ? refRaw : `mxr_pos_${position}`;
  return {
    matrixRowRef,
    row: {
      recipeVersion,
      benchmarkVersion: benchmarkVersion as VersionMatrixRow['benchmarkVersion'],
      recordedAtUtc,
      metrics: metrics as VersionMatrixRow['metrics'],
    },
    caseIds: caseIdsRaw as readonly string[],
  };
}

/**
 * 读矩阵行存档：撕裂行跳过；同 matrixRowRef 先到先得。缺失文件返回空数组
 * （= 无资格门证据，任何 promote 都不成立）。
 */
export function readMatrixRowArchive(bookRoot: string): ArchivedMatrixRow[] {
  const path = join(bookRoot, MATRIX_ROWS_RELPATH);
  if (!existsSync(path)) return [];
  const seen = new Set<string>();
  const rows: ArchivedMatrixRow[] = [];
  let position = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      position += 1;
      continue; // 撕裂行
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      position += 1;
      continue;
    }
    const narrowed = narrowArchivedRow(parsed as Record<string, unknown>, position);
    position += 1;
    if (narrowed === undefined) continue;
    if (seen.has(narrowed.matrixRowRef)) continue;
    seen.add(narrowed.matrixRowRef);
    rows.push(narrowed);
  }
  return rows;
}
