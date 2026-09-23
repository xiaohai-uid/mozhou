/**
 * T22 验收测试（#55）：七维特征提取——正反例数值断言。
 * 纯函数级：直接构造 PipelineLedgerRow 夹具（payload 形状逐字段对照
 * multi-candidate.ts:69-83 / user-edit-step.ts:226-237 / record-step.ts:126-137）。
 * 零时钟零外部服务。
 */
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@mozhou/kernel';
import type { PipelineLedgerRow } from '@mozhou/pipeline';
import { PREFERENCE_DIMS, W_DECISION, W_EDIT_DELETE, W_EDIT_PROSE } from './types.js';
import {
  dialogueCharRatio,
  extractObservations,
  nearestRankPercentile,
  sentenceLengths,
  tokenizeUnits,
  ttrWin500,
} from './features.js';

let position = 0;
function taskEvent(type: DomainEvent['type'], payload: Record<string, unknown>, taskRef = 'tsk_t22_f'): PipelineLedgerRow {
  position += 1;
  return { position, kind: 'task', seq: position, event: { type, taskRef, chapterIndex: 5, payload } };
}
function reset() {
  position = 0;
}

describe('f6/f7 candidate_decision 观测', () => {
  it('双路决策 join CandidateCreated：cand_len_diff=均值差、level_ratio 语境位、w=1.0', () => {
    reset();
    const rows = [
      taskEvent('CandidateCreated', { candidateId: 'cand_a', level: 'cursor', chars: 100 }),
      taskEvent('CandidateCreated', { candidateId: 'cand_b', level: 'cursor', chars: 50 }),
      taskEvent('CandidateCreated', { candidateId: 'cand_c', level: 'cursor', chars: 80 }),
      taskEvent('UserEditRecorded', {
        action: 'candidate_decision',
        level: 'cursor',
        acceptedOptionIds: ['cand_b'],
        rejectedOptionIds: ['cand_a', 'cand_c'],
      }),
    ];
    const observations = extractObservations(rows);
    expect(observations).toHaveLength(1);
    const obs = observations[0]!;
    // Σacc/1 − Σrej/2 = 50 − 90 = −40（手算锚）
    expect(obs.features['cand_len_diff']).toBeCloseTo(-40, 10);
    expect(obs.features['level_ratio']).toBe(1);
    expect(obs.w).toBe(W_DECISION);
    expect(obs.kind).toBe('candidate_decision');
    expect(obs.obsId).toBe(String(obs.sourcePosition));
    expect(obs.sceneType).toBeNull();
    expect(obs.taskRef).toBe('tsk_t22_f');
    expect(obs.chapterIndex).toBe(5);
  });

  it('selection 决策 level_ratio 记 0；观测键集恰为 {cand_len_diff, level_ratio}', () => {
    reset();
    const rows = [
      taskEvent('CandidateCreated', { candidateId: 'x1', level: 'selection', chars: 10 }),
      taskEvent('CandidateCreated', { candidateId: 'x2', level: 'selection', chars: 30 }),
      taskEvent('UserEditRecorded', {
        action: 'candidate_decision',
        level: 'selection',
        acceptedOptionIds: ['x2'],
        rejectedOptionIds: ['x1'],
      }),
    ];
    const [obs] = extractObservations(rows);
    expect(obs!.features['level_ratio']).toBe(0);
    expect(Object.keys(obs!.features).sort()).toEqual(['cand_len_diff', 'level_ratio']);
  });

  it('反例：单路决策 / 双路相交 / 凭空候选 id 一律跳过（宁败不猜）', () => {
    reset();
    const rows = [
      taskEvent('CandidateCreated', { candidateId: 'k1', level: 'cursor', chars: 10 }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'cursor', acceptedOptionIds: ['k1'], rejectedOptionIds: [] }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'cursor', acceptedOptionIds: ['k1'], rejectedOptionIds: ['k1'] }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'cursor', acceptedOptionIds: ['ghost'], rejectedOptionIds: ['k1'] }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'warp', acceptedOptionIds: ['k1'], rejectedOptionIds: ['k2'] }),
    ];
    expect(extractObservations(rows)).toHaveLength(0);
  });
});

