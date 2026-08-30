/**
 * T17 验收测试（#41）：Review 步——draft 产物可被机械核检入口消费。
 * 门禁本体归 T18，本票只测消费入口的确定性读取与相位守卫。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import type { CapabilityRecipe } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import {
  ChapterPhaseError,
  LocalDataPlane,
  createBook,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import { defaultPlatformRules, hashProse, isQualityReviewCurrent } from '@mozhou/quality-engine';
import type { QualityPolicy } from '@mozhou/quality-engine';
import { loadDraftForReview, makeDraftProviderBinding, recordUserEdit, runDraftStep, runReviewStep } from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const PACKET: ContextPacket = {
  taskType: 'CHAPTER_DRAFTING',
  chapterIndex: 7,
  structural: [],
  settings: [],
  story: { text: '', tokens: 0, trimType: 'none' },
  text: '装配完成的生成输入',
  totalTokens: 9,
};

const RECIPE: CapabilityRecipe = {
  id: 'chapter-drafting',
  recipeVersion: '0.1.0',
  source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: '夹具' },
  brief: { capability: '正文草稿流式生成', runtimeSemantics: '断流 partial 半稿保留', triggers: ['draft'] },
  taskType: 'CHAPTER_DRAFTING',
  entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
  references: [],
  artifacts: [
    {
      path: '正文/第一卷/第0007章.md',
      granularity: 'chapter',
      createdPhase: 'draft',
      readTiming: 'immediately',
      sizeBudget: { target: 100, max: 200 },
      failure: { policy: 'repair', repairAction: '重生成' },
    },
  ],
  prechecks: [],
  trackingGate: {
    authorityState: '正文/第一卷/第0007章.md',
    casField: 'revision',
    transactionModes: ['append'],
    derivedViews: [],
    budgets: { hotContextBytes: 1024, perChapterReads: [] },
    failureTaxonomy: 'validationFailed',
    hookPoint: 'postWrite',
  },
  contextBudget: { hotContextBytes: 1024, fixedSections: [], perChapterReads: [] },
};

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-review-'));
  roots.push(dir);
  createBook({ dir, title: '核检之书' });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 3, title: '第三章' });
  return dir;
}

function draftEngine(root: string, chunks: readonly string[]): RuntimeEngine {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_review' });
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'deepseek',
    providerVersion: '1.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  });
  async function* stream() {
    // 显式微任务边界：真实流每个 delta 都跨异步边界到达
    await Promise.resolve();
    for (const chunk of chunks) yield chunk;
  }
  engine.registerProviderBinding(
    'deepseek',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex: 3, provider: 'deepseek', mode: 'generate', stream: () => stream() }),
  );
  return engine;
}

describe('Review 步：draft 产物可被机械核检入口消费', () => {
  it('读 draft 正文为确定性输入记录（身份/相位/字数）', async () => {
    const root = hermeticBook();
    const outcome = await runDraftStep({
      engine: draftEngine(root, ['第一段。\n', '第二段。']),
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });

    const input = loadDraftForReview(root, 3);
    expect(input.phase).toBe('draft');
    expect(input.chapterIndex).toBe(3);
    expect(input.mozhouId).toBe(readProseChapterId(root));
    expect(input.body).toBe(outcome.text); // Draft 步产物与核检入口逐字节一致
    expect(input.charCount).toBe(outcome.text.length);
    expect(input.proseRelPath).toContain('第0003章.md');
  });

  it('committed 章不是 Review 输入（ChapterPhaseError 宁败不猜）', () => {
    const root = hermeticBook();
    const plane = LocalDataPlane.open(root);
    plane.commitChapter({ chapterIndex: 3, summary: '相位翻转夹具' });
    expect(() => loadDraftForReview(root, 3)).toThrowError(ChapterPhaseError);
  });
});

function readProseChapterId(root: string): string {
  // 章一体两面：正文 frontmatter mozhouId 即章大纲节点 id
  const scan = loadDraftForReview(root, 3);
  return scan.mozhouId;
}

/* -------------------------------------------------------------------------
 * ADR-0025（质量门集成）：runReviewStep——版本绑定审查报告与 stale 判定
 * ------------------------------------------------------------------------- */

