/**
 * 只读投影器（T24 · #57；t53:C1/C2）。
 *
 * 三件输入 → cell(taskType × route(providerId,model) × recipeVersion) 六信号投影：
 *   1. 账本（readPipelineLedger 行序即权威时序）：GenerationStarted 快照给
 *      taskType/providerId、M14 载荷三级路径给 recipeVersion；FlywheelRecorded 是
 *      窗口闭合锚（成败都落账 ⇒ 每完成窗口恰一条）；UserEditRecorded 双动作拆分
 *      （candidate_decision → S1，edit_blocks+source=author → S2）；TaskAttemptRegistered/
 *      GenerationFinished → S6；
 *   2. usage.jsonl（readUsageProjection）：provider/model 证据成 route 复合键 +
 *      costMicros/outputTokens 经济性（S5）+ at 时间锚（R4 切窗原料）；
 *   3. 矩阵行存档（readMatrixRowArchive）：S3/S4（见 thresholds 层合成）。
 *
 * **taskRef 同窗 join（C2）**：T21 P1 桥接把会话窗口引用盖进执行事件 payload 层——
 * TaskAttemptRegistered / GenerationFinished 携带 parentTaskRef（engine.ts
 * parentPatch；DomainEvent 顶层禁新增字段，t52:B5）。代次事件以 event.taskRef=
 * genTaskRef 为共同键 join：GenerationStarted 给 route/recipe，attempt/finish 给
 * 窗口归属。桥接缺位 ⇒ 该代次不可归因，上层只产 watch。
 *
 * 窗口→cell 取**首个**匹配代次（账本行序权威；一窗多代的 V1 口径=首代定归属）。
 * 纯函数零时钟零外部服务；Date.parse 仅解析显式注入的 ISO 字符串，不取当下。
 */
import { readRecipeVersionFromPayload } from '@mozhou/benchmark';
import type { PipelineLedgerRow } from '@mozhou/pipeline';
import type { UsageRecord } from '@mozhou/pipeline';
import { cellIdOf, emptySignals } from './types.js';
import type { CellKey, CellSignals } from './types.js';

export interface WindowFact {
  readonly taskRef: string;
  readonly chapterIndex: number | null;
  /** 归属 cell id；桥接缺位或 model 证据缺面 ⇒ null（不可归因）。 */
  readonly cellId: string | null;
  readonly edited: boolean;
  readonly degraded: boolean;
  readonly costMicros: number;
  readonly outputTokens: number;
  /** R4 切窗时间锚：该窗口 usage 行 at 的最大值（ms）；全窗口无锚 ⇒ null。 */
  readonly atMs: number | null;
}

export interface DecisionFact {
  readonly position: number;
  readonly taskRef: string;
  readonly chapterIndex: number | null;
  readonly cellId: string | null;
  readonly acceptedOptions: number;
  readonly rejectedOptions: number;
  readonly atMs: number | null;
}

/** 作者结构化纠错事实（ADR-0025 · Task 5）：cell 归属沿窗口传导（决策同法）。 */
export interface CorrectionFact {
  readonly position: number;
  readonly taskRef: string;
  readonly chapterIndex: number | null;
  readonly cellId: string | null;
  readonly reasons: readonly string[];
}

export interface GenerationFact {
  readonly genTaskRef: string;
  readonly windowTaskRef: string | null;
  readonly cellId: string | null;
  readonly attempts: number;
  /** failed_terminal | failed_recoverable（succeeded 不计）。 */
  readonly failed: boolean;
}

export interface UnattributedRoute {
  readonly taskType: string;
  readonly providerId: string;
}

export interface ProjectionInput {
  readonly ledger: readonly PipelineLedgerRow[];
  readonly usage: readonly UsageRecord[];
}

