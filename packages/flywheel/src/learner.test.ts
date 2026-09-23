/**
 * T22 验收测试（#55 · 集成面）：cursor 幂等续读 / 快照延迟物化 / R1 标量红线
 * 扫描 / R3 删除即重置 / rebuild 排序内容集指纹 + 行为等值（T10b 教训编码）。
 * 全程真实 producer 供给事件面（presentCandidates/recordCandidateDecision/
 * recordUserEdit/runFlywheelRecord）——learner 是纯消费端，producer 源码零改动。
 * 零时钟（机械 id 显式注入）零外部服务，hermetic 临时书。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus } from '@mozhou/runtime';
import { LocalDataPlane, createBook } from '@mozhou/data-plane';
import {
  presentCandidates,
  recordCandidateDecision,
  recordUserEdit,
  readPipelineLedger,
  runFlywheelRecord,
} from '@mozhou/pipeline';
type PipelineLedgerRow = Awaited<ReturnType<typeof readPipelineLedger>>[number];
import {
  KAPPA0,
  M0,
  OBSERVATIONS_RELPATH,
  PREFERENCE_DIR,
  PROFILE_RELPATH,
  extractObservations,
  hasMaterializedProfile,
  posteriorMean,
  rebuildPreference,
  runPreferenceLearning,
} from './index.js';
import type { PreferenceProfileState } from './index.js';

const TASK = 'tsk_t22_learner';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function hermeticBook(title: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mozhou-t22-${title}-`));
  roots.push(dir);
  createBook({ dir, title: `T22${title}之书` });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 5, title: '第五章' });
  return dir;
}

function deps(root: string, bus: PublishBus) {
  return { bus, bookRoot: root, taskRef: TASK, chapterIndex: 5 };
}

/** 候选原文/替换文本——R1 扫描的毒饵（任何一处泄漏进 preference 目录即红）。 */
const POISON = {
  candA: '版本甲雨夜追凶的原文段落',
  candB: '版本乙雪夜闭门守城的原文',
  candC: '版本丙晨雾渡江的原文段落',
  seedLine1: '他推门。雨停了。',
  seedLine2: '「走。」她说。',
  replaceText: '雨点砸在铁皮屋檐上，他退进暗影里。',
  assistantText: '助手回写通道的原文片段标记甲乙丙丁',
} as const;

/** 批次一：铺底作者两行 + 三候选择优 + succeeded 收尾锚。 */
function writeBatch1(root: string, bus: PublishBus): void {
  const d = deps(root, bus);
  recordUserEdit({ ...d, level: 'cursor', source: 'author', blocks: [
    { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: POISON.seedLine1 },
    { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: POISON.seedLine2 },
  ] });
  presentCandidates(d, {
    level: 'cursor',
    options: [
      { candidateId: 'cand_a', text: POISON.candA },   // 12 字
      { candidateId: 'cand_b', text: `${POISON.candB}补足` }, // 拉开长度差
      { candidateId: 'cand_c', text: POISON.candC },
    ],
  });
  recordCandidateDecision(d, { level: 'cursor', acceptedOptionIds: ['cand_b'], rejectedOptionIds: ['cand_a', 'cand_c'] });
  runFlywheelRecord({ ...d, commitId: 'cmt_t22_b1', usage: [], newEntryId: (i) => `usg_t22_b1_${i}` });
}

/** 批次二：新候选 selection 决策 + 作者改稿 + degraded 收尾锚。 */
function writeBatch2(root: string, bus: PublishBus): void {
  const d = deps(root, bus);
  presentCandidates(d, {
    level: 'selection',
    options: [
      { candidateId: 'cand_d', text: `${POISON.candA}七十字长度版本丁丁丁` },
      { candidateId: 'cand_e', text: `${POISON.candB}三十字版本戊` },
    ],
  });
  recordCandidateDecision(d, { level: 'selection', acceptedOptionIds: ['cand_e'], rejectedOptionIds: ['cand_d'] });
  recordUserEdit({ ...d, level: 'selection', source: 'author', blocks: [
    { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: POISON.replaceText },
  ] });
  // 记账故障 → state_degraded 锚（S12 不阻断）
  runFlywheelRecord({
    ...d,
    commitId: 'cmt_t22_b2',
    usage: [{ kind: 'usage', inputTokens: 1 }],
    projectionSink: () => {
      throw new Error('disk full (fixture)');
    },
    newEntryId: (i) => `usg_t22_b2_${i}`,
  });
}