const REVIEWER = { providerId: 'deepseek', model: 'deepseek-chat', recipeVersion: '0.1.0' };

/** 只含确定性规则的策略：语义规则默认启用会让无提供方的审查变 refused。 */
function deterministicOnlyPolicy(): QualityPolicy {
  return {
    schemaVersion: 1,
    projectId: '核检之书',
    rules: defaultPlatformRules().filter((r) => r.kind === 'deterministic'),
    maxAutomaticReworks: 2,
  };
}

describe('ADR-0025 runReviewStep：版本绑定审查报告', () => {
  it('产出报告并落盘 .mozhou/quality-reviews/（锚定哈希=精确待审正文 SHA-256）', async () => {
    const root = hermeticBook();
    await runDraftStep({
      engine: draftEngine(root, ['陈缺推门进来，把伞收了靠在墙边。']),
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });

    const outcome = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_1',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });

    expect(outcome.report.verdict).toBe('pass');
    expect(outcome.report.anchor.receiptId).toBe('rcpt_t25_1');
    expect(outcome.report.anchor.draftContentHash).toBe(hashProse(outcome.input.body));
    expect(outcome.report.anchor.draftRevision).toBe(outcome.input.revision);

    // 报告持久化于 .mozhou/quality-reviews/chapter_3/（非 Canon 审计证据）
    const dir = join(root, '.mozhou', 'quality-reviews', 'chapter_3');
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const persisted = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8'));
    expect(persisted.reportId).toBe(outcome.report.reportId);
    expect(persisted.verdict).toBe('pass');
    expect(outcome.reportRelPath).toContain('chapter_3');
  });

  it('段落瀑布正文 → blocking_fail（PARA-001 机械证据）', async () => {
    const root = hermeticBook();
    await runDraftStep({
      engine: draftEngine(root, ['他抬头。\n', '\n门开了。\n', '\n风进来了。\n', '\n陈缺没有动。']),
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });

    const outcome = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_2',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });
    expect(outcome.report.verdict).toBe('blocking_fail');
    const para = outcome.report.evaluations.find((e) => e.ruleId === 'PARA-001');
    expect(para?.verdict).toBe('fail');
    expect(para?.evidence.length).toBeGreaterThan(0);
  });

  it('审查后正文经既有编辑路径再改 → 旧 PASS 立即 stale（fail closed）', async () => {
    const root = hermeticBook();
    const bus = new PublishBus();
    await runDraftStep({
      engine: draftEngine(root, ['陈缺推门进来，把伞收了靠在墙边。\n', '\n窗外雨还在下。']),
      bookRoot: root,
      chapterIndex: 3,
      packet: PACKET,
      recipe: RECIPE,
    });

    const first = await runReviewStep({
      bookRoot: root,
      chapterIndex: 3,
      receiptId: 'rcpt_t25_3',
      reviewer: REVIEWER,
      policy: deterministicOnlyPolicy(),
    });
    expect(first.report.verdict).toBe('pass');

    // 既有 draft 编辑路径（User Edit 步同款）：revision+1、正文变化、基线刷新
    const edit = recordUserEdit({
      bus,
      bookRoot: root,
      taskRef: 'tsk_review_mutation',
      chapterIndex: 3,
      level: 'selection',
      source: 'author',
      blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者润色后的正文，与审查时逐字节不同。' }],
    });

    const scan = readProseChapter(root, proseChapterPath(3));
    expect(isQualityReviewCurrent(first.report, {
      draftRevision: edit.revisionAfter,
      draftContentHash: hashProse(scan.body),
    })).toBe(false);
  });
});
