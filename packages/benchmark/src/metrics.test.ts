import { describe, expect, it } from 'vitest';
import { emptyCandidateCounts } from '@mozhou/pipeline';
import {
  judgeCanonAccuracy,
  judgeChangeImpactRecall,
  judgeContextBudgetOverflow,
  judgeKnowledgeLeakRate,
  judgePromiseRecall,
  judgeUserEditRatioReduction,
  readKnowledgeRowsFromBatch,
} from './metrics.js';

describe('六指标 L1 机械判定器（T20 #44）', () => {
  describe('CANON_ACCURACY——Continuity Gate 产物核检通过率', () => {
    it('正例：零硬冲突 ⇒ 1', () => {
      const batch = emptyCandidateCounts();
      batch.temporalFact = 4;
      batch.timelineEvent = 1;
      const gate = { verdict: 'pass', hardConflicts: [], advisory: [], checked: { batch, liveFacts: 2 } };
      expect(judgeCanonAccuracy(gate)).toBe(1);
    });
    it('反例：5 项核检 1 硬冲突 ⇒ 精确 0.8', () => {
      const batch = emptyCandidateCounts();
      batch.temporalFact = 5;
      const conflict = { factId: 'tf_1', assertion: '主角已用剑', suggestion: '改回空手' };
      const gate = { verdict: 'hard_conflict', hardConflicts: [conflict], advisory: [], checked: { batch, liveFacts: 0 } };
      expect(judgeCanonAccuracy(gate)).toBe(0.8);
    });
  });

  describe('KNOWLEDGE_LEAK_RATE——未知情者引用秘密的比率', () => {
    const canon = [
      { id: 'knst_1', factId: 'fact_map', holder: 'char:elder', knownSinceChapter: 2 },
    ];
    it('正例：唯一引用已被正典覆盖 ⇒ 0 泄漏', () => {
      const rate = judgeKnowledgeLeakRate({
        chapterIndex: 5,
        canonKnowledge: canon,
        extractedKnowledge: [{ factId: 'fact_map', holder: 'char:elder' }],
      });
      expect(rate).toBe(0);
    });
    it('反例：两引用一未覆盖 ⇒ 精确 0.5', () => {
      const rate = judgeKnowledgeLeakRate({
        chapterIndex: 3,
        canonKnowledge: canon,
        extractedKnowledge: [{ factId: 'fact_map', holder: 'char:elder' }, { factId: 'fact_map', holder: 'char:kid' }],
      });
      expect(rate).toBe(0.5);
    });
    it('批行收窄：坏行剔除、好行保留（形状守卫机械可复算）', () => {
      const rows = readKnowledgeRowsFromBatch({
        knowledgeState: [{ id: 'k1', factId: 'f1', holder: 'reader', knownSinceChapter: 1 }, '垃圾行', 42],
      });
      expect(rows).toEqual([{ factId: 'f1', holder: 'reader' }]);
    });
  });

  describe('PROMISE_RECALL——到期承诺进编译上下文的召回率', () => {
    const promises = [
      { promiseId: 'p1', type: 'foreshadowing', description: '信', introducedChapter: 3, targetChapter: 3, status: 'due' },
      { promiseId: 'p2', type: 'quest', description: '寻剑', introducedChapter: 4, targetChapter: 5, status: 'due' },
    ];
    it('正例：两条到期承诺都在 receipt 编译条目中 ⇒ 1', () => {
      const receipt = { entries: [
        { stage: 'tracking', order: 1, identifier: 'p1', included: true },
        { stage: 'tracking', order: 2, identifier: 'p2', included: true },
        { stage: 'canon', order: 3, identifier: 'other', included: true },
      ] };
      expect(judgePromiseRecall({ chapterIndex: 6, activePromises: promises, compiledReceipt: receipt })).toBe(1);
    });
    it('反例：p2 在 receipt 中但 included=false ⇒ 精确 0.5', () => {
      const receipt = { entries: [
        { stage: 'tracking', order: 1, identifier: 'p1', included: true },
        { stage: 'tracking', order: 2, identifier: 'p2', included: false },
      ] };
      expect(judgePromiseRecall({ chapterIndex: 6, activePromises: promises, compiledReceipt: receipt })).toBe(0.5);
    });
  });

  describe('CHANGE_IMPACT_RECALL——上游变更下游 stale 标记召回率', () => {
    const pins = [
      { chapterIndex: 4, dependencies: [{ kind: 'temporalFact' as const, id: 'tf_1', revision: 2 }] },
      { chapterIndex: 7, dependencies: [{ kind: 'temporalFact' as const, id: 'tf_1', revision: 1 }] },
    ];
    const modified = [{ kind: 'temporalFact' as const, id: 'tf_1', revision: 3 }];
    it('正例：两个读章全被标记 ⇒ 1', () => {
      expect(judgeChangeImpactRecall({ pins, modified, staleFlaggedChapters: [4, 7] })).toBe(1);
    });
    it('反例：漏标第 7 章 ⇒ 精确 0.5；无关变更 ⇒ 无期望空判 1', () => {
      expect(judgeChangeImpactRecall({ pins, modified, staleFlaggedChapters: [4] })).toBe(0.5);
      expect(judgeChangeImpactRecall({ pins, modified: [{ kind: 'scene' as const, id: 'sc_9', revision: 1 }], staleFlaggedChapters: [] })).toBe(1);
    });
  });

  describe('CONTEXT_BUDGET_OVERFLOW——编译总量超配额指示（0/1）', () => {
    it('正例：900/1000 未超 ⇒ 0', () => {
      expect(judgeContextBudgetOverflow({ allocatedTokens: 1000, actualTokens: 900 })).toBe(0);
    });
    it('反例：1200/1000 超额 ⇒ 1', () => {
      expect(judgeContextBudgetOverflow({ allocatedTokens: 1000, actualTokens: 1200 })).toBe(1);
    });
  });

  describe('USER_EDIT_RATIO_REDUCTION——新迭代人工改写下降率', () => {
    it('正例：基线 10 次 → 现 7 次 ⇒ 精确 0.3', () => {
      expect(judgeUserEditRatioReduction({ baselineEditCount: 10, currentEditCount: 7 })).toBe(0.3);
    });
    it('反例：改写不降反增 ⇒ 负值（门限 >0 判否）', () => {
      expect(judgeUserEditRatioReduction({ baselineEditCount: 10, currentEditCount: 12 })).toBe(-0.2);
    });
    it('边界：零基线零改写 ⇒ 1；零基线有改写 ⇒ 0', () => {
      expect(judgeUserEditRatioReduction({ baselineEditCount: 0, currentEditCount: 0 })).toBe(1);
      expect(judgeUserEditRatioReduction({ baselineEditCount: 0, currentEditCount: 3 })).toBe(0);
    });
  });
});
