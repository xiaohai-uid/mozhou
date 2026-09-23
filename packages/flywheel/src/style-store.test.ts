/**
 * T23 · #56 测试：StyleProfileStore 豁免契约——唯一写者单口、审计事件必落、
 * digest 链、回滚锚 revision 继续 +1、taboo 侧账往返。零时钟零外部服务。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { createBook, readStyleProfiles, seedStyleProfileRows, serializeStyleProfiles } from '@mozhou/data-plane';
import type { StyleProfilesMap } from '@mozhou/data-plane';
import { updateStyleProfiles } from './style-learner.js';
import type { StyleEditObservation } from './style-learner.js';
import {
  loadTabooCandidateState,
  saveTabooCandidateState,
  TABOO_STATE_RELPATH,
  writeStyleProfiles,
} from './style-store.js';

function makeBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-style-store-'));
  createBook({ dir, title: '风格之书' });
  return dir;
}

let lastRoot = '';
afterEach(() => {
  if (lastRoot !== '') {
    rmSync(lastRoot, { recursive: true, force: true });
    lastRoot = '';
  }
});

function pos(scenarioType: 'action', chapterIndex: number): StyleEditObservation {
  return { scenarioType, chapterIndex, polarity: 'positive', dialogueRatio: 0.5, sentenceLengths: [8] };
}

function tenPositives(chapterIndex: number): readonly StyleEditObservation[] {
  return Array.from({ length: 10 }, () => pos('action', chapterIndex));
}

function styleEvents(root: string): readonly DomainEvent[] {
  return readLedger({ root })
    .map((row) => row.event)
    .filter((event) => event.type === 'StyleProfileUpdated');
}

describe('StyleProfileStore 受控豁免契约', () => {
  it('唯一写者单口：写盘后盘上画像与 next 恒等，frontmatter 字节保留', () => {
    lastRoot = makeBook();
    const before = seedStyleProfileRows();
    const rawBefore = readFileSync(join(lastRoot, '文风.md'), 'utf8');
    const { next } = updateStyleProfiles(before, tenPositives(7));

    writeStyleProfiles({ bus: new PublishBus(), bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 7, next });

    expect(readStyleProfiles(lastRoot)).toEqual(next);
    const rawAfter = readFileSync(join(lastRoot, '文风.md'), 'utf8');
    // 围栏外字节（frontmatter + 人读标题）原样保留——只整块替换 fenced-YAML
    const prefix = rawBefore.split('\u0060\u0060\u0060yaml')[0] ?? rawBefore;
    expect(rawAfter.startsWith(prefix)).toBe(true);
  });

  it('审计必落：每次写盘恰好伴随一条 StyleProfileUpdated，digest 链相扣且顶层槽位不进 payload', () => {
    lastRoot = makeBook();
    const bus = new PublishBus();
    const before = seedStyleProfileRows();

    const r1 = updateStyleProfiles(before, tenPositives(7));
    writeStyleProfiles({ bus, bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 7, next: r1.next, audit: { sampleCount: 10, alphaUsed: r1.report.alphaUsed } });
    const r2 = updateStyleProfiles(r1.next, tenPositives(8));
    writeStyleProfiles({ bus, bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 8, next: r2.next, audit: { sampleCount: 10, alphaUsed: r2.report.alphaUsed } });

    const events = styleEvents(lastRoot);
    expect(events).toHaveLength(2);
    const firstPayload = events[0]?.payload as Record<string, unknown>;
    const secondPayload = events[1]?.payload as Record<string, unknown>;
    expect(events[0]?.taskRef).toBe('tsk_01');
    expect(events[0]?.chapterIndex).toBe(7);
    expect(firstPayload['profiles']).toEqual(r1.next);
    // digest 链：第二批的 beforeDigest 必须咬合第一批的 afterDigest（重放可验证）
    expect(secondPayload['beforeDigest']).toBe(firstPayload['afterDigest']);
    // taskRef/chapterIndex 在事件顶层，不塞 payload（t51:B5 / t52:B5）
    expect(Object.hasOwn(secondPayload as object, 'taskRef')).toBe(false);
    expect(Object.hasOwn(secondPayload as object, 'chapterIndex')).toBe(false);
  });

  it('回滚=重放覆写 + rolledBackTo 锚 + revision 继续 +1，后续批次单调递增', () => {
    lastRoot = makeBook();
    const bus = new PublishBus();
    const seed = seedStyleProfileRows();
    const r1 = updateStyleProfiles(seed, tenPositives(7));
    writeStyleProfiles({ bus, bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 7, next: r1.next });
    const r2 = updateStyleProfiles(
      r1.next,
      Array.from({ length: 10 }, () => ({ scenarioType: 'action' as const, chapterIndex: 8, polarity: 'positive' as const, dialogueRatio: 0.9, sentenceLengths: [40] })),
    );
    writeStyleProfiles({ bus, bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 8, next: r2.next });
    expect(r2.next.action.revision).toBe(seed.action.revision + 2);

    // 回滚到第 1 批：重放历史 after 值覆写，revision 是变更计数不是分支号——继续 +1
    const restored: StyleProfilesMap = {
      ...r2.next,
      action: { ...r1.next.action, revision: r2.next.action.revision + 1 },
    };
    writeStyleProfiles({ bus, bookRoot: lastRoot, taskRef: 'tsk_01', chapterIndex: 9, next: restored, audit: { rolledBackTo: 1 } });

    const onDisk = readStyleProfiles(lastRoot);
    expect(onDisk.action.revision).toBe(seed.action.revision + 3);
    expect(onDisk.action.dialogueRatio).toBe(r1.next.action.dialogueRatio); // 第 1 批数值
    const rollbackEvent = styleEvents(lastRoot)[2];
    expect((rollbackEvent?.payload as Record<string, unknown>)['rolledBackTo']).toBe(1);

    // 恢复后的下一个真实批次照常 +1（revision 单调，永不回退）
    const r4 = updateStyleProfiles(onDisk, tenPositives(10));
    expect(r4.next.action.revision).toBe(onDisk.action.revision + 1);
  });

  it('serialize 纯函数不做 IO：直接调用不产生任何写副作用（唯一写者口径的对照面）', () => {
    lastRoot = makeBook();
    const raw = readFileSync(join(lastRoot, '文风.md'), 'utf8');
    const mutated = { ...seedStyleProfileRows() };
    const rewritten = serializeStyleProfiles(raw, mutated); // 纯字符串变换
    expect(rewritten).not.toBe(raw);
    expect(readFileSync(join(lastRoot, '文风.md'), 'utf8')).toBe(raw); // 盘上未动
  });
});

describe('taboo 候选侧账', () => {
  it('缺文件 = 空白状态；保存后往返恒等；损坏宁败', () => {
    lastRoot = makeBook();
    expect(loadTabooCandidateState(lastRoot)).toEqual({
      action: [],
      dialogue: [],
      romance_emotion: [],
      exposition_worldbuilding: [],
    });

    const state = {
      action: [{ word: '刀光', totalHits: 3, chapters: [1, 2] }],
      dialogue: [],
      romance_emotion: [],
      exposition_worldbuilding: [],
    };
    saveTabooCandidateState(lastRoot, state);
    expect(loadTabooCandidateState(lastRoot)).toEqual(state);
    expect(readFileSync(join(lastRoot, TABOO_STATE_RELPATH), 'utf8').endsWith('\n')).toBe(true);

    writeFileSync(join(lastRoot, TABOO_STATE_RELPATH), '{"action": "not-an-array"}', 'utf8');
    expect(() => loadTabooCandidateState(lastRoot)).toThrow(/形状违例/);
  });
});
