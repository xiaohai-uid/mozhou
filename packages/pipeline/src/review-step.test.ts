/**
 * T17 验收测试（#41）：Review 步——draft 产物可被机械核检入口消费。
 * 门禁本体归 T18，本票只测消费入口的确定性读取与相位守卫。零时钟零外部服务。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, RuntimeEngine } from '@mozhou/runtime';
import type { CapabilityRecipe } from '@mozhou/runtime';
import type { ContextPacket } from '@mozhou/context-compiler';
import {
  ChapterPhaseError,
  LocalDataPlane,
  createBook,
} from '@mozhou/data-plane';
import { loadDraftForReview, makeDraftProviderBinding, runDraftStep } from './index.js';

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
