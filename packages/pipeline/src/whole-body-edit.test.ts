/**
 * 整文保存路径的编辑信号（web /api/chapter.prose.save 接线 · 步 5 User Edit）。
 *
 * 被测行为：作者写作层提交一整篇正文（非结构化块）→ 行级 diff 推导结构化操作块 →
 * 落与 recordUserEdit **同形**的 UserEditRecorded。核心不变量：
 *   - 推导块应用回基线必须逐字节复现本次正文（含尾空行编码口径）——否则宁败不脏；
 *   - 未改动的中间正文不得被吞进块载荷（信号质量：不得把未编辑文本算成作者新增）；
 *   - 作者原样重存（零文本变更）不落事件（零噪声）；
 *   - 发布失败必须抛到调用方（路由按 S12 降级上报，绝不静默吞掉）。
 * 零时钟零外部服务，hermetic 临时书。
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus } from '@mozhou/runtime';
import type { DomainEvent } from '@mozhou/kernel';
import { RUNTIME_EVENTS_PATH, createBook } from '@mozhou/data-plane';
import {
  applyEditBlocks,
  readPipelineLedger,
  recordWholeBodyAuthorEdit,
} from './index.js';
import type { EditOperationBlock, RecordWholeBodyAuthorEditRequest } from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-whole-body-edit-'));
  roots.push(dir);
  createBook({ dir, title: '整文保存之书' });
  return dir;
}

/** 与实现同款的正文归一（非空恒以 '\n' 收尾）——断言口径与被测口径必须一致。 */
function normalize(body: string): string {
  if (body === '') return '';
  return body.endsWith('\n') ? body : `${body}\n`;
}

function request(root: string, beforeBody: string, afterBody: string, revision = 7): RecordWholeBodyAuthorEditRequest {
  return {
    bus: new PublishBus(),
    bookRoot: root,
    taskRef: 'web_commit_ch1_rev' + revision,
    chapterIndex: 1,
    beforeBody,
    afterBody,
    revision,
  };
}

/** 账本 task 行（PublishBus 格式 {seq, event}）直写：用于构造窗口边界/坏块场景。 */
function appendTaskRow(root: string, event: Record<string, unknown>): void {
  const rows = readPipelineLedger(root);
  appendFileSync(
    join(root, RUNTIME_EVENTS_PATH),
    `${JSON.stringify({ seq: rows.length + 1, event })}\n`,
  );
}

/** 账本平铺领域行直写（形状同 commitChapter/reopenChapter：chapter.ts:626-638 / :737-747）。 */
function appendFlatRow(root: string, row: Record<string, unknown>): void {
  appendFileSync(join(root, RUNTIME_EVENTS_PATH), `${JSON.stringify(row)}\n`);
}

function authorEditEvents(root: string): DomainEvent[] {
  return readPipelineLedger(root)
    .filter((row) => row.kind === 'task')
    .map((row) => row.event)
    .filter((event) => event.type === 'UserEditRecorded');
}

/**
 * 调用方侧块形：发布侧克隆块盖的 removedText 是**步内产出**（t52:B2），
 * validateBlock 镜像守卫拒调用方携带——复算不变量前必须剥掉盖章（同 recordUserEdit
 * 的请求侧/发布侧两形纪律）。
 */
function callerSide(blocks: readonly EditOperationBlock[]): EditOperationBlock[] {
  return blocks.map((block) => ({
    op: block.op,
    paragraphStart: block.paragraphStart,
    paragraphEnd: block.paragraphEnd,
    ...(block.replacementText === undefined ? {} : { replacementText: block.replacementText }),
  }));
}

interface DiffCase {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** 期望块（op + 行区间）；缺省 = 只验不变量，不锁块形状。 */
  readonly expected?: readonly { op: string; start: number; end: number }[];
  /** 未改动正文片段：不得出现在任何块的载荷里（信号质量红线）。 */
  readonly untouched?: readonly string[];
}