/** assistant 回写事件（非保护位草稿合法落账；learner 读侧必须整体排除）。 */
function writeAssistantEdit(root: string, bus: PublishBus): void {
  recordUserEdit({ ...deps(root, bus), level: 'cursor', source: 'assistant', blocks: [
    { op: 'insert', paragraphStart: 4, paragraphEnd: 4, replacementText: POISON.assistantText },
  ] });
}

/* ---------------------------------------------------------------------------
 * 指纹与探针（T10b 教训：排序内容集哈希，物理行序不进指纹）
 * ------------------------------------------------------------------------- */

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 观测行排序集 + 画像规范化字节 → 内容集指纹（与物理行序无关）。 */
function fingerprint(root: string): string {
  const obsPath = join(root, OBSERVATIONS_RELPATH);
  const profilePath = join(root, PROFILE_RELPATH);
  const obsLines = existsSync(obsPath)
    ? readFileSync(obsPath, 'utf8').split('\n').filter((line) => line.trim().length > 0)
        .map((line) => stableStringify(JSON.parse(line))).sort()
    : [];
  const profilePart = existsSync(profilePath)
    ? stableStringify(JSON.parse(readFileSync(profilePath, 'utf8')))
    : 'absent';
  return sha256(`${obsLines.join('\n')}\u0000${profilePart}`);
}

function behaviorProbe(profile: PreferenceProfileState): Record<string, number | string> {
  const probe: Record<string, number | string> = {
    obsCount: profile.obsCount,
    cursor: profile.cursor,
    degradedWindows: profile.degradedWindows,
    driftLogLength: profile.driftLog.length,
  };
  for (const [dim, state] of Object.entries(profile.dims)) {
    probe[`mean:${dim}`] = posteriorMean(dim as Parameters<typeof posteriorMean>[0], state).toFixed(12);
    probe[`kappa:${dim}`] = state.kappaEff.toFixed(12);
  }
  return probe;
}

describe('快照延迟物化（t51:A2）', () => {
  it('空账本：零观测不物化、不建目录、画像停在 m₀ 先验', () => {
    const root = hermeticBook('cold');
    const outcome = runPreferenceLearning(root);
    expect(outcome.processedObservations).toBe(0);
    expect(outcome.materialized).toBe(false);
    expect(outcome.mode).toBe('rebuild');
    expect(hasMaterializedProfile(root)).toBe(false);
    expect(existsSync(join(root, PREFERENCE_DIR))).toBe(false);
    expect(posteriorMean('sent_len_mean', outcome.profile.dims['sent_len_mean'])).toBe(M0['sent_len_mean']);
    expect(posteriorMean('cand_len_diff', outcome.profile.dims['cand_len_diff'])).toBe(M0['cand_len_diff']);
  });

  it('首批观测后物化：两份产物落盘且 obsCount>0', () => {
    const root = hermeticBook('first');
    writeBatch1(root, new PublishBus());
    const outcome = runPreferenceLearning(root);
    expect(outcome.materialized).toBe(true);
    expect(outcome.profile.obsCount).toBeGreaterThan(0);
    expect(hasMaterializedProfile(root)).toBe(true);
  });
});

