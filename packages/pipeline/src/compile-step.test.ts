/**
 * T16 验收测试（#40）：Compile 衔接——
 * stale 警告继续 + Receipt 留痕（对账软门禁先例）/ CHAPTER_DRAFTING 档行 /
 * Compile 后按 receiptId 续跑（INV-R1/R2）。
 * 全程 hermetic：临时书目录 + 注入凭证 id/时钟/固定 taskRef；stale 标记走
 * 真实传播链（commitChapter 钉版 → propagateStaleMarkers 命中）。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitChapter,
  createBook,
  createChapterDraft,
  createEntityCard,
  openDatabase,
  parseFrontmatter,
  propagateStaleMarkers,
  readManifest,
  readNarrativeSnapshot,
  scanEntityCards,
  type PlaneContext,
} from '@mozhou/data-plane';
import { DEFAULT_BUDGET_ASSEMBLY_CONFIG, loadReceipt, type ExactTokenizer } from '@mozhou/context-compiler';
import { PublishBus } from '@mozhou/runtime';
import type { BookId, ContextReceiptId, EntityRef } from '@mozhou/kernel';
import {
  ChapterProductionSession,
  STALE_WARNING_SECTION,
  loadReceiptForResume,
  prepareChapterInputs,
  projectSession,
  readPipelineLedger,
  runCompileStep,
} from './index.js';

const NOW = '2026-08-24T15:00:00.000Z';
const LIN = 'char:lin-xuan' as EntityRef;
const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length };
const RECEIPT_ID = `rcpt_${'7'.repeat(26)}` as unknown as ContextReceiptId;

function bookIdOf(root: string): BookId {
  return (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: `book_${string}` }).id as BookId;
}

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

interface Fixture {
  readonly root: string;
  readonly ctx: PlaneContext;
}
function makeBookWithStaleChapter(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t16-compile-'));
  roots.push(root);
  createBook({ dir: root, title: '听雨剑歌' });
  const ctx: PlaneContext = { root, db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(root) };

  createEntityCard(ctx, LIN, {
    name: '林枫',
    aiContext: 'detected',
    aliases: [{ text: '枫儿', kind: 'exact' }],
    brief: '青云宗外门弟子佩剑听雨',
  });

  // 第 1 章提交并钉版总纲节点 ⇒ 上游大纲变更经真实传播链把第 1 章标 stale
  createChapterDraft(ctx, { chapterIndex: 1, title: '夜行' });
  const zonggang = parseFrontmatter(readFileSync(join(root, '大纲/总纲.md'), 'utf8'));
  const zonggangId = zonggang.data['mozhouId'] as string;
  commitChapter(ctx, {
    chapterIndex: 1,
    summary: '林枫夜行初遇',
    dependencyManifest: { entries: [{ kind: 'outlineNode', id: zonggangId, revision: 0 }] },
  });
  const propagation = propagateStaleMarkers(ctx, {
    reason: 'upstream_outline_changed',
    upstreamChanges: [{ kind: 'outlineNode', id: zonggangId, revision: 1 }],
    markedAt: NOW,
  });
  expect(propagation.markedChapters).toEqual([1]);
  return { root, ctx };
}

describe('CHAPTER_DRAFTING 档（#8 tier 表受控增补行）', () => {
  it('配额行在册且与 chapter_writing 同族（正文保底 0.4）', () => {
    expect(DEFAULT_BUDGET_ASSEMBLY_CONFIG.quotaRatioByTask['CHAPTER_DRAFTING']).toBe(0.4);
  });
});

describe('stale 警告继续 + Receipt 留痕', () => {
  it('目标章带 StaleMarker：编译不被阻塞，警告以结构层段留进 Receipt 全链', async () => {
    const { root, ctx } = makeBookWithStaleChapter();
    try {
      const bus = new PublishBus();
      const session = ChapterProductionSession.start({ bus, root, chapterIndex: 1, newTaskRef: () => 'tsk_t16_c' });
      const prepared = prepareChapterInputs(root, 1);
      expect(prepared.staleMarker).not.toBeNull();

      session.advance('compile');
      const outcome = await runCompileStep(prepared, {
        bookRoot: root,
        bookId: bookIdOf(root),
        draftText: '枫儿踏入山门。',
        cards: scanEntityCards(root),
        snapshot: readNarrativeSnapshot(root),
        scope: { chapterIndex: 1, pov: 'protagonist' },
        structuralSections: [{ section: 'author_intent', content: '写一部修仙长卷' }],
        modelProfile: { id: 't16-model', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: RECEIPT_ID,
        nowIso: NOW,
      });

      // 警告继续：编译成功而非被 stale 硬阻塞
      expect(outcome.staleWarnings).toHaveLength(1);
      expect(outcome.staleWarnings[0]!.reason).toBe('upstream_outline_changed');

      // Receipt 留痕：结构层段进 packet、entries（structural 收口）与一证一文件
      const warningPiece = outcome.packet.structural.find((piece) => piece.section === STALE_WARNING_SECTION);
      expect(warningPiece).toBeDefined();
      expect(warningPiece!.text).toContain('reason=upstream_outline_changed');
      expect(warningPiece!.text).toContain('markedAt=' + NOW);
      const warningEntry = outcome.receipt.entries.find((entry) => entry.identifier === STALE_WARNING_SECTION);
      expect(warningEntry?.included).toBe(true);
      expect(warningEntry?.stage).toBe('structural');
      expect(loadReceipt(root, RECEIPT_ID)).toEqual(outcome.receipt);
      expect(outcome.receipt.taskType).toBe('CHAPTER_DRAFTING');
      expect(outcome.receipt.chapterIndex).toBe(1);

      // 指针事件已落账本（平铺领域行），投影窗口内可见
      const projection = projectSession(readPipelineLedger(root), 1);
      expect(projection.currentStep).toBe('compile');
      expect(projection.lastReceiptId).toBe(RECEIPT_ID);
      void ctx;
    } finally {
      ctx.db.close();
    }
  });

  it('无标记章零警告零留痕段（不引入无证据噪声）', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-t16-clean-'));
    roots.push(root);
    createBook({ dir: root, title: '听雨剑歌' });
    const ctx: PlaneContext = { root, db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(root) };
    try {
      createEntityCard(ctx, LIN, { name: '林枫', aiContext: 'detected', aliases: [{ text: '枫儿', kind: 'exact' }], brief: '外门弟子' });
      createChapterDraft(ctx, { chapterIndex: 2, title: '山门' });

      const prepared = prepareChapterInputs(root, 2);
      expect(prepared.staleMarker).toBeNull();

      const outcome = await runCompileStep(prepared, {
        bookRoot: root,
        bookId: bookIdOf(root),
        draftText: '枫儿练剑。',
        cards: scanEntityCards(root),
        snapshot: readNarrativeSnapshot(root),
        scope: { chapterIndex: 2, pov: 'protagonist' },
        modelProfile: { id: 't16-model', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: RECEIPT_ID,
        nowIso: NOW,
      });
      expect(outcome.staleWarnings).toEqual([]);
      expect(outcome.packet.structural.some((piece) => piece.section === STALE_WARNING_SECTION)).toBe(false);
    } finally {
      ctx.db.close();
    }
  });
});

describe('Compile 后按 receiptId 续跑（INV-R1/R2）', () => {
  it('崩溃后恢复：指针在即凭证在，loadReceipt 取回产物不重编译，步光标续走', async () => {
    const { root, ctx } = makeBookWithStaleChapter();
    try {
      const deps = { bus: new PublishBus(), root, chapterIndex: 1, newTaskRef: () => 'tsk_t16_r' };
      const first = ChapterProductionSession.start(deps);
      first.advance('compile');
      await runCompileStep(prepareChapterInputs(root, 1), {
        bookRoot: root,
        bookId: bookIdOf(root),
        draftText: '枫儿踏入山门。',
        cards: scanEntityCards(root),
        snapshot: readNarrativeSnapshot(root),
        scope: { chapterIndex: 1, pov: 'protagonist' },
        modelProfile: { id: 't16-model', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: RECEIPT_ID,
        nowIso: NOW,
      });

      // —— 崩溃：丢弃内存态 ——
      const resumed = ChapterProductionSession.resume(deps);
      expect(resumed).not.toBeNull();
      expect(resumed!.taskRef).toBe('tsk_t16_r');
      expect(resumed!.currentStep).toBe('compile');

      // 恢复凭据：投影携带 receiptId，盘上凭证取回且逐字段一致（INV-R2 不可变）
      const projection = resumed!.project();
      expect(projection.lastReceiptId).toBe(RECEIPT_ID);
      const artifact = loadReceiptForResume(root, projection.lastReceiptId!);
      expect(artifact).toEqual(loadReceipt(root, RECEIPT_ID));

      // 续跑：步光标从 compile 继续后继序（平铺指针行不再阻断任务事件写入）
      resumed!.advance('draft');
      const afterAdvance = ChapterProductionSession.resume(deps);
      expect(afterAdvance!.currentStep).toBe('draft');
    } finally {
      ctx.db.close();
    }
  });
});
