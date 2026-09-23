/**
 * TaskModelEvaluator 编排入口（T24 · #57；t53:C1-C7 四导出收口单入口）。
 *
 * runTaskModelEvaluation：只读投影 → cell 六信号 → 五规则判定 → RoutingSuggestion
 * 追加进 .mozhou/suggestions/suggestions.jsonl（派生面，账本零字节触碰）。
 *
 * 纪律：
 *   - **只建议不自动改路由**（C6）：建议物是纯数据，生效 = 作者人工编辑 tier 配置
 *     后既有 loadTierConfig 机械校验 + mtime 热加载；本模块只读消费 loadTierConfig
 *     解析 incumbent 路由（缺文件/坏结构按其契约 fail-fast 抛错，宁败不猜）。
 *   - **C2 桥接守卫**：P1 meta 缺位（无任何 GenerationStarted 携带 parentTaskRef）
 *     ⇒ taskRef 同窗 join 前提为假 ⇒ 拒绝产建议、只产 watch 条目（机械强制，
 *     测试断言 promote/demote 计数为零）。
 *   - 零时钟：nowUtc 必填注入（benchmark run.ts 先例同界）；ULID 显式铸法可注入。
 *   - R5 单变量单 cell：一条建议只替换一个 route 叶子（providerId+model 成对）；
 *     多 challenger 同时胜出时按（优势宽度 × 决策样本量）降序逐条发射。
 */
import { loadTierConfig } from '@mozhou/runtime';
import { newUlid } from '@mozhou/kernel';
import { readPipelineLedger, readUsageProjection } from '@mozhou/pipeline';
import { aggregateSignals, distinctChapters, projectInputs } from './project.js';
import type { DecisionFact, ProjectionOutput, SignalSlice } from './project.js';
import { appendSuggestions } from './storage.js';
import type { ArchivedMatrixRow } from './storage.js';
import { readMatrixRowArchive } from './storage.js';
import { cutWindowsOfPositionOrdered } from './thresholds.js';
import {
  acceptanceWilson,
  baselineFailureRate,
  buildArchiveView,
  eligibilityOf,
  failureRateOf,
  gateStreakFailed,
  judgeDemotion,
  judgePair,
  withArchiveSignals,
} from './thresholds.js';
import type { EligibilityEvidence, PairEvidence } from './thresholds.js';
import type { CellKey } from './types.js';
import type { RoutingSuggestion } from './types.js';

/** 编排请求面（全部显式注入；零时钟零外部服务）。 */
export interface RunTaskModelEvaluationRequest {
  /** 书根（.mozhou 运行时区所在）。 */
  readonly bookRoot: string;
  /** tier 配置路径——incumbent 路由解析唯一来源（loadTierConfig 消费）。 */
  readonly tierConfigPath: string;
  /** 注入时钟：createdAtUtc 唯一来源。 */
  readonly nowUtc: () => string;
  /** 测试注入 id 铸法；缺省 'sug_' + ULID。 */
  readonly newSuggestionId?: () => string;
}

export interface TaskModelEvaluationOutcome {
  readonly suggestions: readonly RoutingSuggestion[];
  readonly appendedCount: number;
  readonly bridgePresent: boolean;
  /** watch_only = C2 守卫路径或证据面为空；evaluated = 完整五规则判定已走。 */
  readonly mode: 'evaluated' | 'watch_only';
}

function mintId(request: RunTaskModelEvaluationRequest): string {
  return request.newSuggestionId !== undefined ? request.newSuggestionId() : `sug_${newUlid()}`;
}

/** 确认窗口切片：窗口内决策所宿住的闭合窗口与代次（V1 口径=决策锚定宿主窗）。 */
function sliceForWindow(
  projection: ProjectionOutput,
  windowDecisions: readonly DecisionFact[],
): SignalSlice {
  const hosts = new Set(windowDecisions.map((decision) => decision.taskRef));
  return {
    windows: projection.windows.filter((window) => hosts.has(window.taskRef)),
    generations: projection.generations.filter(
      (generation) => generation.windowTaskRef !== null && hosts.has(generation.windowTaskRef),
    ),
    decisions: windowDecisions,
  };
}

function suggestionOf(input: {
  readonly request: RunTaskModelEvaluationRequest;
  readonly key: CellKey;
  readonly kind: RoutingSuggestion['kind'];
  readonly status: RoutingSuggestion['status'];
  readonly proposed: { providerId: string; model: string };
  readonly decisions: number;
  readonly chapters: number;
  readonly challengerWilson: readonly [number, number];
  readonly incumbentWilson: readonly [number, number];
  readonly editRatioDeltaPct: number;
  readonly benchmarkGatePassed: boolean;
  readonly matrixRowRef: string | null;
}): RoutingSuggestion {
  const { request } = input;
  return {
    suggestionId: mintId(request),
    createdAtUtc: request.nowUtc(),
    cell: {
      taskType: input.key.taskType,
      providerId: input.key.providerId,
      model: input.key.model,
      recipeVersion: input.key.recipeVersion,
    },
    kind: input.kind,
    proposedRoute: input.proposed,
    basis: {
      sampleSize: { decisions: input.decisions, chapterWindows: input.chapters },
      challengerAcceptanceWilson: input.challengerWilson,
      incumbentAcceptanceWilson: input.incumbentWilson,
      editRatioDeltaPct: input.editRatioDeltaPct,
      benchmarkGatePassed: input.benchmarkGatePassed,
      matrixRowRef: input.matrixRowRef,
    },
    status: input.status,
  };
}