export interface ProjectionOutput {
  readonly windows: readonly WindowFact[];
  readonly generations: readonly GenerationFact[];
  readonly decisions: readonly DecisionFact[];
  readonly corrections: readonly CorrectionFact[];
  /** cellId → CellKey 注册表（建议物铸面用，避免字符串反解）。 */
  readonly cellKeys: ReadonlyMap<string, CellKey>;
  /** 任一 GenerationStarted 携带 parentTaskRef ⇒ true（C2 桥接机械判据）。 */
  readonly bridgePresent: boolean;
  /** 有 GenerationStarted 但无法归因成完整 cell 的 (taskType, providerId) 去重清单。 */
  readonly unattributedRoutes: readonly UnattributedRoute[];
}

function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 机械收窄字符串数组（坏行按空数组计，不给 NaN 可乘之机）。 */
function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseAtMs(iso: string | undefined): number | null {
  if (iso === undefined || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 提取事件 payload 层 parentTaskRef（T21 P1 桥接：只进 payload，domain 顶层禁新增字段）。 */
function collectParent(
  parentByGen: Map<string, string>,
  taskRef: string,
  payload: Record<string, unknown> | undefined,
): void {
  const parent = payload?.['parentTaskRef'];
  if (typeof parent === 'string' && !parentByGen.has(taskRef)) {
    parentByGen.set(taskRef, parent);
  }
}

interface StartedRow {
  readonly position: number;
  readonly genTaskRef: string;
  readonly taskType: string;
  readonly providerId: string;
  readonly recipeVersion: string | null;
}

/**
 * 投影主函数：账本+usage 两件输入 → 窗口/代次/决策事实与桥接判定。
 * （矩阵行存档由 thresholds 层经 readMatrixRowArchive 单独消费。）
 */
export function projectInputs(input: ProjectionInput): ProjectionOutput {
  const startedRows: StartedRow[] = [];
  const parentByGen = new Map<string, string>();
  const attemptsByGen = new Map<string, number>();
  const failedGens = new Set<string>();
  const closedWindows = new Map<string, { chapterIndex: number | null; degraded: boolean }>();
  const editedWindows = new Set<string>();
  const decisions: DecisionFact[] = [];
  const corrections: CorrectionFact[] = [];

  let position = 0;
  for (const row of input.ledger) {
    if (row.kind !== 'task') {
      position += 1;
      continue;
    }
    const event = row.event;
    const payload = rec(event.payload);
    switch (event.type) {
      case 'GenerationStarted': {
        const snapshot = rec(payload?.['snapshot']);
        const taskType = snapshot?.['taskType'];
        const providerId = snapshot?.['providerId'];
        // started 行自身通常携带 parentTaskRef（手工桥接/外部生产者只在此事件上带）
        collectParent(parentByGen, event.taskRef, payload);
        if (typeof taskType === 'string' && typeof providerId === 'string') {
          startedRows.push({
            position,
            genTaskRef: event.taskRef,
            taskType,
            providerId,
            recipeVersion: payload === undefined ? null : readRecipeVersionFromPayload(payload),
          });
        }
        break;
      }
      case 'TaskAttemptRegistered':
        attemptsByGen.set(event.taskRef, (attemptsByGen.get(event.taskRef) ?? 0) + 1);
        collectParent(parentByGen, event.taskRef, payload);
        break;
      case 'GenerationFinished': {
        const outcome = payload?.['outcome'];
        if (outcome === 'failed_terminal' || outcome === 'failed_recoverable') {
          failedGens.add(event.taskRef);
        }
        collectParent(parentByGen, event.taskRef, payload);
        break;
      }
      case 'FlywheelRecorded': {
        // 窗口闭合锚：成败都落账；同窗口重复行以账本末行为准（行序权威）
        const degraded = payload?.['outcome'] === 'state_degraded';
        closedWindows.set(event.taskRef, {
          chapterIndex: typeof event.chapterIndex === 'number' ? event.chapterIndex : null,
          degraded,
        });
        break;
      }
      case 'UserEditRecorded': {
        const action = payload?.['action'];
        if (action === 'candidate_decision') {
          // ADR-0013 唯一合法形态：accepted/rejected 双路同账一条
          decisions.push({
            position,
            taskRef: event.taskRef,
            chapterIndex: typeof event.chapterIndex === 'number' ? event.chapterIndex : null,
            cellId: null, // 二次扫描回填
            acceptedOptions: stringArray(payload?.['acceptedOptionIds']).length,
            rejectedOptions: stringArray(payload?.['rejectedOptionIds']).length,
            atMs: null, // 二次扫描回填
          });
        } else if (action === 'edit_blocks' && payload?.['source'] === 'author') {
          editedWindows.add(event.taskRef);
        }
        break;
      }
      case 'AuthorCorrectionRecorded': {
        corrections.push({
          position,
          taskRef: event.taskRef,
          chapterIndex: typeof event.chapterIndex === 'number' ? event.chapterIndex : null,
          cellId: null, // 二次扫描回填
          reasons: stringArray(payload?.['reasons']),
        });
        break;
      }
      default:
        break;
    }
    position += 1;
  }

  // usage 面聚合：model 证据 / 经济性 / 时间锚（append 序先到先得取 model）
  const modelByWindow = new Map<string, string>();
  const costByWindow = new Map<string, number>();
  const outputByWindow = new Map<string, number>();
  const atMsByWindow = new Map<string, number>();
  for (const row of input.usage) {
    if (row.model !== undefined && !modelByWindow.has(row.taskRef)) {
      modelByWindow.set(row.taskRef, row.model);
    }
    if (typeof row.costMicros === 'number') {
      costByWindow.set(row.taskRef, (costByWindow.get(row.taskRef) ?? 0) + row.costMicros);
    }
    if (typeof row.outputTokens === 'number') {
      outputByWindow.set(row.taskRef, (outputByWindow.get(row.taskRef) ?? 0) + row.outputTokens);
    }
    const atMs = parseAtMs(row.at);
    if (atMs !== null && (atMsByWindow.get(row.taskRef) ?? Number.NEGATIVE_INFINITY) < atMs) {
      atMsByWindow.set(row.taskRef, atMs);
    }
  }

  // 窗口→cell：首个归属本窗口的 GenerationStarted 定归属（行序权威；
  // 归属=attempt/finish payload.parentTaskRef 指回该窗口）
  const primaryGenByWindow = new Map<string, StartedRow>();
  for (const started of startedRows) {
    const parentTaskRef = parentByGen.get(started.genTaskRef);
    if (parentTaskRef === undefined) continue;
    if (!primaryGenByWindow.has(parentTaskRef)) {
      primaryGenByWindow.set(parentTaskRef, started);
    }
  }

  const cellOfWindow = new Map<string, string>();
  const cellKeys = new Map<string, CellKey>();
  for (const [windowTaskRef, started] of primaryGenByWindow) {
    const model = modelByWindow.get(windowTaskRef);
    if (model === undefined) continue; // model 证据缺面 ⇒ 成不了完整 route 键
    const key: CellKey = {
      taskType: started.taskType,
      providerId: started.providerId,
      model,
      recipeVersion: started.recipeVersion,
    };
    const id = cellIdOf(key);
    cellKeys.set(id, key);
    cellOfWindow.set(windowTaskRef, id);
  }

  const windows: WindowFact[] = [];
  for (const [taskRef, closure] of closedWindows) {
    windows.push({
      taskRef,
      chapterIndex: closure.chapterIndex,
      cellId: cellOfWindow.get(taskRef) ?? null,
      edited: editedWindows.has(taskRef),
      degraded: closure.degraded,
      costMicros: costByWindow.get(taskRef) ?? 0,
      outputTokens: outputByWindow.get(taskRef) ?? 0,
      atMs: atMsByWindow.get(taskRef) ?? null,
    });
  }

  const generations: GenerationFact[] = startedRows.map((started) => {
    const windowTaskRef = parentByGen.get(started.genTaskRef);
    return {
      genTaskRef: started.genTaskRef,
      windowTaskRef: windowTaskRef ?? null,
      cellId: windowTaskRef !== undefined ? cellOfWindow.get(windowTaskRef) ?? null : null,
      attempts: attemptsByGen.get(started.genTaskRef) ?? 0,
      failed: failedGens.has(started.genTaskRef),
    };
  });

  // 决策行回填 cellId/atMs（窗口级归属传导）
  const filledDecisions = decisions.map((decision) => ({
    ...decision,
    cellId: cellOfWindow.get(decision.taskRef) ?? null,
    atMs: atMsByWindow.get(decision.taskRef) ?? null,
  }));

  const filledCorrections = corrections
    .map((correction) => ({
      ...correction,
      cellId: cellOfWindow.get(correction.taskRef) ?? null,
    }))
    .sort((a, b) => a.position - b.position);

  const bridgePresent = parentByGen.size > 0;
  const seenRoutes = new Set<string>();
  const unattributedRoutes: UnattributedRoute[] = [];
  for (const started of startedRows) {
    const windowTaskRef = parentByGen.get(started.genTaskRef);
    const attributed = windowTaskRef !== undefined && modelByWindow.has(windowTaskRef);
    if (attributed) continue;
    const routeKey = `${started.taskType}|${started.providerId}`;
    if (seenRoutes.has(routeKey)) continue;
    seenRoutes.add(routeKey);
    unattributedRoutes.push({ taskType: started.taskType, providerId: started.providerId });
  }

  return { windows, generations, decisions: filledDecisions, corrections: filledCorrections, cellKeys, bridgePresent, unattributedRoutes };
}

/* ---------------------------------------------------------------------------
 * 信号聚合：事实子集 → 每 cell 六信号（S3/S4 由矩阵存档侧在 thresholds 合成）
 * ------------------------------------------------------------------------- */

/** 参与一次聚合的事实切片（全 horizon 或单个确认窗口）。 */
export interface SignalSlice {
  readonly windows: readonly WindowFact[];
  readonly generations: readonly GenerationFact[];
  readonly decisions: readonly DecisionFact[];
  /** 缺省空数组：旧调用方零适配（s7 恒零值）。 */
  readonly corrections?: readonly CorrectionFact[];
}

/**
 * 事实切片 → Map<cellId, CellSignals>。
 * S1 仅多候选择优窗口上有定义：无决策 ⇒ acceptanceRate=null（不入分母语义，
 * 与「无编辑记 0」的 C3 空语义严格区分）。
 */
export function aggregateSignals(slice: SignalSlice): Map<string, CellSignals> {
  const byCell = new Map<string, {
    signals: CellSignals;
    accepted: number;
    rejected: number;
    decisions: number;
    chapters: Set<number>;
    corrections: ReadonlyArray<{ chapterIndex: number; reasons: readonly string[] }>;
  }>();

  const touch = (cellId: string) => {
    let entry = byCell.get(cellId);
    if (entry === undefined) {
      entry = { signals: emptySignals(), accepted: 0, rejected: 0, decisions: 0, chapters: new Set(), corrections: [] };
      byCell.set(cellId, entry);
    }
    return entry;
  };

  for (const window of slice.windows) {
    if (window.cellId === null) continue;
    const entry = touch(window.cellId);
    const s2 = entry.signals.s2;
    const s5 = entry.signals.s5;
    const s6 = entry.signals.s6;
    entry.signals = {
      ...entry.signals,
      s2: {
        closedWindows: s2.closedWindows + 1,
        editedWindows: s2.editedWindows + (window.edited ? 1 : 0),
        editRatio: null, // 收口时统一折算
      },
      s5: {
        costMicros: s5.costMicros + window.costMicros,
        outputTokens: s5.outputTokens + window.outputTokens,
        microsPerOutputToken: null,
      },
      s6: {
        ...s6,
        windows: s6.windows + 1,
        degradedWindows: s6.degradedWindows + (window.degraded ? 1 : 0),
      },
    };
    if (window.chapterIndex !== null) entry.chapters.add(window.chapterIndex);
  }

  for (const generation of slice.generations) {
    if (generation.cellId === null) continue;
    const entry = touch(generation.cellId);
    const s6 = entry.signals.s6;
    entry.signals = {
      ...entry.signals,
      s6: {
        ...s6,
        attempts: s6.attempts + generation.attempts,
        failedGenerations: s6.failedGenerations + (generation.failed ? 1 : 0),
      },
    };
  }

  for (const decision of slice.decisions) {
    if (decision.cellId === null) continue;
    const entry = touch(decision.cellId);
    entry.accepted += decision.acceptedOptions;
    entry.rejected += decision.rejectedOptions;
    entry.decisions += 1;
    if (decision.chapterIndex !== null) entry.chapters.add(decision.chapterIndex);
  }

  // S7（ADR-0025 · Task 5）：复发=同 reason 在严格更晚章节再次出现。
  // FailurePattern 活跃期的机械代理：地平线内已有更早出现即视为活跃期。
  const corrections = slice.corrections ?? [];
  for (const correction of corrections) {
    if (correction.cellId === null || correction.chapterIndex === null) continue;
    const entry = touch(correction.cellId);
    entry.corrections = [...entry.corrections, { chapterIndex: correction.chapterIndex, reasons: correction.reasons }];
  }

  const result = new Map<string, CellSignals>();
  for (const [cellId, entry] of byCell) {
    const totalOptions = entry.accepted + entry.rejected;
    result.set(cellId, {
      ...entry.signals,
      s1: {
        decisions: entry.decisions,
        acceptedOptions: entry.accepted,
        rejectedOptions: entry.rejected,
        acceptanceRate: entry.decisions === 0 || totalOptions === 0 ? null : entry.accepted / totalOptions,
      },
      s2: {
        ...entry.signals.s2,
        editRatio: entry.signals.s2.closedWindows === 0 ? null : entry.signals.s2.editedWindows / entry.signals.s2.closedWindows,
      },
      s3: { gateReadings: 0, gatePassed: 0, gatePassRate: null }, // 存档侧合成
      s4: { userEditRatioReduction: null },
      s5: {
        ...entry.signals.s5,
        microsPerOutputToken: entry.signals.s5.outputTokens === 0 ? null : entry.signals.s5.costMicros / entry.signals.s5.outputTokens,
      },
      s6: entry.signals.s6,
      s7: computeS7(entry.corrections),
    });
  }
  return result;
}

/** 纠错记录 → S7：correctedChapters 去重章数；repeated = 严格更晚章节同 reason 复发数。 */
function computeS7(
  corrections: ReadonlyArray<{ chapterIndex: number; reasons: readonly string[] }>,
): CellSignals['s7'] {
  const chapters = new Set<number>();
  const firstSeenByReason = new Map<string, number>();
  let repeated = 0;
  const ordered = [...corrections].sort((a, b) => a.chapterIndex - b.chapterIndex);
  for (const { chapterIndex, reasons } of ordered) {
    chapters.add(chapterIndex);
    for (const reason of reasons) {
      const first = firstSeenByReason.get(reason);
      if (first === undefined) firstSeenByReason.set(reason, chapterIndex);
      else if (chapterIndex > first) repeated += 1;
      else firstSeenByReason.set(reason, Math.min(first, chapterIndex));
    }
  }
  const correctedChapters = chapters.size;
  return {
    correctedChapters,
    repeatedCorrections: repeated,
    repeatCorrectionRate: correctedChapters === 0 ? null : repeated / correctedChapters,
  };
}

/** 章（chapterIndex）去重计数——R2 的「≥5 章」口径。 */
export function distinctChapters(slice: SignalSlice, cellId: string): number {
  const chapters = new Set<number>();
  for (const window of slice.windows) {
    if (window.cellId === cellId && window.chapterIndex !== null) chapters.add(window.chapterIndex);
  }
  for (const decision of slice.decisions) {
    if (decision.cellId === cellId && decision.chapterIndex !== null) chapters.add(decision.chapterIndex);
  }
  return chapters.size;
}
