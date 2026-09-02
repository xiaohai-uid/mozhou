/**
 * T17 验收测试（#41）：User Edit 步——
 * 结构化操作块事件 payload（非字符 diff）/ 保护位校验（assistant 拒、author 放行）/
 * 人手外部编辑不受 I1 禁令（dual-plane Q10）/ M16 五级动作位 V1 只做光标+选区两级。
 * 零时钟零外部服务，hermetic 临时书。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { ProtectedContentViolationError } from '@mozhou/kernel';
import {
  LocalDataPlane,
  createBook,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane';
import {
  EditActionLevelError,
  EditBlockShapeError,
  applyEditBlocks,
  readPipelineLedger,
  recordUserEdit,
} from './index.js';
import type { EditOperationBlock } from './index.js';
import { hashProse, parseFailurePatterns } from '@mozhou/quality-engine';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  roots = [];
});

function hermeticBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-t17-edit-'));
  roots.push(dir);
  createBook({ dir, title: '编辑之书' });
  LocalDataPlane.open(dir).createChapterDraft({ chapterIndex: 5, title: '第五章' });
  return dir;
}

function makeDeps(root: string, source: 'author' | 'assistant' = 'author') {
  return {
    bus: new PublishBus(),
    bookRoot: root,
    taskRef: 'tsk_t17_edit',
    chapterIndex: 5,
    level: 'cursor' as const,
    source,
  };
}

function readRawProse(root: string): string {
  return readFileSync(join(root, proseChapterPath(5)), 'utf8');
}

describe('结构化编辑操作块（非字符 diff）', () => {
  it('insert/delete/replace 混合块依序应用并即时落盘，payload 原样落账', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    // 种子只有标题一行；先铺两行草稿正文（每次编辑 revision 各步进一次）
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '原始第一行' },
      { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '原始第二行' },
    ] });
    const scanBefore = readProseChapter(root, proseChapterPath(5));

    // 当前行面：1=标题，2=原始第一行，3=原始第二行
    const blocks = [
      { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '替换后的第二行' },
      { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '插入的第三行' },
      { op: 'delete', paragraphStart: 4, paragraphEnd: 4 },
    ] as const;

    const outcome = recordUserEdit({ ...deps, blocks: [...blocks] });

    expect(outcome.revisionAfter).toBe(scanBefore.revision + 1);
    const scan = readProseChapter(root, proseChapterPath(5));
    expect(scan.phase).toBe('draft');
    expect(scan.revision).toBe(outcome.revisionAfter);
    expect(scan.body).toContain('替换后的第二行');
    expect(scan.body).toContain('插入的第三行');

    const event = readLedger({ root }).map((row) => row.event).filter((event) => event.type === 'UserEditRecorded').at(-1);
    expect(event).toBeDefined(); // 取最近一条：前面铺底那次编辑也各落了一条
    expect(event!.taskRef).toBe('tsk_t17_edit');
    expect(event!.chapterIndex).toBe(5);
    expect(event!.payload).toMatchObject({ action: 'edit_blocks', level: 'cursor', source: 'author' });
    // T21（t52:B2）：结构化操作块原样入账 + delete/replace 克隆体由步内盖 removedText
    //（应用前从行数组顺序截取的原文全文）；insert 克隆体无该键
    expect(event!.payload?.['blocks']).toEqual([
      { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '替换后的第二行', removedText: '原始第一行' },
      { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '插入的第三行' },
      { op: 'delete', paragraphStart: 4, paragraphEnd: 4, removedText: '原始第二行' },
    ]);
    // deltaStats 五字段口径钉死：ops*=块数；insertedChars=ΣreplacementText；
    // removedChars=Σ被 remove 行 '\n' join 长度（与克隆块 removedText 同源）
    expect(event!.payload?.['deltaStats']).toEqual({
      opsInsert: 1,
      opsDelete: 1,
      opsReplace: 1,
      insertedChars: '替换后的第二行'.length + '插入的第三行'.length,
      removedChars: '原始第一行'.length + '原始第二行'.length,
    });
  });

  it('纯函数 applyEditBlocks：区间越界整批拒绝，零部分应用', () => {
    expect(() =>
      applyEditBlocks('一行\n二行\n', [
        { op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: 'ok' },
        { op: 'delete', paragraphStart: 9, paragraphEnd: 9 },
      ]),
    ).toThrowError(EditBlockShapeError);

    expect(applyEditBlocks('甲\n乙\n丙\n', [{ op: 'delete', paragraphStart: 2, paragraphEnd: 2 }])).toBe('甲\n丙\n');
    expect(applyEditBlocks('', [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: '首行' }])).toBe('首行\n');
  });

  it('坏块形状宁败不猜：delete 带 replacementText / replace 缺文本均拒', () => {
    expect(() =>
      applyEditBlocks('a\n', [{ op: 'delete', paragraphStart: 1, paragraphEnd: 1, replacementText: 'x' }]),
    ).toThrowError(/delete 不得携带/);
    expect(() =>
      applyEditBlocks('a\n', [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1 }]),
    ).toThrowError(/replace 必带/);
    expect(() => applyEditBlocks('a\n', [])).toThrowError(/不得为空/);
  });
});

describe('保护位校验与人手通道（dual-plane Q10 先例）', () => {
  it('assistant 通道落在 protected 工件上即拒；author 通道放行且保护位不被清除', () => {
    const root = hermeticBook();
    // 模拟作者在外部编辑器把保护位翻真（外部编辑不受管线约束）
    writeFileSync(
      join(root, proseChapterPath(5)),
      readRawProse(root).replace('protected: false', 'protected: true'),
    );

    expect(() =>
      recordUserEdit({
        ...makeDeps(root, 'assistant'),
        blocks: [{ op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: 'AI 覆写' }],
      }),
    ).toThrowError(ProtectedContentViolationError);

    // 作者亲笔不受 I1 禁令——且编辑后 frontmatter 的 protected 位原样保留
    recordUserEdit({
      ...makeDeps(root, 'author'),
      blocks: [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: '作者亲笔插行' }],
    });
    const raw = readRawProse(root);
    expect(raw).toContain('protected: true');
    expect(raw).toContain('作者亲笔插行');
  });

  it('人手外部编辑不受 I1 禁令：外部改动属 draft 自由改，管线可在其上继续加工', () => {
    const root = hermeticBook();
    const plane = LocalDataPlane.open(root);
    expect(plane.verifyBaseline().draftFreeEdits).toEqual([]);

    // 外部编辑器直接改草稿正文（不经任何管线通道）→ S2 归 draft 自由改，不入对账面
    writeFileSync(
      join(root, proseChapterPath(5)),
      readRawProse(root).replace('# 第五章\n', '# 第五章\n人手先写了半段。'),
    );
    const afterExternal = LocalDataPlane.open(root).verifyBaseline();
    expect(afterExternal.draftFreeEdits).toEqual([proseChapterPath(5)]);

    // 管线在人手改动之上继续结构化加工——不视为 I1 违例（选区级润色）
    const outcome = recordUserEdit({
      ...makeDeps(root),
      level: 'selection',
      blocks: [{ op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '管线接续润色的人手半段。' }],
    });
    expect(outcome.body).toContain('管线接续润色的人手半段。');
    expect(outcome.body).not.toContain('人手先写了半段。'); // replace 已整块替换
  });
});

describe('M16 五级动作位 V1：光标+选区两级', () => {
  it('cursor 与 selection 两级放行且各落一条 UserEditRecorded', () => {
    const root = hermeticBook();
    for (const level of ['cursor', 'selection'] as const) {
      const eventsBefore = readLedger({ root }).length;
      recordUserEdit({
        ...makeDeps(root),
        level,
        blocks: [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: level }],
      });
      expect(readLedger({ root }).length).toBe(eventsBefore + 1);
    }
    const levels = readLedger({ root })
      .map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded')
      .map((event) => event.payload?.['level']);
    expect(levels).toEqual(['cursor', 'selection']);
  });

  it('越级动作位显式拒绝（面板/向导归 Phase 6，不静默降级）', () => {
    const root = hermeticBook();
    expect(() =>
      recordUserEdit({
        ...makeDeps(root),
        level: 'panel' as never,
        blocks: [{ op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: 'x' }],
      }),
    ).toThrowError(EditActionLevelError);
  });
});

describe('T21 编辑 delta 增补（#54 · t52:B2）', () => {
  it('removedText 全文无截断：多行长段删除逐字入账（与无上限 replacementText 对称）', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    const longLineA = '长'.repeat(400) + '——尾甲';
    const longLineB = '长'.repeat(400) + '——尾乙';
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: longLineA },
      { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: longLineB },
] });

    recordUserEdit({ ...deps, blocks: [
      { op: 'replace', paragraphStart: 2, paragraphEnd: 3, replacementText: '合并后的一行' },
] });
    const last = readLedger({ root }).map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded').at(-1)!;
    const published = last.payload?.['blocks'] as { op: string; removedText?: string }[];
    expect(published[0]?.removedText).toBe(longLineA + '\n' + longLineB); // 全文，零截断
    expect(last.payload?.['deltaStats']).toEqual({
      opsInsert: 0,
      opsDelete: 0,
      opsReplace: 1,
      insertedChars: '合并后的一行'.length,
      removedChars: (longLineA + '\n' + longLineB).length,
    });
  });

  it('镜像守卫：调用方携带 removedText 即拒（宁败不猜），且零盘面副作用', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    expect(() =>
      recordUserEdit({ ...deps, blocks: [
        { op: 'delete', paragraphStart: 1, paragraphEnd: 1, removedText: '伪造' } as never,
] }),
    ).toThrowError(/removedText 由本步发布侧产出/);
    expect(() =>
      applyEditBlocks('a\nb\n', [
        { op: 'replace', paragraphStart: 1, paragraphEnd: 1, replacementText: 'x', removedText: '伪造' } as never,
      ]),
    ).toThrowError(EditBlockShapeError);
    // 守卫先行：拒绝路径不产生任何 UserEditRecorded 行
    const editRows = readLedger({ root }).map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded');
    expect(editRows).toHaveLength(0);
  });

  it('请求侧零触碰：盖章只及发布侧克隆块，调用方传入的块对象不带 removedText', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '第一行' },
      { op: 'insert', paragraphStart: 3, paragraphEnd: 3, replacementText: '第二行' },
] });
    const sentBlocks: EditOperationBlock[] = [{ op: 'delete', paragraphStart: 2, paragraphEnd: 2 }];
    recordUserEdit({ ...deps, blocks: sentBlocks });
    expect(sentBlocks[0]).not.toHaveProperty('removedText');
    const last = readLedger({ root }).map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded').at(-1)!;
    expect((last.payload?.['blocks'] as { removedText?: string }[])[0]?.removedText).toBe('第一行');
  });

  it('空行删除边界：removedText 为空串仍入账（有删除语义、字符量记 0）', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '占位行' },
] });
    // 占位行换成一行空行（replacementText='\n' 经 replacementLines 归一为单个空行）
    recordUserEdit({ ...deps, blocks: [
      { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '\n' },
] });
    recordUserEdit({ ...deps, blocks: [{ op: 'delete', paragraphStart: 2, paragraphEnd: 2 }] });
    const last = readLedger({ root }).map((row) => row.event)
      .filter((event) => event.type === 'UserEditRecorded').at(-1)!;
    const published = last.payload?.['blocks'] as { removedText?: string }[];
    expect(published[0]?.removedText).toBe('');
    expect(last.payload?.['deltaStats']).toMatchObject({ opsDelete: 1, removedChars: 0 });
  });
});

/* -------------------------------------------------------------------------
 * ADR-0025（质量门集成 · Task 5）：结构化纠错——事件 + 书侧失败记忆
 * ------------------------------------------------------------------------- */

