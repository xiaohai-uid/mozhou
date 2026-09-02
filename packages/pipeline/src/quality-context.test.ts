/**
 * ADR-0025（质量门集成）验收测试：有界质量切片进写作上下文——
 * prepare 携带切片 → 既有结构段通道（quality_memory）→ Receipt 按段记账。
 * 预算保全：不新增无限 prompt 频道，token 计入既有 ExactTokenizer 口径；
 * 零时钟零外部服务，hermetic 临时书。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBook,
  createEntityCard,
  LocalDataPlane,
  openDatabase,
  readManifest,
  readNarrativeSnapshot,
  scanEntityCards,
} from '@mozhou/data-plane';
import type { BookId, ContextReceiptId, EntityRef } from '@mozhou/kernel';
import type { ExactTokenizer } from '@mozhou/context-compiler';
import {
  FAILURE_MEMORY_PATH,
  MEMORY_ANCHORS_PATH,
  QUALITY_SECTION,
  READER_EXPERIENCE_PATH,
  prepareChapterInputs,
  qualityStructuralSections,
  runCompileStep,
} from './index.js';

const LIN = 'char:lin-xuan' as EntityRef;
const RECEIPT_ID = `rcpt_${'8'.repeat(26)}` as unknown as ContextReceiptId;
const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length };

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

function hermeticBook(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t25-quality-ctx-'));
  roots.push(root);
  createBook({ dir: root, title: '质量切片之书' });
  LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 2, title: '第二章' });
  LocalDataPlane.open(root).createChapterDraft({ chapterIndex: 3, title: '第三章' });
  return root;
}

function bookIdOf(root: string): BookId {
  return (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: `book_${string}` }).id as BookId;
}

describe('有界质量切片进写作上下文', () => {
  it('质量文件缺席 = 空切片，不出结构段（零噪声）', () => {
    const root = hermeticBook();
    const prepared = prepareChapterInputs(root, 2);
    expect(prepared.qualitySlice).toEqual({
      readerExperience: [],
      activeFailurePatterns: [],
      memoryAnchors: [],
    });
    expect(qualityStructuralSections(prepared.qualitySlice)).toEqual([]);
  });

  it('近窗诊断/失败记忆/锚点按有界选择入段', () => {
    const root = hermeticBook();
    const qualityDir = join(root, '质量');
    mkdirSync(qualityDir, { recursive: true });
    writeFileSync(
      join(root, ...READER_EXPERIENCE_PATH),
      [
        JSON.stringify({ chapterIndex: 1, pressureDelta: 1, expectationDelta: 2, tangibleGain: 'resource', payoff: 'advanced', solutionPattern: 'borrow_knife' }),
        JSON.stringify({ chapterIndex: 2, pressureDelta: 2, expectationDelta: 1, tangibleGain: 'power', payoff: 'partial', solutionPattern: 'borrow_knife' }),
      ].join('\n') + '\n',
      'utf8',
    );
    writeFileSync(
      join(root, ...MEMORY_ANCHORS_PATH),
      JSON.stringify({ anchorId: 'anc_xiu', type: 'object', description: '那柄断了的绣春刀', plantedChapter: 1, lastEchoChapter: null, status: 'planted' }) + '\n',
      'utf8',
    );
    writeFileSync(
      join(root, ...FAILURE_MEMORY_PATH),
      JSON.stringify({ code: 'outline_expansion', firstSeenChapter: 1, lastSeenChapter: 1, occurrences: 1, active: true, authorNote: '别把大纲当正文' }) + '\n' +
      JSON.stringify({ code: 'style_drift', firstSeenChapter: 1, lastSeenChapter: 2, occurrences: 2, active: false }) + '\n',
      'utf8',
    );

    const prepared = prepareChapterInputs(root, 3);
    expect(prepared.qualitySlice.readerExperience.map((d) => d.chapterIndex)).toEqual([2, 1]);
    expect(prepared.qualitySlice.activeFailurePatterns.map((p) => p.code)).toEqual(['outline_expansion']);
    expect(prepared.qualitySlice.memoryAnchors.map((a) => a.anchorId)).toEqual(['anc_xiu']);

    const sections = qualityStructuralSections(prepared.qualitySlice);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.section).toBe(QUALITY_SECTION);
    expect(sections[0]!.content).toContain('delta ch2');
    expect(sections[0]!.content).toContain('failure outline_expansion');
    expect(sections[0]!.content).toContain('anchor anc_xiu');
    // 失效（active=false）的模式不入上下文
    expect(sections[0]!.content).not.toContain('style_drift');
  });

  it('预算保全：quality_memory 段进 Receipt entries，token 走既有 tokenizer 口径', async () => {
    const root = hermeticBook();
    const ctx = { root, db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(root) };
    createEntityCard(ctx, LIN, {
      name: '林枫',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }],
      brief: '青云宗外门弟子佩剑听雨',
    });
    mkdirSync(join(root, '质量'), { recursive: true });
    writeFileSync(
      join(root, ...MEMORY_ANCHORS_PATH),
      JSON.stringify({ anchorId: 'anc_a', type: 'theme', description: '以债还债', plantedChapter: 1, lastEchoChapter: null, status: 'planted' }) + '\n',
      'utf8',
    );
    const prepared = prepareChapterInputs(root, 2);
    const sections = qualityStructuralSections(prepared.qualitySlice);
    expect(sections).toHaveLength(1);

    const outcome = await runCompileStep(
      { chapterIndex: prepared.chapterIndex, staleMarker: prepared.staleMarker },
      {
        bookRoot: root,
        bookId: bookIdOf(root),
        draftText: '枫儿踏入山门。',
        cards: scanEntityCards(root),
        snapshot: readNarrativeSnapshot(root),
        scope: { chapterIndex: 2, pov: 'protagonist' },
        structuralSections: sections,
        modelProfile: { id: 't25-model', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: RECEIPT_ID,
      },
    );

    // 既有 Receipt 记账口径：结构段进 entries（identifier 对齐），token 与
    // 既有 ExactTokenizer 对段最终文本的计数一致（未绕过预算会计）
    const entry = outcome.receipt.entries.find((item) => item.identifier === QUALITY_SECTION);
    expect(entry).toBeDefined();
    const piece = outcome.packet.structural.find((item) => item.section === QUALITY_SECTION);
    expect(piece).toBeDefined();
    expect(entry!.tokens).toBe(charTok.count(piece!.text));
    expect(entry!.tokens).toBeGreaterThanOrEqual(sections[0]!.content.length);
  });
});