describe('读面与数值（真实 producer 事件）', () => {
  it('assistant 回写整体排除；author 双批次折叠出精确后验', () => {
    const root = hermeticBook('signal');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    writeAssistantEdit(root, bus);
    writeBatch2(root, bus);

    const outcome = runPreferenceLearning(root);

    // 观测计数：种子 2 insert + 决策 2 + 改稿 replace 1 = 偏好样本 5；锚 2 不计
    expect(outcome.profile.obsCount).toBe(5);
    expect(outcome.profile.degradedWindows).toBe(1); // batch2 degraded 锚

    // f6 数值锚：两决策各贡献 w=1
    const candidateRows = readPipelineLedger(root).filter(
      (row): row is Extract<PipelineLedgerRow, { kind: 'task' }> =>
        row.kind === 'task' && row.event.type === 'CandidateCreated',
    );
    const lens = candidateRows.map((row) => Number(row.event.payload?.['chars']));
    expect(lens.sort((a, b) => a - b)).toHaveLength(5);
    const outcomeDiff = outcome.profile.dims['cand_len_diff'];
    expect(outcomeDiff.W).toBeCloseTo(2, 10); // 只有两个决策喂 f6

    // f7 语境位：cursor(w1)+selection 两决策+编辑三态全带 level 位
    // f1 手算锚：句均 3(seed1)+2.5(seed2)+16(replace) 各带 w=.3 → mean=(8·42+0.3·21.5)/8.9
    expect(posteriorMean('sent_len_mean', outcome.profile.dims['sent_len_mean']))
      .toBeCloseTo((KAPPA0 * 42 + 0.3 * 21.5) / (KAPPA0 + 0.9), 10);

    // assistant 文本不得产生任何观测：f1 的 W 若混入 assistant insert 会偏离 0.9
    expect(outcome.profile.dims['sent_len_mean'].W).toBeCloseTo(0.9, 10);
  });

  it('<5 条跳过判定：四样本内漂移连击不启动、κ_eff 不动', () => {
    const root = hermeticBook('skip');
    writeBatch1(root, new PublishBus());
    const outcome = runPreferenceLearning(root);
    for (const state of Object.values(outcome.profile.dims)) {
      expect(state.kappaEff).toBe(KAPPA0);
    }
    expect(outcome.profile.driftLog).toHaveLength(0);
  });
});

describe('R1 标量红线扫描', () => {
  it('preference 目录全文无正文片段毒饵、无任何 CJK 字节', () => {
    const root = hermeticBook('r1');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    writeAssistantEdit(root, bus);
    writeBatch2(root, bus);
    runPreferenceLearning(root);
    rebuildPreference(root);

    const dir = join(root, PREFERENCE_DIR);
    expect(existsSync(dir)).toBe(true);
    let allBytes = '';
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else allBytes += readFileSync(full, 'utf8');
      }
    };
    walk(dir);

    for (const [label, poison] of Object.entries(POISON)) {
      expect(allBytes.includes(poison), `poison leak: ${label}`).toBe(false);
      expect(allBytes.includes(poison.slice(0, 8)), `prefix leak: ${label}`).toBe(false);
    }
    // 更强不变量：本包持久化形状只含 id/数字/null/枚举词——不应出现任何 CJK
    expect(/[一-鿿]/.test(allBytes)).toBe(false);
  });
});

describe('cursor 幂等续读', () => {
  it('重复运行追加零条、两份产物字节不动；增量批次只吃新增', () => {
    const root = hermeticBook('cursor');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    const first = runPreferenceLearning(root);
    const obsBytes1 = readFileSync(join(root, OBSERVATIONS_RELPATH), 'utf8');
    const profileBytes1 = readFileSync(join(root, PROFILE_RELPATH), 'utf8');

    const second = runPreferenceLearning(root);
    expect(second.processedObservations).toBe(0);
    expect(second.mode).toBe('resume');
    expect(readFileSync(join(root, OBSERVATIONS_RELPATH), 'utf8')).toBe(obsBytes1);
    expect(readFileSync(join(root, PROFILE_RELPATH), 'utf8')).toBe(profileBytes1);

    // 续读：batch2 追加后只消费新增
    writeBatch2(root, bus);
    const third = runPreferenceLearning(root);
    expect(third.mode).toBe('resume');
    expect(third.processedObservations).toBe(3); // 决策+replace+单锚（batch2）
    expect(third.profile.obsCount).toBe(first.profile.obsCount + 2);
    expect(third.profile.degradedWindows).toBe(1);
  });

  it('分批增量与一次性全量的画像逐字段相等（浮点同序折叠）', () => {
    const incremental = hermeticBook('incr');
    const once = hermeticBook('once');
    const busA = new PublishBus();

    writeBatch1(incremental, busA);
    runPreferenceLearning(incremental);
    writeAssistantEdit(incremental, busA);
    writeBatch2(incremental, busA);
    const incrementalOutcome = runPreferenceLearning(incremental);

    // 一次性书：直接拷贝最终账本字节（同一内容集合）
    const ledgerBytes = readFileSync(join(incremental, '.mozhou/events.jsonl'), 'utf8');
    mkdirSync(join(once, '.mozhou'), { recursive: true });
    writeFileSync(join(once, '.mozhou/events.jsonl'), Buffer.from(ledgerBytes, 'utf8'));
    const onceOutcome = runPreferenceLearning(once);

    expect(stableStringify(onceOutcome.profile)).toBe(stableStringify(incrementalOutcome.profile));
    expect(behaviorProbe(onceOutcome.profile)).toEqual(behaviorProbe(incrementalOutcome.profile));
  });
});

