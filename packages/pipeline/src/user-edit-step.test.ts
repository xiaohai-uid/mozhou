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
  recordUserEdit,
} from './index.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
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
    expect(event!.payload?.['blocks']).toEqual([...blocks]); // 结构化操作块原样入账
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