describe('f1-f5 edit_blocks 观测（source 过滤）', () => {
  it('assistant 回写通道整体排除；author 混合块按 op 拆分观测', () => {
    reset();
    const blocks = [{ op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '他推门。雨停了。' }];
    const assistant = [taskEvent('UserEditRecorded', { action: 'edit_blocks', level: 'cursor', source: 'assistant', blocks, revision: 3 })];
    expect(extractObservations(assistant)).toHaveLength(0);

    const authorRows = [
      taskEvent('UserEditRecorded', { action: 'edit_blocks', level: 'cursor', source: 'author',
        blocks: [
          { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '他推门。雨停了。' },
          { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '「走。」她说。' },
          { op: 'delete', paragraphStart: 4, paragraphEnd: 5 },
          { op: 'explode' },                       // 坏块：静默跳过
          { op: 'delete', paragraphStart: 9, paragraphEnd: 9, replacementText: '违例' },
        ] }),
    ];
    const observations = extractObservations(authorRows);
    expect(observations.map((obs) => obs.kind)).toEqual(['edit_replace', 'edit_insert', 'edit_delete']);
    expect(observations[0]!.obsId).toBe(`${observations[0]!.sourcePosition}:0`);
    expect(observations[2]!.obsId).toBe(`${observations[2]!.sourcePosition}:2`);
  });

  it('replace 块文本四特征手算锚：mean=3 p90=3 dlg=0 ttr=7/8；span=区间行数；w=0.3', () => {
    reset();
    const rows = [taskEvent('UserEditRecorded', { action: 'edit_blocks', level: 'cursor', source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '他推门。雨停了。' }] })];
    const [obs] = extractObservations(rows);
    expect(obs!.features['sent_len_mean']).toBeCloseTo(3, 10);       // 句长 [3,3]
    expect(obs!.features['sent_len_p90']).toBe(3);
    expect(obs!.features['dlg_char_ratio']).toBe(0);                 // 无引号
    expect(obs!.features['ttr_win500']).toBeCloseTo(7 / 8, 10);      // 8 词元 7 类型
    expect(obs!.features['para_line_span']).toBe(1);                 // end−start+1
    expect(obs!.w).toBe(W_EDIT_PROSE);
  });

  it('insert 块：对话密度 1/8、span 取 replacementText 行数；delete 块只有位置两特征且 w=0.15', () => {
    reset();
    const rows = [taskEvent('UserEditRecorded', { action: 'edit_blocks', level: 'selection', source: 'author',
      blocks: [
        { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '「走。」她说。' },
        { op: 'insert', paragraphStart: 4, paragraphEnd: 4, replacementText: '一行\n两行\n三行' },
        { op: 'delete', paragraphStart: 6, paragraphEnd: 8 },
      ] })];
    const observations = extractObservations(rows);
    const dialogue = observations[0]!;
    expect(dialogue.features['sent_len_mean']).toBeCloseTo(2.5, 10);   // 「走 / 」她说 → [2,3]
    expect(dialogue.features['sent_len_p90']).toBe(3);
    expect(dialogue.features['dlg_char_ratio']).toBeCloseTo(2 / 7, 10); // 引号内「走。」两字符 / 全句 7 码点
    expect(dialogue.features['ttr_win500']).toBeCloseTo(6 / 7, 10);     // 7 词元 6 类型（。出现两次）
    expect(dialogue.features['para_line_span']).toBe(1);
    expect(dialogue.features['level_ratio']).toBe(0);

    const multiline = observations[1]!;
    expect(multiline.features['para_line_span']).toBe(3);               // insert 行数口径

    const del = observations[2]!;
    expect(del.w).toBe(W_EDIT_DELETE);
    expect(Object.keys(del.features).sort()).toEqual(['level_ratio', 'para_line_span']);
    expect(del.features['para_line_span']).toBe(3);                     // 6..8 区间行数
    expect(del.features['sent_len_mean']).toBeUndefined();              // delete 无文本侧
  });
});

describe('FlywheelRecorded 窗口锚', () => {
  it('succeeded/state_degraded 双态成锚：w=0、degraded 映射、commitId 捕获', () => {
    reset();
    const rows = [
      taskEvent('FlywheelRecorded', { outcome: 'succeeded', commitId: 'cmt_ok_1', recordedCount: 2 }),
      taskEvent('FlywheelRecorded', { outcome: 'state_degraded', commitId: 'cmt_bad_1', recordedCount: 0, errorDetail: 'disk full' }),
    ];
    const observations = extractObservations(rows);
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ kind: 'window_anchor', w: 0, degraded: false, commitId: 'cmt_ok_1' });
    expect(observations[1]).toMatchObject({ kind: 'window_anchor', w: 0, degraded: true, commitId: 'cmt_bad_1' });
  });
});

describe('确定性特征原语', () => {
  it('切句/分位/对话比/词元化/ttr 多窗均值直算锚', () => {
    expect(sentenceLengths('他推门。雨停了！')).toEqual([3, 3]);
    expect(nearestRankPercentile([3, 3], 0.9)).toBe(3);
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9); // ⌈9⌉=第9个
    expect(dialogueCharRatio('「走」。')).toBeCloseTo(1 / 4, 10);
    expect(tokenizeUnits('他说hello世界')).toEqual(['他', '说', 'hello', '世', '界']);

    // 600 字两型交替：窗1 ttr=2/500、尾窗 ttr=2/100，均值 (0.004+0.02)/2
    const text = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? '甲' : '乙')).join('');
    expect(ttrWin500(text)).toBeCloseTo((2 / 500 + 2 / 100) / 2, 12);
    expect(ttrWin500('')).toBeUndefined();
  });

  it('特征键全集不越七维冻结面（词表依赖型特征显式出界）', () => {
    reset();
    const rows = [
      taskEvent('CandidateCreated', { candidateId: 'a', level: 'cursor', chars: 5 }),
      taskEvent('CandidateCreated', { candidateId: 'b', level: 'cursor', chars: 7 }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'cursor', acceptedOptionIds: ['a'], rejectedOptionIds: ['b'] }),
      taskEvent('UserEditRecorded', { action: 'edit_blocks', level: 'cursor', source: 'author',
        blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '雨。雷。电。' }] }),
    ];
    for (const obs of extractObservations(rows)) {
      for (const key of Object.keys(obs.features)) {
        expect(PREFERENCE_DIMS as readonly string[]).toContain(key);
      }
    }
  });

  it('同一账本输入重复提取结果逐项相同（rebuild 幂等前提）', () => {
    reset();
    const rows = [
      taskEvent('CandidateCreated', { candidateId: 'a', level: 'cursor', chars: 5 }),
      taskEvent('CandidateCreated', { candidateId: 'b', level: 'cursor', chars: 7 }),
      taskEvent('UserEditRecorded', { action: 'candidate_decision', level: 'cursor', acceptedOptionIds: ['a'], rejectedOptionIds: ['b'] }),
      taskEvent('FlywheelRecorded', { outcome: 'succeeded', commitId: 'cmt_x', recordedCount: 0 }),
    ];
    const first = JSON.stringify(extractObservations(rows));
    const second = JSON.stringify(extractObservations(rows));
    expect(second).toBe(first);
  });
});
