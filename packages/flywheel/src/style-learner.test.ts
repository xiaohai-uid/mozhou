/**
 * T23 · #56 测试：学习核数值断言（α/Nmin/taboo/regime/独立分面/重放确定性）
 * + 文风.md 存储往返。零时钟零外部服务。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  emitStyleProfilesYaml,
  readStyleProfiles,
  seedStyleProfileRows,
  serializeStyleProfiles,
  STYLE_PROFILES_FENCE_OPEN,
} from '@mozhou/data-plane';
import type { ScenarioType } from '@mozhou/kernel';
import {
  emptyTabooCandidateState,
  updateStyleProfiles,
} from './style-learner.js';
import type { StyleEditObservation } from './style-learner.js';

function pos(
  scenarioType: ScenarioType,
  chapterIndex: number,
  dialogueRatio?: number,
  sentenceLengths?: number[],
): StyleEditObservation {
  return {
    scenarioType,
    chapterIndex,
    polarity: 'positive',
    ...(dialogueRatio === undefined ? {} : { dialogueRatio }),
    ...(sentenceLengths === undefined ? {} : { sentenceLengths }),
  };
}

function neg(scenarioType: ScenarioType, chapterIndex: number, deletedWords: string[]): StyleEditObservation {
  return { scenarioType, chapterIndex, polarity: 'negative', deletedWords };
}

describe('StyleLearner 学习核', () => {
  it('α=0.05 批内均值单步 EMA：dialogueRatio 与句长分布按批演化，未动行引用复用', () => {
    const before = seedStyleProfileRows();
    const batch = Array.from({ length: 10 }, () => pos('action', 7, 0.5, [8]));
    const { next, report } = updateStyleProfiles(before, batch);

    // EMA: 0.95*0.30 + 0.05*0.50 = 0.31
    expect(next.action.dialogueRatio).toBe(0.31);
    // 分布：桶0 = 0.95*0.15 + 0.05*1 = 0.1925；其余 ×0.95；Σ=1
    expect(next.action.sentenceLengthDistribution.map((b) => b.share)).toEqual([
      0.1925, 0.3325, 0.285, 0.1425, 0.0475,
    ]);
    // 桶边界永不动（分布可比性）
    expect(next.action.sentenceLengthDistribution.map((b) => b.maxLengthChars)).toEqual([10, 20, 35, 60, 120]);
    // 独立版本史：仅变化行 revision+1，未动行原对象复用
    expect(next.action.revision).toBe(before.action.revision + 1);
    expect(Object.is(next.dialogue, before.dialogue)).toBe(true);
    expect(next.dialogue.revision).toBe(before.dialogue.revision);
    // 审计报告
    expect(report.alphaUsed).toBe(0.05);
    expect(report.regimeChange).toBe(false);
    expect(report.outcomes.action).toMatchObject({ sampleCount: 10, updated: true });
    expect(report.outcomes.dialogue.skipReason).toBe('no_observations');
  });

  it('regimeBoost 二档 α=0.2 且 Δmax=0.1 过冲保险丝生效并打 regimeChange 标记', () => {
    const before = seedStyleProfileRows();
    const batch = Array.from({ length: 10 }, () => pos('dialogue', 7, 1));
    const { next, report } = updateStyleProfiles(before, batch, { regimeBoost: true });

    // 裸 EMA 位移 = |(0.95*0.3 + 0.2*1) − 0.3| = 0.185 越过 Δmax ⇒ 钳到 0.3+0.1（boost 期保险丝真实作用域）
    expect(next.dialogue.dialogueRatio).toBe(0.4);
    expect(report.alphaUsed).toBe(0.2);
    expect(report.regimeChange).toBe(true);
  });

  it('常规 α 下 Δmax 数学上恒不激活（t51:B6 澄清的回归钉）', () => {
    const before = seedStyleProfileRows(); // sensoryDensity 种子 0
    const batch = Array.from({ length: 10 }, () => pos('romance_emotion', 7, 1));
    const { next, report } = updateStyleProfiles(before, batch);
    // 最大可能距离（observed=1 vs old=0.3）位移仅 α·dist=0.035 < 0.1 ⇒ 无钳制
    expect(next.romance_emotion.dialogueRatio).toBe(0.335);
    expect(report.regimeChange).toBe(false);
  });

  it('分布分面 boost 期逐桶钳制后仍重归一化 Σshare≈1', () => {
    const before = seedStyleProfileRows();
    const batch = Array.from({ length: 10 }, () => pos('exposition_worldbuilding', 7, undefined, [8]));
    const { next } = updateStyleProfiles(before, batch, { regimeBoost: true });
    const shares = next.exposition_worldbuilding.sentenceLengthDistribution.map((b) => b.share);
    const sum = shares.reduce((acc, v) => acc + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
    // 桶0 裸位移 0.85 被 Δmax 钳到 0.25，其余桶被重归一化等比压回
    expect(shares[0]).toBeLessThan(0.26);
  });

  it('Nmin=10 样本门：不足则该型数值分面本批不更新（revision 不动）', () => {
    const before = seedStyleProfileRows();
    const nine = Array.from({ length: 9 }, () => pos('action', 7, 1));
    const short = updateStyleProfiles(before, nine);
    expect(short.report.outcomes.action).toMatchObject({ sampleCount: 9, updated: false, skipReason: 'nmin_not_met' });
    expect(short.next.action.dialogueRatio).toBe(before.action.dialogueRatio);
    expect(short.next.action.revision).toBe(before.action.revision);

    const ten = [...nine, pos('action', 7, 1)];
    const full = updateStyleProfiles(before, ten);
    expect(full.report.outcomes.action.updated).toBe(true);
    expect(full.next.action.revision).toBe(before.action.revision + 1);
  });

  it('taboo 转正：(词,章) 去重计数，跨 ≥2 章 ≥3 次才转正；单章刷次无效', () => {
    const before = seedStyleProfileRows();
    const singleChapter = [
      neg('action', 1, ['刀光']),
      neg('action', 1, ['刀光']),
      neg('action', 1, ['刀光']),
    ];
    const s1 = updateStyleProfiles(before, singleChapter, { tabooState: emptyTabooCandidateState() });
    expect(s1.next.action.tabooWords).toEqual([]);
    expect(s1.report.tabooPromotions).toEqual([]);
    expect(s1.report.nextTabooState.action).toEqual([{ word: '刀光', totalHits: 3, chapters: [1] }]);

    const crossChapter = [...singleChapter, neg('action', 2, ['刀光'])];
    const s2 = updateStyleProfiles(before, crossChapter, { tabooState: emptyTabooCandidateState() });
    expect(s2.next.action.tabooWords).toContain('刀光');
    expect(s2.report.tabooPromotions).toEqual([{ scenarioType: 'action', word: '刀光', hits: 4, chapterCount: 2 }]);
    // 仅 taboo 变化也推进该行 revision（行确实变了）
    expect(s2.next.action.revision).toBe(before.action.revision + 1);
    // 已转正词条剪出侧账
    expect(s2.report.nextTabooState.action).toEqual([]);
  });

  it('taboo 容量 50 FIFO 让位：第 51 词转正挤掉最早入表者', () => {
    const before = seedStyleProfileRows();
    const words = Array.from({ length: 51 }, (_, i) => `w${i}`);
    const batch = [5, 6, 7].map((chapterIndex) => neg('dialogue', chapterIndex, words));
    const { next } = updateStyleProfiles(before, batch, { tabooState: emptyTabooCandidateState() });
    expect(next.dialogue.tabooWords).toHaveLength(50);
    expect(next.dialogue.tabooWords).not.toContain('w0'); // 最早插入者让位
    expect(next.dialogue.tabooWords).toContain('w50');
  });

  it('保留不动零计入 + delete 不计正观测：负观测不推 Nmin 也不进 EMA', () => {
    const before = seedStyleProfileRows();
    const empty = updateStyleProfiles(before, []);
    expect(empty.next).toEqual(before);
    expect(Object.keys(empty.next).every((k) => Object.is(empty.next[k as ScenarioType], before[k as ScenarioType]))).toBe(true);

    const deletesOnly = Array.from({ length: 12 }, (_, i) => neg('action', i % 3, [`词${i}`]));
    const d = updateStyleProfiles(before, deletesOnly);
    expect(d.report.outcomes.action.sampleCount).toBe(0);
    expect(d.report.outcomes.action.skipReason).toBe('no_observations');
    expect(d.next.action.dialogueRatio).toBe(before.action.dialogueRatio);
    expect(d.next.action.sentenceLengthDistribution).toEqual(before.action.sentenceLengthDistribution);
  });

  it('四场景型独立分面：批次只演化被归类场景型', () => {
    const before = seedStyleProfileRows();
    const batch = Array.from({ length: 10 }, () => pos('exposition_worldbuilding', 3, 0.8));
    const { next } = updateStyleProfiles(before, batch);
    expect(next.exposition_worldbuilding.revision).toBe(before.exposition_worldbuilding.revision + 1);
    for (const st of ['action', 'dialogue', 'romance_emotion'] as const) {
      expect(next[st].revision).toBe(before[st].revision);
      expect(Object.is(next[st], before[st])).toBe(true);
    }
  });

  it('回滚=重放确定性：重放历史批次结果逐字节一致，revision 继续 +1', () => {
    const before = seedStyleProfileRows();
    const batch1 = Array.from({ length: 10 }, () => pos('action', 7, 0.5, [8]));
    const batch2 = Array.from({ length: 10 }, () => pos('action', 8, 0.7, [40]));

    const r1 = updateStyleProfiles(before, batch1);
    const r2 = updateStyleProfiles(r1.next, batch2);

    // 回滚到第 1 批 = 重放 ledger 前置事件重建同值
    const replay1 = updateStyleProfiles(before, batch1);
    expect(replay1.next).toEqual(r1.next);
    // 覆写为第 1 批 after 值后继续第 2 批：revision 是变更计数不是分支号——继续 +1
    const resumed = updateStyleProfiles(replay1.next, batch2);
    expect(resumed.next).toEqual(r2.next);
    expect(resumed.next.action.revision).toBe(before.action.revision + 2);
    expect(resumed.next.action.dialogueRatio).toBeCloseTo(0.3295, 10); // 0.95*0.31 + 0.05*0.7
  });
});

describe('文风.md 存储往返（readStyleProfiles/serializeStyleProfiles）', () => {
  const FRONTMATTER = '---\nmzhouId: style_test_0001\nkind: styleProfile\n---\n\n# 文风画像\n\n';

  function makeRaw(rows: ReturnType<typeof seedStyleProfileRows>): string {
    return FRONTMATTER + emitStyleProfilesYaml(rows);
  }

  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mozhou-style-test-'));
    mkdirSync(root, { recursive: true });
  });
  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  it('seed → emit → 写盘 → read 往返恒等（含 id/revision/taboo 保真）', () => {
    const rows = seedStyleProfileRows();
    writeFileSync(join(root, '文风.md'), makeRaw(rows), 'utf8');
    expect(readStyleProfiles(root)).toEqual(rows);
  });

  it('serialize 只整块替换 fenced-YAML，围栏外字节原样保留', () => {
    const rows = seedStyleProfileRows();
    const raw = makeRaw(rows);
    const mutated = { ...rows, action: { ...rows.action, revision: 3, dialogueRatio: 0.44 } };
    const rewritten = serializeStyleProfiles(raw, mutated);
    expect(rewritten.startsWith(FRONTMATTER)).toBe(true);
    writeFileSync(join(root, '文风.md'), rewritten, 'utf8');
    const reread = readStyleProfiles(root);
    expect(reread.action.revision).toBe(3);
    expect(reread.action.dialogueRatio).toBe(0.44);
    expect(reread.dialogue).toEqual(rows.dialogue);
  });

  it('宁败不脏：缺围栏 / share 合计偏离 1 都响亮失败', () => {
    writeFileSync(join(root, '文风.md'), FRONTMATTER + '无围栏旧文件\n', 'utf8');
    expect(() => readStyleProfiles(root)).toThrow(/围栏/);

    const tampered = makeRaw(seedStyleProfileRows()).replace('share: 0.15', 'share: 0.55');
    writeFileSync(join(root, '文风.md'), tampered, 'utf8');
    expect(() => readStyleProfiles(root)).toThrow(/≈1/);
  });

  it('fenced 围栏标记常量与存储层一致', () => {
    expect(STYLE_PROFILES_FENCE_OPEN).toBe('\u0060\u0060\u0060yaml');
  });
});