const DIFF_CASES: readonly DiffCase[] = [
  { label: '新建章：整篇为一次插入（占位标题不算作者删除）', before: '', after: '第一行\n第二行\n', expected: [{ op: 'insert', start: 1, end: 1 }] },
  { label: '单行改写 → 单个 replace', before: 'A\nB\nC\nD\nE\n', after: 'A\nB\nC2\nD\nE\n', expected: [{ op: 'replace', start: 3, end: 3 }] },
  {
    label: '首尾各改一处 → 两个块，中间未改动正文不进载荷',
    before: 'A\nB\nC\nD\nE\n',
    after: 'A2\nB\nC\nD\nE2\n',
    expected: [{ op: 'replace', start: 1, end: 1 }, { op: 'replace', start: 5, end: 5 }],
    untouched: ['B', 'C', 'D'],
  },
  { label: '整段删除 → delete（无 replacementText）', before: 'A\nB\nC\n', after: 'A\nC\n', expected: [{ op: 'delete', start: 2, end: 2 }] },
  { label: '文末追加 → insert 于末行+1', before: 'A\nB\n', after: 'A\nB\nC\n', expected: [{ op: 'insert', start: 3, end: 3 }] },
  { label: '空行删除（空行是作者分段信号，不许静默丢失）', before: 'A\n\nB\n', after: 'A\nB\n', expected: [{ op: 'delete', start: 2, end: 2 }] },
  { label: '文末新增空行（尾空行编码口径）', before: 'A\n', after: 'A\n\n' },
  { label: '整篇重写 → 单个 replace', before: 'A\nB\nC\n', after: 'X\nY\nZ\n' },
  { label: '基线无尾换行（客户端未带）与盘面归一一致', before: 'A\nB', after: 'A\nB2' },
  { label: '仅空行正文', before: '', after: '\n\n' },
];

describe('recordWholeBodyAuthorEdit · 块推导不变量', () => {
  it.each(DIFF_CASES)('$label：块应用回基线逐字节复现本次正文', (testCase) => {
    const root = hermeticBook();
    const outcome = recordWholeBodyAuthorEdit(request(root, testCase.before, testCase.after));

    expect(outcome.published).toBe(true);
    expect(outcome.blocks.length).toBeGreaterThan(0);
    // 不变量：块是基线的可执行变换，结果逐字节等于本次保存的正文
    expect(applyEditBlocks(normalize(testCase.before), callerSide(outcome.blocks))).toBe(normalize(testCase.after));

    if (testCase.expected !== undefined) {
      expect(outcome.blocks.map((block) => ({
        op: block.op,
        start: block.paragraphStart,
        end: block.paragraphEnd,
      }))).toEqual(testCase.expected);
    }
    for (const fragment of testCase.untouched ?? []) {
      for (const block of outcome.blocks) {
        expect(block.replacementText ?? '').not.toContain(fragment);
        expect(block.removedText ?? '').not.toContain(fragment);
      }
    }
  });

  it('超大输入退化路径（单块兜底）：仍逐字节复现，只是块粒度变粗', () => {
    const root = hermeticBook();
    // 2001×2001 = 4_004_001 单元 > LINE_DIFF_MAX_CELLS(4_000_000) ⇒ 走前缀/后缀裁剪兜底
    const lines = Array.from({ length: 2000 }, (_, i) => `第${i + 1}行`);
    const before = `${lines.join('\n')}\n`;
    const after = `${[...lines.slice(0, 999), '改写的第1000行', ...lines.slice(1000)].join('\n')}\n`;

    const outcome = recordWholeBodyAuthorEdit(request(root, before, after));
    expect(outcome.published).toBe(true);
    expect(applyEditBlocks(normalize(before), callerSide(outcome.blocks))).toBe(normalize(after));
    // 兜底路径不拆多 hunk：单块 replace 覆盖差异区间（粒度变粗是有意为之）
    expect(outcome.blocks).toHaveLength(1);
    expect(outcome.blocks[0]).toMatchObject({ op: 'replace', paragraphStart: 1000, paragraphEnd: 1000 });
  });

  it('delete 块不带 replacementText、insert 块不带 removedText（块形状与步内守卫同源）', () => {
    const root = hermeticBook();
    const deletion = recordWholeBodyAuthorEdit(request(root, 'A\nB\nC\n', 'A\nC\n'));
    expect(deletion.blocks[0]).toMatchObject({ op: 'delete', paragraphStart: 2, paragraphEnd: 2, removedText: 'B' });
    expect(deletion.blocks[0]?.replacementText).toBeUndefined();

    const insertion = recordWholeBodyAuthorEdit(request(root, '', '只有一段。\n'));
    expect(insertion.blocks[0]).toMatchObject({ op: 'insert', paragraphStart: 1, paragraphEnd: 1 });
    expect(insertion.blocks[0]?.removedText).toBeUndefined();
  });

  it('replace 块由发布侧盖 removedText 全文（t52:B2 口径），调用方零触碰', () => {
    const root = hermeticBook();
    const outcome = recordWholeBodyAuthorEdit(request(root, '旧句甲。\n旧句乙。\n', '新句丙。\n旧句乙。\n'));
    expect(outcome.blocks).toHaveLength(1);
    expect(outcome.blocks[0]).toMatchObject({
      op: 'replace',
      paragraphStart: 1,
      paragraphEnd: 1,
      replacementText: '新句丙。',
      removedText: '旧句甲。',
    });
  });
});