describe('结构化纠错：AuthorCorrectionRecorded + 失败记忆折叠', () => {
  it('带 reasons 的编辑落纠错事件（附注只带摘要）并写书侧 jsonl', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '原始第一行' },
    ] });

    recordUserEdit({
      ...deps,
      blocks: [{ op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '改写后的一行' }],
      correctionReasons: ['outline_expansion'],
      correctionNote: '又把大纲当正文写了',
    });

    // 事件在账：reasons 原样、noteDigest 为摘要、附注原文不入账
    const correction = readPipelineLedger(root)
      .filter((row) => row.kind === 'task')
      .map((row) => (row.kind === 'task' ? row.event : null))
      .find((event) => event?.type === 'AuthorCorrectionRecorded');
    expect(correction).toBeDefined();
    expect(correction?.payload?.['reasons']).toEqual(['outline_expansion']);
    expect(correction?.payload?.['noteDigest']).toBe(hashProse('又把大纲当正文写了'));
    expect(JSON.stringify(correction)).not.toContain('又把大纲当正文写了');

    // 书侧失败记忆：模式折叠正确（质量先验，非 Canon 文件）
    const jsonl = readFileSync(join(root, '质量', 'failure-memory.jsonl'), 'utf8');
    expect(parseFailurePatterns(jsonl)).toEqual([
      {
        code: 'outline_expansion',
        firstSeenChapter: 5,
        lastSeenChapter: 5,
        occurrences: 1,
        active: true,
        authorNote: '又把大纲当正文写了',
      },
    ]);
  });

  it('不带 reasons 的编辑零纠错副作用（diff 语义不变）', () => {
    const root = hermeticBook();
    const deps = makeDeps(root);
    recordUserEdit({ ...deps, blocks: [
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '原始第一行' },
    ] });

    recordUserEdit({ ...deps, blocks: [
      { op: 'replace', paragraphStart: 2, paragraphEnd: 2, replacementText: '普通润色' },
    ] });

    const events = readPipelineLedger(root)
      .filter((row) => row.kind === 'task')
      .map((row) => (row.kind === 'task' ? row.event : null))
      .filter((event) => event?.type === 'AuthorCorrectionRecorded');
    expect(events).toHaveLength(0);
    expect(() => readFileSync(join(root, '质量', 'failure-memory.jsonl'), 'utf8')).toThrowError();
  });
});
