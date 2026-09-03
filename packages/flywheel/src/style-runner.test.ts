/**
 * StyleLearner 触发点编排验收（T23 · #56；t48-b §6-C）。
 *
 * 端到端：author 编辑 → 窗口闭合（runFlywheelRecord + afterRecord 注入
 * runStyleLearnerForWindow）→ 文风.md 学习更新 + StyleProfileUpdated 审计事件。
 * 学习核数值/aboo 转正细节由 style-learner.test.ts 覆盖（14 例），本文件只验编排面。
 * 全程 hermetic 临时书、零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import { LocalDataPlane, createBook, readStyleProfiles } from '@mozhou/data-plane';
import { readPipelineLedger, recordUserEdit, runFlywheelRecord } from '@mozhou/pipeline';
import { loadTabooCandidateState, runStyleLearnerForWindow } from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function hermeticBook(): { root: string; bus: PublishBus; engine: RuntimeEngine } {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t23-runner-'));
  roots.push(root);
  createBook({ dir: root, title: 'T23触发点' });
  const plane = LocalDataPlane.open(root);
  for (const chapterIndex of [1, 2]) {
    plane.createChapterDraft({ chapterIndex, title: '第' + chapterIndex + '章' });
  }
  const bus = new PublishBus();
  const engine = new RuntimeEngine({
    bus,
    ctx: { root },
    newTaskRef: (() => {
      let n = 0;
      return () => 'gen_' + String(++n).padStart(3, '0');
    })(),
    nowMs: (() => {
      let n = 1000;
      return () => (n += 10);
    })(),
  });
  engine.registerCapability({
    taskType: 'chapter_draft',
    providerId: 'prov_a',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  engine.registerProviderBinding('prov_a', () => Promise.resolve('正文'));
  return { root, bus, engine };
}

/** author 编辑：注入 >=10 句短句（Nmin 门一次凑够；每句 10-20 字）。 */
function authorEditMany(root: string, bus: PublishBus, taskRef: string, chapterIndex: number): void {
  const sentences = Array.from({ length: 12 }, (_, i) => '他走了' + (i + 1) + '步。');
  recordUserEdit({
    bus,
    bookRoot: root,
    taskRef,
    chapterIndex,
    level: 'selection',
    source: 'author',
    blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: sentences.join('') }],
  });
}

describe('runStyleLearnerForWindow · 触发点编排', () => {
  it('author 编辑凑满 Nmin：文风.md 数值更新 + 审计事件落账 + 画像 revision +1', async () => {
    const { root, bus, engine } = hermeticBook();
    await engine.execute('chapter_draft', {}, {
      parentTaskRef: 'w_1',
      chapterIndex: 1,
      eventPayload: { recipeSnapshot: { recipe: { recipeVersion: 'v1' } } },
    });
    authorEditMany(root, bus, 'w_1', 1);
    runFlywheelRecord({
      bus,
      bookRoot: root,
      taskRef: 'w_1',
      chapterIndex: 1,
      commitId: 'c1',
      usage: [],
      newEntryId: () => 'anchor1',
      afterRecord: () =>
        runStyleLearnerForWindow({ bus, bookRoot: root, taskRef: 'w_1', chapterIndex: 1 }),
    });

    // 第 1 章奇章 → 占位路由 action（pickScenarioType 章奇→action）
    const profiles = readStyleProfiles(root);
    expect(profiles.action.revision).toBe(1);
    // 数值分面确实更新：12 句句长约 6 字 → <10 字桶 share 应从种子 0.15 上升
    expect(profiles.action.sentenceLengthDistribution[0]?.share).toBeGreaterThan(0.15);

    // 审计事件：StyleProfileUpdated 顶层 taskRef/chapterIndex + outcome/alphaUsed payload
    const ledger = readPipelineLedger(root);
    const audits = ledger
      .filter((row) => row.kind === 'task')
      .map((row) => row.event)
      .filter((event) => event.type === 'StyleProfileUpdated');
    expect(audits).toHaveLength(1);
    const audit = audits[0];
    if (audit === undefined) throw new Error('期望审计事件');
    expect(audit.taskRef).toBe('w_1');
    expect(audit.chapterIndex).toBe(1);
    const payload = audit.payload as { alphaUsed?: number; sampleCount?: number };
    expect(payload.alphaUsed).toBe(0.05);
    expect(payload.sampleCount).toBeGreaterThanOrEqual(10);
  });

  it('无 author 编辑窗口：noEdits=true，零写盘零审计事件', async () => {
    const { root, bus, engine } = hermeticBook();
    await engine.execute('chapter_draft', {}, {
      parentTaskRef: 'w_none',
      chapterIndex: 2,
      eventPayload: { recipeSnapshot: { recipe: { recipeVersion: 'v1' } } },
    });
    const before = readStyleProfiles(root);
    const outcome = runStyleLearnerForWindow({ bus, bookRoot: root, taskRef: 'w_none', chapterIndex: 2 });
    expect(outcome.noEdits).toBe(true);
    expect(outcome.observations).toBe(0);
    const after = readStyleProfiles(root);
    expect(after.action.revision).toBe(before.action.revision);
    const ledger = readPipelineLedger(root);
    expect(ledger.filter((row) => row.kind === 'task' && row.event.type === 'StyleProfileUpdated')).toHaveLength(0);
  });

  it('assistant 通道编辑被过滤（不算人偏好信号）', async () => {
    const { root, bus, engine } = hermeticBook();
    await engine.execute('chapter_draft', {}, {
      parentTaskRef: 'w_asst',
      chapterIndex: 1,
      eventPayload: { recipeSnapshot: { recipe: { recipeVersion: 'v1' } } },
    });
    recordUserEdit({
      bus,
      bookRoot: root,
      taskRef: 'w_asst',
      chapterIndex: 1,
      level: 'selection',
      source: 'assistant',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '“AI 写的。”' }],
    });
    const outcome = runStyleLearnerForWindow({ bus, bookRoot: root, taskRef: 'w_asst', chapterIndex: 1 });
    expect(outcome.noEdits).toBe(true);
  });

  it('delete 调用方传 removedText 被守卫拒绝（t52:B2 发布侧克隆纪律）', () => {
    const { root, bus } = hermeticBook();
    expect(() =>
      recordUserEdit({
        bus,
        bookRoot: root,
        taskRef: 'w_del',
        chapterIndex: 1,
        level: 'selection',
        source: 'author',
        blocks: [{ op: 'delete', paragraphStart: 1, paragraphEnd: 1, removedText: '越权携带' }],
      }),
    ).toThrow();
    // 守卫后的 taboo 侧账不为任何窗口建立（没有合法 delete 观测）
    expect(() => loadTabooCandidateState(root)).not.toThrow();
  });
});