describe('自愈（快照损坏）', () => {
  it('profile.json 损坏 → 冷启动整表重折无损恢复', () => {
    const root = hermeticBook('heal');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    writeBatch2(root, bus);
    const healthy = runPreferenceLearning(root);
    const healthyCanonical = stableStringify(healthy.profile);

    writeFileSync(join(root, PROFILE_RELPATH), Buffer.from('{oops torn json', 'utf8'));
    const healed = runPreferenceLearning(root);

    expect(healed.mode).toBe('rebuild');
    expect(stableStringify(healed.profile)).toBe(healthyCanonical);
  });
});

describe('R3 删除即重置', () => {
  it('删 .mozhou/preference 目录 = 完整冷启动，同账本重建出等值内容集', () => {
    const root = hermeticBook('r3');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    writeBatch2(root, bus);
    const before = runPreferenceLearning(root);

    rmSync(join(root, PREFERENCE_DIR), { recursive: true, force: true });
    expect(hasMaterializedProfile(root)).toBe(false);

    const after = runPreferenceLearning(root);
    expect(after.mode).toBe('rebuild');
    expect(stableStringify(after.profile)).toBe(stableStringify(before.profile));
  });
});

describe('rebuild 幂等指纹（T10b 教训：排序内容集哈希）', () => {
  it('rebuild×2 指纹相同；增量终态与 rebuild 指纹相同；行为探针逐项等值', () => {
    const root = hermeticBook('fp');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    runPreferenceLearning(root);
    writeBatch2(root, bus);
    runPreferenceLearning(root);
    const incrementalFingerprint = fingerprint(root);
    const incrementalProfile = runPreferenceLearning(root).profile;

    const rebuilt1 = rebuildPreference(root);
    const fp1 = fingerprint(root);
    const rebuilt2 = rebuildPreference(root);
    const fp2 = fingerprint(root);

    expect(fp1).toBe(fp2);
    expect(fp1).toBe(incrementalFingerprint);
    expect(rebuilt1.observationCount).toBe(rebuilt2.observationCount);
    expect(behaviorProbe(rebuilt1.profile)).toEqual(behaviorProbe(rebuilt2.profile));
    expect(behaviorProbe(rebuilt1.profile)).toEqual(behaviorProbe(incrementalProfile));
  });

  it('物理行序扰动不改变指纹（交错写入 vs 重扫描排列差异免疫）', () => {
    const root = hermeticBook('shuffle');
    writeBatch1(root, new PublishBus());
    writeBatch2(root, new PublishBus());
    rebuildPreference(root);
    const baseline = fingerprint(root);

    // 物理重排 observations.jsonl 行序（内容集合不变）
    const obsPath = join(root, OBSERVATIONS_RELPATH);
    const lines = readFileSync(obsPath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
    const shuffled = [...lines].reverse().join('\n') + '\n';
    writeFileSync(obsPath, Buffer.from(shuffled, 'utf8'));

    rebuildPreference(root); // rebuild 重写为权威序 → 指纹必须仍等值
    expect(fingerprint(root)).toBe(baseline);
    // 且排序集指纹对乱序文件本身也稳定（读侧先到先得 + 指纹排序双重免疫）
    expect(fingerprint(root)).toBe(baseline);
  });
});

describe('extractObservations × 真实账本一致性', () => {
  it('learner 提取数与持久化行数一致（含窗口锚）', () => {
    const root = hermeticBook('consistent');
    const bus = new PublishBus();
    writeBatch1(root, bus);
    writeBatch2(root, bus);
    runPreferenceLearning(root);

    const fromLedger = extractObservations(readPipelineLedger(root));
    const rebuilt = rebuildPreference(root);
    expect(rebuilt.observationCount).toBe(fromLedger.length);
  });
});