/** 主入口：评估一次并落盘建议面。纯读输入 + 单一追加写出口。 */
export async function runTaskModelEvaluation(request: RunTaskModelEvaluationRequest): Promise<TaskModelEvaluationOutcome> {
  const ledger = readPipelineLedger(request.bookRoot);
  const usage = readUsageProjection(request.bookRoot);
  const archiveRows: readonly ArchivedMatrixRow[] = readMatrixRowArchive(request.bookRoot);
  const archiveView = buildArchiveView(archiveRows);

  const projection = projectInputs({ ledger, usage });

  // ---- C2 桥接守卫：join 前提缺位 ⇒ 只产 watch 条目 ------------------------
  if (!projection.bridgePresent) {
    const watches = projection.unattributedRoutes.map((route) =>
      suggestionOf({
        request,
        key: { taskType: route.taskType, providerId: route.providerId, model: '', recipeVersion: null },
        kind: 'watch',
        status: 'insufficient_sample',
        proposed: { providerId: route.providerId, model: '' }, // 占位不改路由
        decisions: 0,
        chapters: 0,
        challengerWilson: [0, 1],
        incumbentWilson: [0, 1],
        editRatioDeltaPct: 0,
        benchmarkGatePassed: false,
        matrixRowRef: null,
      }),
    );
    appendSuggestions(request.bookRoot, watches);
    return { suggestions: watches, appendedCount: watches.length, bridgePresent: false, mode: 'watch_only' };
  }

  // ---- 完整判据路径 --------------------------------------------------------
  const horizonSlice: SignalSlice = {
    windows: projection.windows,
    generations: projection.generations,
    decisions: projection.decisions,
  };
  const horizonByCell = aggregateSignals(horizonSlice);
  const windows = cutWindowsOfPositionOrdered(projection.decisions);
  const currentSlice = sliceForWindow(projection, windows.current);
  const previousSlice = sliceForWindow(projection, windows.previous);
  const currentByCell = aggregateSignals(currentSlice);
  const previousByCell = aggregateSignals(previousSlice);

  // tier 配置消费（incumbent 路由解析；fail-fast 校验即安全栏）
  const tierConfig = await loadTierConfig(request.tierConfigPath);

  const signalsWithArchive = (cellId: string) =>
    withArchiveSignals(
      horizonByCell.get(cellId) ?? (() => { throw new RangeError(`cell ${cellId} 无 horizon 聚合——内部不变量破坏`) })(),
      archiveRows,
      projection.cellKeys.get(cellId)?.recipeVersion ?? null,
    );

  interface PairOutcome {
    readonly incumbentCellId: string;
    readonly challengerCellId: string;
    readonly score: number; // 优势宽度 × 决策样本量（R5 发射序）
    readonly suggestion: RoutingSuggestion;
    readonly promoteQualified: boolean;
  }

  const pairs: PairOutcome[] = [];
  const comparedPairs = new Set<string>();

  for (const [cellId, key] of projection.cellKeys) {
    const leavesForType = Object.values(tierConfig[key.taskType] ?? {});
    const isIncumbent = leavesForType.some(
      (leaf) => leaf.providerId === key.providerId && leaf.model === key.model,
    );
    if (!isIncumbent) continue;

    for (const [challengerId, challengerKey] of projection.cellKeys) {
      // C5 可比性钉死：同 taskType × 同 recipeVersion；R5 单变量：route 不同
      if (challengerId === cellId) continue;
      if (challengerKey.taskType !== key.taskType) continue;
      if (challengerKey.recipeVersion !== key.recipeVersion) continue;

      const pairKey = `${cellId}=>${challengerId}`;
      comparedPairs.add(pairKey);

      const chHorizonRaw = horizonByCell.get(challengerId);
      const incHorizonRaw = horizonByCell.get(cellId);
      if (chHorizonRaw === undefined || incHorizonRaw === undefined) continue;

      const evidence: PairEvidence = {
        challengerHorizon: withArchiveSignals(chHorizonRaw, archiveRows, challengerKey.recipeVersion),
        incumbentHorizon: signalsWithArchive(cellId),
        challengerCurrent:
          currentByCell.get(challengerId) ?? { ...chHorizonRaw, s1: { ...chHorizonRaw.s1, acceptanceRate: null } },
        incumbentCurrent:
          currentByCell.get(cellId) ?? { ...incHorizonRaw, s1: { ...incHorizonRaw.s1, acceptanceRate: null } },
        challengerPrevious:
          previousByCell.get(challengerId) ?? { ...chHorizonRaw, s1: { ...chHorizonRaw.s1, acceptanceRate: null } },
        incumbentPrevious:
          previousByCell.get(cellId) ?? { ...incHorizonRaw, s1: { ...incHorizonRaw.s1, acceptanceRate: null } },
        challengerChapters: distinctChapters(horizonSlice, challengerId),
      };
      const eligibility: EligibilityEvidence = eligibilityOf(archiveView, challengerKey.recipeVersion);
      const judgement = judgePair({ evidence, eligibility });

      const chRate = chHorizonRaw.s1.acceptanceRate ?? 0;
      const incRate = incHorizonRaw.s1.acceptanceRate ?? 0;
      const score = (chRate - incRate) * chHorizonRaw.s1.decisions;

      pairs.push({
        incumbentCellId: cellId,
        challengerCellId: challengerId,
        score,
        promoteQualified: judgement.kind === 'promote',
        suggestion: suggestionOf({
          request,
          key: challengerKey, // 建议物挂在 challenger cell 上（要换过去的那个）
          kind: judgement.kind,
          status: judgement.status,
          proposed: { providerId: challengerKey.providerId, model: challengerKey.model },
          decisions: chHorizonRaw.s1.decisions,
          chapters: evidence.challengerChapters,
          challengerWilson: acceptanceWilson(chHorizonRaw.s1.acceptedOptions, chHorizonRaw.s1.rejectedOptions),
          incumbentWilson: acceptanceWilson(incHorizonRaw.s1.acceptedOptions, incHorizonRaw.s1.rejectedOptions),
          editRatioDeltaPct: judgement.editRatioDeltaPct,
          benchmarkGatePassed: judgement.benchmarkGatePassed,
          matrixRowRef: eligibility.matrixRowRef,
        }),
      });
    }
  }

  // ---- demote 反向信号（per incumbent cell）--------------------------------
  const emitted: RoutingSuggestion[] = [];
  for (const [cellId, key] of projection.cellKeys) {
    const leavesForType = Object.values(tierConfig[key.taskType] ?? {});
    const isIncumbent = leavesForType.some(
      (leaf) => leaf.providerId === key.providerId && leaf.model === key.model,
    );
    if (!isIncumbent) continue;
    const signals = signalsWithArchive(cellId);
    const fallback = pairs.find(
      (pair) => pair.incumbentCellId === cellId && pair.promoteQualified,
    );
    const demotion = judgeDemotion({
      gateStreakFailed: gateStreakFailed(archiveRows, key.recipeVersion),
      failureRate: failureRateOf(signals),
      baselineFailureRate: baselineFailureRate(horizonSlice, cellId),
      windows: signals.s6.windows,
      fallbackCellId: fallback?.challengerCellId ?? null,
    });
    if (demotion.kind !== 'demote') continue;
    const fallbackKey =
      fallback !== undefined ? projection.cellKeys.get(fallback.challengerCellId) : undefined;
    if (fallbackKey === undefined) continue; // 不变量：demote 必有可指名回退目标
    emitted.push(
      suggestionOf({
        request,
        key,
        kind: 'demote',
        status: demotion.status,
        proposed: { providerId: fallbackKey.providerId, model: fallbackKey.model },
        decisions: signals.s1.decisions,
        chapters: distinctChapters(horizonSlice, cellId),
        challengerWilson: acceptanceWilson(signals.s1.acceptedOptions, signals.s1.rejectedOptions),
        incumbentWilson: acceptanceWilson(signals.s1.acceptedOptions, signals.s1.rejectedOptions), // demote 自证面=incumbent 自身区间
        editRatioDeltaPct: 0,
        benchmarkGatePassed: false,
        matrixRowRef: eligibilityOf(archiveView, key.recipeVersion).matrixRowRef,
      }),
    );
  }

  // ---- 发射序（R5）：promote 按 优势宽度×样本量 降序，其后 watch ------------
  const promotes = pairs
    .filter((pair) => pair.promoteQualified)
    .sort((a, b) => b.score - a.score || a.challengerCellId.localeCompare(b.challengerCellId));
  emitted.push(...promotes.map((pair) => pair.suggestion));

  for (const pair of pairs) {
    if (pair.promoteQualified) continue;
    if (emitted.some((row) => row.suggestionId === pair.suggestion.suggestionId)) continue;
    emitted.push(pair.suggestion); // watch 判定条目（资格门不足/样本不足/首窗观察…）
  }

  appendSuggestions(request.bookRoot, emitted);
  return {
    suggestions: emitted,
    appendedCount: emitted.length,
    bridgePresent: true,
    mode: 'evaluated',
  };
}

