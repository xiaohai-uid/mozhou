import { describe, expect, it } from 'vitest';
import type { SceneExitState, SceneId } from '@mozhou/kernel';
import type { CandidateDeltaBatch } from './extract-step.js';
import {
  createStagedOverlay,
  invalidateDownstreamStages,
  mergeStagedOverlay,
  stageScene,
  type SceneStageRecord,
} from './scene-stage.js';

describe('P0-1 章节事务内的场景微循环与 Staged Overlay', () => {
  const SCENE_1_ID = 'scene_01JTEST0000000000000001' as SceneId;
  const SCENE_2_ID = 'scene_01JTEST0000000000000002' as SceneId;

  it('场景完成产出 SceneStageRecord 并进入会话暂存区，零正史写入', () => {
    const exitState: SceneExitState = {
      sceneId: SCENE_1_ID,
      chapterSessionId: 'sess_ch3_01',
      draftHash: 'hash_s1_v1',
      deltaRefs: ['fact_01J_wounded'],
      unresolvedPromiseRefs: [],
      nextSceneRequirements: ['必须进行疗伤调息'],
      schemaVersion: 1,
    };

    const deltas: CandidateDeltaBatch = {
      temporalFact: [
        {
          id: 'fact_01J_wounded',
          subject: 'char:chen-que',
          predicate: 'state.injured',
          value: '左臂剑伤深可见骨',
          validFrom: 3,
          validUntil: null,
          importance: 'critical',
          riskClass: 'high',
          status: 'candidate',
        },
      ],
    };

    const record: SceneStageRecord = {
      sceneId: SCENE_1_ID,
      orderIndex: 1,
      draftText: '陈缺闷哼一声，左臂被剑气洞穿，鲜血染透青衣。',
      draftContentHash: 'hash_s1_v1',
      exitState,
      stagedDeltas: deltas,
      stagedAt: new Date().toISOString(),
    };

    let overlay = createStagedOverlay();
    overlay = stageScene(overlay, record);

    expect(overlay.stages.length).toBe(1);
    expect(overlay.stages[0]?.sceneId).toBe(SCENE_1_ID);
    expect(overlay.accumulatedDeltas.temporalFact?.length).toBe(1);
  });

  it('前序场景的 staged overlay 能够叠入后序场景的上下文事实集', () => {
    const baseFacts = [
      {
        id: 'fact_base_healthy',
        subject: 'char:chen-que',
        predicate: 'state.injured',
        value: '完好无损',
        validFrom: 1,
        validUntil: null,
      },
    ];

    let overlay = createStagedOverlay();
    overlay = stageScene(overlay, {
      sceneId: SCENE_1_ID,
      orderIndex: 1,
      draftText: '陈缺左臂中剑。',
      draftContentHash: 'hash_s1_v1',
      exitState: {
        sceneId: SCENE_1_ID,
        chapterSessionId: 'sess_ch3_01',
        draftHash: 'hash_s1_v1',
        deltaRefs: ['fact_s1_wounded'],
        unresolvedPromiseRefs: [],
        nextSceneRequirements: [],
        schemaVersion: 1,
      },
      stagedDeltas: {
        temporalFact: [
          {
            id: 'fact_s1_wounded',
            subject: 'char:chen-que',
            predicate: 'state.injured',
            value: '左臂重伤',
            validFrom: 3,
            validUntil: null,
          },
        ],
      },
      stagedAt: new Date().toISOString(),
    });

    const mergedFacts = mergeStagedOverlay(baseFacts, overlay);
    // 后序场景观察到的状态必须反映 Scene 1 的最新暂存事实
    const injuredFact = mergedFacts.find((f) => f.predicate === 'state.injured');
    expect(injuredFact).toBeDefined();
    expect(injuredFact?.value).toBe('左臂重伤');
  });

  it('回改前序场景时，依赖它的后序场景暂存与 Receipt 自动失效', () => {
    let overlay = createStagedOverlay();
    overlay = stageScene(overlay, {
      sceneId: SCENE_1_ID,
      orderIndex: 1,
      draftText: '场景 1 原稿',
      draftContentHash: 'hash_s1_v1',
      exitState: {
        sceneId: SCENE_1_ID,
        chapterSessionId: 'sess_ch3_01',
        draftHash: 'hash_s1_v1',
        deltaRefs: [],
        unresolvedPromiseRefs: [],
        nextSceneRequirements: [],
        schemaVersion: 1,
      },
      stagedDeltas: {},
      stagedAt: new Date().toISOString(),
    });

    overlay = stageScene(overlay, {
      sceneId: SCENE_2_ID,
      orderIndex: 2,
      draftText: '场景 2 原稿',
      draftContentHash: 'hash_s2_v1',
      exitState: {
        sceneId: SCENE_2_ID,
        chapterSessionId: 'sess_ch3_01',
        draftHash: 'hash_s2_v1',
        deltaRefs: [],
        unresolvedPromiseRefs: [],
        nextSceneRequirements: [],
        schemaVersion: 1,
      },
      stagedDeltas: {},
      stagedAt: new Date().toISOString(),
    });

    expect(overlay.stages.length).toBe(2);

    // 修改场景 1（从 orderIndex=1 起失效后序）
    const pruned = invalidateDownstreamStages(overlay, 1);
    expect(pruned.stages.length).toBe(1); // 场景 2 被清除失效
    expect(pruned.invalidatedSceneIds).toContain(SCENE_2_ID);
  });
});