describe('recordWholeBodyAuthorEdit · 事件落账与零噪声', () => {
  it('落账 UserEditRecorded：与 recordUserEdit 同形（action/level/source/revision/deltaStats）', () => {
    const root = hermeticBook();
    const outcome = recordWholeBodyAuthorEdit(request(root, 'A\nB\nC\nD\nE\n', 'A2\nB\nC\nD\nE2\n'));
    expect(outcome.published).toBe(true);
    expect(outcome.revision).toBe(7);

    const rows = readPipelineLedger(root).filter((row) => row.kind === 'task');
    expect(rows).toHaveLength(1);
    const event = rows[0]!.event;
    expect(event.type).toBe('UserEditRecorded');
    expect(event.taskRef).toBe('web_commit_ch1_rev7');
    expect(event.chapterIndex).toBe(1);
    expect(event.payload).toMatchObject({
      action: 'edit_blocks',
      // 整文/区间改写：'cursor' 是单点光标动作，不描述保存语义
      level: 'selection',
      source: 'author',
      revision: 7,
      deltaStats: { opsInsert: 0, opsDelete: 0, opsReplace: 2, insertedChars: 4, removedChars: 2 },
    });
    // 块载荷确实进账（消费方 style-runner/features 按 blocks 折算观测）
    const payload = event.payload as { blocks: readonly EditOperationBlock[] };
    expect(payload.blocks).toHaveLength(2);
  });

  it('本窗口首次保存即无改动：不落事件（零噪声且空块不合法）', () => {
    const root = hermeticBook();
    const outcome = recordWholeBodyAuthorEdit(request(root, '一字未改。\n', '一字未改。\n'));
    expect(outcome).toMatchObject({ published: false, blocks: [], revision: 7 });
    expect(authorEditEvents(root)).toHaveLength(0);
  });

  it('尾换行差异不算编辑（客户端未带尾换行 ⇒ 与盘面归一后一致）', () => {
    const root = hermeticBook();
    const outcome = recordWholeBodyAuthorEdit(request(root, '一字未改。\n', '一字未改。'));
    expect(outcome.published).toBe(false);
    expect(authorEditEvents(root)).toHaveLength(0);
  });

  it('发布失败必须抛到调用方（路由按 S12 降级上报，绝不静默吞掉）', () => {
    const root = hermeticBook();
    const failing = {
      publish: () => {
        throw new Error('EISDIR: 账本写入失败');
      },
    } as unknown as PublishBus;
    expect(() =>
      recordWholeBodyAuthorEdit({ ...request(root, 'A\n', 'B\n'), bus: failing }),
    ).toThrow(/EISDIR/);
  });
});

