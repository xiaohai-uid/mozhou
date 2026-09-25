/**
 * T16 验收测试（#40）：Compile 衔接——
 * stale 警告继续 + Receipt 留痕（对账软门禁先例）/ CHAPTER_DRAFTING 档行 /
 * Compile 后按 receiptId 续跑（INV-R1/R2）。
 * D06（change-impact-engine-spec §2）：编译入包实体钉版产出 → 暂存 → 提交钉版 →
 * findReaders 圈定（依赖图生产侧数据源，含「无钉版即无读者」的诚实负例）。
 * 全程 hermetic：临时书目录 + 注入凭证 id/时钟/固定 taskRef；stale 标记走
 * 真实传播链（commitChapter 钉版 → propagateStaleMarkers 命中）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitChapter,
  createBook,
  createChapterDraft,
  createEntityCard,
  findReaders,
  openDatabase,
  parseFrontmatter,
  propagateStaleMarkers,
  readChapterDependencyPins,
  readManifest,
  readNarrativeSnapshot,
  scanEntityCards,
  type PlaneContext,
} from '@mozhou/data-plane';
import { DEFAULT_BUDGET_ASSEMBLY_CONFIG, loadReceipt, type ExactTokenizer } from '@mozhou/context-compiler';
import { PublishBus } from '@mozhou/runtime';
import { DependencyManifestError, newFactId } from '@mozhou/kernel';
import type { BookId, ContextReceipt, ContextReceiptId, EntityRef, FactId, ReceiptEntry } from '@mozhou/kernel';
import {
  ChapterProductionSession,
  PENDING_DEPENDENCY_MANIFEST_DIR,
  STALE_WARNING_SECTION,
  buildDependencyManifest,
  loadReceiptForResume,
  pendingDependencyManifestPath,
  persistPendingDependencyManifest,
  prepareChapterInputs,
  projectSession,
  readPendingDependencyManifest,
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
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
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

/* ---------------------------------------------------------------------------
 * D06 依赖钉版产出（change-impact-engine-spec §2 / ADR-0003 §2.1）
 * ------------------------------------------------------------------------- */

const FACT_ID = newFactId();

/** 冻结行形的事实行（沿 l1 台架 factRow；status=confirmed 才进 G0 可见子图）。 */
function confirmedFactRow(bookId: BookId, id: FactId, chapterIndex: number): Record<string, unknown> {
  return {
    id,
    bookId,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    subject: LIN,
    predicate: '境界',
    value: '练气',
    validUntil: null,
    validFrom: chapterIndex,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  };
}

/** 建书：第 1 章钉住一条 confirmed 事实，第 2 章待编译（目录卡可被 keyword 通道命中）。 */
function makeBookWithPinnedFact(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t06-pin-'));
  roots.push(root);
  createBook({ dir: root, title: '听雨剑歌' });
  const ctx: PlaneContext = { root, db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(root) };

  createEntityCard(ctx, LIN, {
    name: '林枫',
    aiContext: 'detected',
    aliases: [{ text: '枫儿', kind: 'exact' }],
    brief: '青云宗外门弟子佩剑听雨',
  });
  createChapterDraft(ctx, { chapterIndex: 1, title: '夜行' });
  commitChapter(ctx, {
    chapterIndex: 1,
    summary: '林枫初登场',
    appends: { temporalFact: [confirmedFactRow(bookIdOf(root), FACT_ID, 1)] },
  });
  createChapterDraft(ctx, { chapterIndex: 2, title: '山门' });
  return { root, ctx };
}

/** Receipt 夹具：只考条目筛选语义，其余字段取冻结形状的诚实缺省（非被测面）。 */
function receiptWith(bookId: BookId, entries: readonly ReceiptEntry[]): ContextReceipt {
  return {
    id: RECEIPT_ID,
    bookId,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    taskType: 'CHAPTER_DRAFTING',
    chapterIndex: 2,
    entries,
    parseFailures: [],
    storyTextQuota: { reservedTokens: 0, actualTokens: 0 },
    totalTokens: 0,
    assembledBy: 'server',
    replayInputs: {
      configVersion: 'fixture-v1',
      tokenizerVersion: charTok.version,
      modelProfileId: 't06-model',
      contextWindowTokens: 4096,
      candidates: [],
      structuralSections: [],
      storyTextSlices: [],
    },
    inputsDigest: 'fixture',
    recomputationHash: 'fixture',
  };
}

