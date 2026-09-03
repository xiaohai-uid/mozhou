/**
 * @mozhou/pipeline · 场景微循环与会话暂存层（P0-1 · Staged Overlay 架构）。
 *
 * 遵循终审裁决（Q1）：
 * 1. 章节为正史原子提交的唯一边界；
 * 2. 场景为章内可恢复微循环，产物入 Staged Overlay 会话暂存层，不写盘真理平面；
 * 3. 前序场景 Staged Delta 可作为上下文事实叠入后续 Scene 的编译过程；
 * 4. 前序场景被回改后，依赖它的后续 Scene 暂存与 Receipt 自动失效；
 * 5. 整章提交要么全成，要么零写入，半章永不进入正史。
 */
import type { SceneExitState, SceneId } from '@mozhou/kernel';
import type { CandidateDeltaBatch } from './extract-step.js';

export interface SceneStageRecord {
  readonly sceneId: SceneId;
  readonly orderIndex: number;
  readonly draftText: string;
  readonly draftContentHash: string;
  readonly exitState: SceneExitState;
  readonly stagedDeltas: CandidateDeltaBatch;
  readonly stagedAt: string;
}

export interface StagedOverlay {
  readonly stages: readonly SceneStageRecord[];
  readonly accumulatedDeltas: CandidateDeltaBatch;
  readonly lastDraftHash: string | null;
}

/** 初始化空的会话暂存层 */
export function createStagedOverlay(): StagedOverlay {
  return {
    stages: [],
    accumulatedDeltas: {},
    lastDraftHash: null,
  };
}

/** 内部辅助函数：聚合多场景暂存记录中的五族候选 Delta */
function accumulateStageDeltas(stages: readonly SceneStageRecord[]): CandidateDeltaBatch {
  const accumulated: Record<string, unknown[]> = {};
  for (const stage of stages) {
    for (const [family, items] of Object.entries(stage.stagedDeltas)) {
      if (!Array.isArray(items)) continue;
      const bucket = (accumulated[family] ??= []);
      for (const item of items) {
        bucket.push(item);
      }
    }
  }
  return accumulated;
}

/**
 * 暂存单个场景产物。
 * 记录本场景正文、ExitState 与提取的 Candidate Deltas，累加暂存视图。
 */
export function stageScene(
  overlay: StagedOverlay,
  record: SceneStageRecord,
): StagedOverlay {
  const filtered = overlay.stages.filter((s) => s.sceneId !== record.sceneId);
  const updatedStages = [...filtered, record].sort((a, b) => a.orderIndex - b.orderIndex);

  return {
    stages: updatedStages,
    accumulatedDeltas: accumulateStageDeltas(updatedStages),
    lastDraftHash: record.draftContentHash,
  };
}


/**
 * 将前序场景的暂存候选事实叠入基础事实集，生成供下一场景编译的临时视图。
 */
export function mergeStagedOverlay<T extends { readonly id?: string; readonly predicate?: string; readonly subject?: string }>(
  baseFacts: readonly T[],
  overlay: StagedOverlay,
): T[] {
  const stagedTemporalFacts = (overlay.accumulatedDeltas.temporalFact ?? []) as readonly T[];
  if (stagedTemporalFacts.length === 0) return [...baseFacts];

  const map = new Map<string, T>();
  for (const fact of baseFacts) {
    const key = fact.subject && fact.predicate ? `${fact.subject}::${fact.predicate}` : (fact.id ?? JSON.stringify(fact));
    map.set(key, fact);
  }
  for (const fact of stagedTemporalFacts) {
    const key = fact.subject && fact.predicate ? `${fact.subject}::${fact.predicate}` : (fact.id ?? JSON.stringify(fact));
    map.set(key, fact);
  }

  return Array.from(map.values());
}

export interface InvalidationResult extends StagedOverlay {
  readonly invalidatedSceneIds: readonly SceneId[];
}

/**
 * 当某场景被回改时，使该场景之后的所有后序场景暂存与派生凭据失效。
 */
export function invalidateDownstreamStages(
  overlay: StagedOverlay,
  modifiedOrderIndex: number,
): InvalidationResult {
  const kept = overlay.stages.filter((s) => s.orderIndex <= modifiedOrderIndex);
  const removed = overlay.stages.filter((s) => s.orderIndex > modifiedOrderIndex);

  const lastKept = kept[kept.length - 1];

  return {
    stages: kept,
    accumulatedDeltas: accumulateStageDeltas(kept),
    lastDraftHash: lastKept?.draftContentHash ?? null,
    invalidatedSceneIds: removed.map((s) => s.sceneId),
  };
}