describe('recordWholeBodyAuthorEdit · 窗口累计（窗口键只认提交 revision 上那一条）', () => {
  it('作者改完再原样重存：窗口信号不随 revision 前移而丢失', () => {
    const root = hermeticBook();
    const first = recordWholeBodyAuthorEdit(request(root, '', '他走了1步。他走了2步。\n', 1));
    expect(first.published).toBe(true);

    // 原样重存：revision 照常 +1（数据平面无条件步进），本次增量为空
    const second = recordWholeBodyAuthorEdit(request(root, '他走了1步。他走了2步。\n', '他走了1步。他走了2步。\n', 2));
    expect(second.published).toBe(true);
    expect(second.blocks).toEqual(first.blocks); // 累计链 = 上一链（本次无增量）
    // 事件键随保存前移，链被带着走 ⇒ 提交（rev2）仍能按 taskRef 精确匹配到编辑
    expect(authorEditEvents(root).map((event) => event.taskRef)).toEqual([
      'web_commit_ch1_rev1',
      'web_commit_ch1_rev2',
    ]);
  });

  it('多次小增量合成本窗口编辑链：可依序应用到窗口基线，样本量随窗口累积', () => {
    const root = hermeticBook();
    recordWholeBodyAuthorEdit(request(root, '', '第一行。\n', 1));
    const second = recordWholeBodyAuthorEdit(request(root, '第一行。\n', '第一行。\n第二行。\n', 2));

    expect(second.published).toBe(true);
    expect(second.blocks).toHaveLength(2); // 第一段的 insert + 本次的 insert
    // 窗口语义的可执行声明：累计链依序应用到窗口基线 = 本次保存后的正文
    expect(applyEditBlocks('', callerSide(second.blocks))).toBe('第一行。\n第二行。\n');

    const events = authorEditEvents(root);
    const payload = events[1]?.payload as { revision: number; deltaStats: Record<string, number> };
    expect(payload.revision).toBe(2);
    // deltaStats 按累计链重算：样本口径随窗口累积（不再逐次归零）
    expect(payload.deltaStats).toMatchObject({ opsInsert: 2, opsDelete: 0, opsReplace: 0 });
  });

  it('窗口边界：本章提交行之后重新起算，不累积上一窗口的编辑', () => {
    const root = hermeticBook();
    recordWholeBodyAuthorEdit(request(root, '', '第一行。\n', 1));
    appendFlatRow(root, {
      type: 'ChapterCommitted', seq: 0, at: '2026-01-01T00:00:00.000Z',
      commitId: 'cmit_ledger_fixture', chapterIndex: 1, prosePath: '正文/0001.md',
    });

    const second = recordWholeBodyAuthorEdit(request(root, '第一行。\n', '第一行。\n第二行。\n', 2));
    expect(second.published).toBe(true);
    expect(second.blocks).toHaveLength(1); // 上一窗口已闭合：只有本次增量
  });

  it('链密度守卫：中间 revision 缺账（外部改盘/落账失败）时不累积陈旧块', () => {
    const root = hermeticBook();
    recordWholeBodyAuthorEdit(request(root, '', '第一行。\n', 1));
    // 本次保存 revision=3 ⇒ 前一 revision 应为 2，账上却只有 rev1 ⇒ 链不密 ⇒ 宁缺不假
    const second = recordWholeBodyAuthorEdit(request(root, '第一行。\n', '第一行。\n第二行。\n', 3));
    expect(second.published).toBe(true);
    expect(second.blocks).toHaveLength(1);
  });

  it('账本坏块守卫：不可复用块不进入新事件（宁缺不假）', () => {
    const root = hermeticBook();
    appendTaskRow(root, {
      type: 'UserEditRecorded', taskRef: 'web_commit_ch1_rev1', chapterIndex: 1,
      payload: {
        action: 'edit_blocks', source: 'author', level: 'selection', revision: 1,
        blocks: [{ op: 'insert', paragraphStart: 0, paragraphEnd: 0, replacementText: '坏块' }],
      },
    });
    const second = recordWholeBodyAuthorEdit(request(root, '第一行。\n', '第一行。\n第二行。\n', 2));
    expect(second.published).toBe(true);
    expect(second.blocks).toHaveLength(1); // 坏块被守卫挡下，退化为本次增量
  });
});