describe('D06 依赖钉版产出（编译 → 暂存 → 提交钉版 → findReaders 圈定）', () => {
  it('入包实体按编译时 revision 钉版：暂存可回读，提交后事件行载清单，上游变更圈定该章', async () => {
    const { root, ctx } = makeBookWithPinnedFact();
    try {
      const outcome = await runCompileStep(prepareChapterInputs(root, 2), {
        bookRoot: root,
        bookId: bookIdOf(root),
        draftText: '枫儿踏入山门。',
        cards: scanEntityCards(root),
        snapshot: readNarrativeSnapshot(root),
        scope: { chapterIndex: 2, pov: 'protagonist' },
        modelProfile: { id: 't06-model', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId: RECEIPT_ID,
        nowIso: NOW,
      });

      // 产出：入包事实（keyword 触发卡的自身事实）按编译时读到的 revision 钉版
      expect(outcome.dependencyManifest.entries).toEqual([{ kind: 'temporalFact', id: FACT_ID, revision: 0 }]);

      // 暂存：跨「生成 → 提交」两请求的唯一载体，回读逐字段一致
      expect(readPendingDependencyManifest(root, 2)).toEqual(outcome.dependencyManifest);

      // 消费：提交方回读并原样钉进 ChapterCommitted 事件行（第 2 行 = 第 2 章）
      const pinned = readPendingDependencyManifest(root, 2);
      expect(pinned).not.toBeNull();
      commitChapter(ctx, { chapterIndex: 2, summary: '定稿', dependencyManifest: pinned! });
      const committed = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((row) => row['type'] === 'ChapterCommitted');
      expect(committed).toHaveLength(2);
      expect(committed[1]!['dependencyManifest']).toEqual({ entries: [{ kind: 'temporalFact', id: FACT_ID, revision: 0 }] });

      // 圈定：钉版命中即读者（revision 不敏感）——findReaders 不再是空集，传播把该章标 stale
      const pins = readChapterDependencyPins(root);
      expect(findReaders(pins, { kind: 'temporalFact', id: FACT_ID, revision: 1 })).toEqual([2]);
      const propagation = propagateStaleMarkers(ctx, {
        reason: 'upstream_canon_changed',
        upstreamChanges: [{ kind: 'temporalFact', id: FACT_ID, revision: 1 }],
        markedAt: NOW,
      });
      expect(propagation.markedChapters).toEqual([2]);
    } finally {
      ctx.db.close();
    }
  });

  it('无编译钉版的章提交不带清单：pins 无该章、findReaders 空集（诚实反映「无依赖」而非假数据）', () => {
    const { root, ctx } = makeBookWithPinnedFact();
    try {
      // 第 1 章未带 dependencyManifest 提交（= 生成侧未产出钉版）
      commitChapter(ctx, { chapterIndex: 2, summary: '手写定稿' });
      const pins = readChapterDependencyPins(root);
      expect(pins.has(2)).toBe(false);
      expect(findReaders(pins, { kind: 'temporalFact', id: FACT_ID, revision: 0 })).toEqual([]);
    } finally {
      ctx.db.close();
    }
  });

  it('只钉真正入包的版本化实体：预算出局/召回透传/结构段/目录卡不入清单，同 id 收敛一条', () => {
    const { root, ctx } = makeBookWithPinnedFact();
    try {
      const snapshot = readNarrativeSnapshot(root);
      const entry = (over: Pick<ReceiptEntry, 'stage' | 'identifier'> & Partial<ReceiptEntry>): ReceiptEntry => ({
        order: 0,
        included: true,
        ...over,
      });
      const manifest = buildDependencyManifest(
        receiptWith(bookIdOf(root), [
          entry({ stage: 'reserve', identifier: FACT_ID, assemblySource: 'graph_khop' }),
          entry({ stage: 'converge', identifier: FACT_ID, assemblySource: 'graph_khop' }), // 同 id 收敛一条
          entry({ stage: 'reserve', identifier: LIN, assemblySource: 'keyword' }), // 目录卡：非内核版本化实体
          entry({ stage: 'converge', identifier: FACT_ID, included: false, exclusionReason: 'budget_exhausted' }),
          entry({ stage: 'recall_filter', identifier: FACT_ID, included: false, exclusionReason: 'pov_filtered' }),
          entry({ stage: 'structural', identifier: 'book_identity', assemblySource: 'structural' }),
          entry({ stage: 'story_text', identifier: 'story_text' }),
        ]),
        snapshot,
      );
      expect(manifest.entries).toEqual([{ kind: 'temporalFact', id: FACT_ID, revision: 0 }]);
    } finally {
      ctx.db.close();
    }
  });

  it('钉版暂存失败路径显式：缺省 null；撕裂 JSON / 形状非法抛错；非法章序拒绝路径构造', () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-t06-store-'));
    roots.push(root);
    createBook({ dir: root, title: '钉版暂存之书' });

    expect(readPendingDependencyManifest(root, 3)).toBeNull(); // 未经编译 ⇒ 无钉版
    expect(() => pendingDependencyManifestPath(0)).toThrow(/positive integer/);

    mkdirSync(join(root, PENDING_DEPENDENCY_MANIFEST_DIR), { recursive: true });
    const path = join(root, pendingDependencyManifestPath(3));
    writeFileSync(path, '{"entries":[{"kind":'); // 撕裂 JSON（崩溃窗口产物）
    expect(() => readPendingDependencyManifest(root, 3)).toThrow(SyntaxError);
    writeFileSync(path, JSON.stringify({ entries: [{ kind: 'bogus', id: 'x', revision: 0 }] }));
    expect(() => readPendingDependencyManifest(root, 3)).toThrow(DependencyManifestError);
    writeFileSync(path, JSON.stringify({ entries: [{ kind: 'temporalFact', id: FACT_ID, revision: -1 }] }));
    expect(() => readPendingDependencyManifest(root, 3)).toThrow(DependencyManifestError);
    writeFileSync(path, JSON.stringify([{ kind: 'temporalFact', id: FACT_ID, revision: 0 }])); // 非 {entries} 形状
    expect(() => readPendingDependencyManifest(root, 3)).toThrow(DependencyManifestError);

    // 合法形状经同一渲染路径落盘后逐字段回读一致
    persistPendingDependencyManifest(root, 3, { entries: [{ kind: 'temporalFact', id: FACT_ID, revision: 2 }] });
    expect(readPendingDependencyManifest(root, 3)).toEqual({ entries: [{ kind: 'temporalFact', id: FACT_ID, revision: 2 }] });
  });
});
