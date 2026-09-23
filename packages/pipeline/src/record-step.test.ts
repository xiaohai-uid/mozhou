/**
 * Flywheel Record 步单测（T19 · #43）：任务收尾事件 + usage/cost 投影；
 * 记账失败不阻断正文（state_degraded）；派生记账异步回灌。零时钟零外部服务。
 */
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@mozhou/kernel';
import { PublishBus, readLedger } from '@mozhou/runtime';
import { createBook, RUNTIME_EVENTS_PATH } from '@mozhou/data-plane';
import {
  USAGE_PROJECTION_PATH,
  appendUsageRows,
  backfillDerivedUsage,
  readUsageProjection,
  runFlywheelRecord,
} from './record-step.js';
import type { UsageRecord } from './record-step.js';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = [];
});

function makeBook(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  createBook({ dir, title: '飞轮之书' });
  return dir;
}

function ledgerEvents(root: string): readonly DomainEvent[] {
  return readLedger({ root }).map((row) => row.event);
}

describe('Flywheel Record 步（S12 / §1 表第 10 行）', () => {
  it('收尾事件 + usage 投影落表：机械字段盖章、outcome=succeeded 进账', () => {
    const root = makeBook('mozhou-t19-record-');
    const bus = new PublishBus();

    const outcome = runFlywheelRecord({
      bus,
      bookRoot: root,
      taskRef: 'tsk_t19_rec',
      chapterIndex: 2,
      commitId: 'cmit_t19rec',
      usage: [
        { kind: 'usage', provider: 'deepseek', model: 'v3', inputTokens: 1200, outputTokens: 300 },
        { kind: 'cost', costMicros: 42 },
      ],
      projectionSink: (rows) => appendUsageRows(root, rows),
      newEntryId: (index) => 'usg_fix_' + index,
      nowIso: '2026-08-25T00:00:00.000Z',
    });

    expect(outcome.status).toBe('succeeded');
    expect(outcome.recordedCount).toBe(2);
    expect(outcome.rows.map((row) => row.entryId)).toEqual(['usg_fix_0', 'usg_fix_1']);
    expect(outcome.rows.every((row) => row.derived === false)).toBe(true);
    expect(outcome.rows[0]).toMatchObject({ taskRef: 'tsk_t19_rec', chapterIndex: 2, at: '2026-08-25T00:00:00.000Z' });

    // 投影表落盘（运行时区路径）
    expect(existsSync(join(root, USAGE_PROJECTION_PATH))).toBe(true);
    expect(readUsageProjection(root)).toHaveLength(2);

    // 收尾事件在账：outcome/commitId/recordedCount 进 payload
    const event = ledgerEvents(root).find((candidate) => candidate.type === 'FlywheelRecorded');
    expect(event?.payload).toMatchObject({ outcome: 'succeeded', commitId: 'cmit_t19rec', recordedCount: 2 });
  });

  it('空计量也落收尾事件：recordedCount=0、投影表零行、事件照常', () => {
    const root = makeBook('mozhou-t19-rec0-');
    const bus = new PublishBus();
    const outcome = runFlywheelRecord({ bus, bookRoot: root, taskRef: 'tsk_t19_r0', chapterIndex: 1, commitId: 'cmit_x' });
    expect(outcome.status).toBe('succeeded');
    expect(outcome.rows).toEqual([]);
    expect(readUsageProjection(root)).toEqual([]);
    const event = ledgerEvents(root).at(-1);
    expect(event?.type).toBe('FlywheelRecorded');
    expect(event?.payload).toMatchObject({ outcome: 'succeeded', recordedCount: 0 });
  });

  it('记账失败不阻断正文（S12）：投影写抛错 ⇒ state_degraded 上报、事件照常落账', () => {
    const root = makeBook('mozhou-t19-degrade-');
    const bus = new PublishBus();
    const outcome = runFlywheelRecord({
      bus,
      bookRoot: root,
      taskRef: 'tsk_t19_deg',
      chapterIndex: 3,
      commitId: 'cmit_y',
      usage: [{ kind: 'usage', inputTokens: 1 }],
      projectionSink: () => {
        throw new Error('disk full (fixture)');
      },
    });
    expect(outcome.status).toBe('state_degraded');
    expect(outcome.errorDetail).toContain('disk full');
    expect(outcome.recordedCount).toBe(0);
    // 事件照常落账且如实携带降级面——不阻断、不静默
    const event = ledgerEvents(root).at(-1);
    expect(event?.type).toBe('FlywheelRecorded');
    expect(event?.payload).toMatchObject({ outcome: 'state_degraded', errorDetail: 'disk full (fixture)', recordedCount: 0 });
  });
});

describe('usage 投影表：异步回灌与读侧去重（§J.4 边界内）', () => {
  const SYNC_ROW: UsageRecord = {
    entryId: 'usg_sync_1',
    taskRef: 'tsk_t19_bf',
    chapterIndex: 2,
    commitId: 'cmit_z',
    kind: 'usage',
    derived: false,
    inputTokens: 100,
    outputTokens: 50,
  };

  it('backfillDerivedUsage 只收 derived 行且必须带 derivedFrom（宁败不猜）', () => {
    const root = makeBook('mozhou-t19-bf1-');
    appendUsageRows(root, [SYNC_ROW]);
    expect(() => backfillDerivedUsage(root, [{ ...SYNC_ROW, entryId: 'usg_bad_1', derived: false, kind: 'cost' }])).toThrow(/derived rows/);
    const { derivedFrom: _omitted, ...withoutDerivedFrom } = SYNC_ROW;
    void _omitted;
    expect(() =>
      backfillDerivedUsage(root, [{ ...withoutDerivedFrom, entryId: 'usg_bad_2', derived: true, kind: 'cost' }]),
    ).toThrow(/derivedFrom/);
    expect(readUsageProjection(root)).toEqual([SYNC_ROW]);
  });

  it('回灌进同一投影表：读侧合并有序、Ledger 零字节触碰、同 entryId 幂等先到先得', () => {
    const root = makeBook('mozhou-t19-bf2-');
    const bus = new PublishBus();
    runFlywheelRecord({
      bus,
      bookRoot: root,
      taskRef: 'tsk_t19_bf',
      chapterIndex: 2,
      commitId: 'cmit_z',
      usage: [{ kind: 'usage', inputTokens: 100, outputTokens: 50 }],
      projectionSink: (rows) => appendUsageRows(root, rows),
      newEntryId: () => 'usg_sync_1',
    });
    const ledgerBytesAfterRecord = statSync(join(root, RUNTIME_EVENTS_PATH)).size;

    // 异步回灌：成本核算面事后到达
    backfillDerivedUsage(root, [
      { ...SYNC_ROW, entryId: 'usg_cost_1', kind: 'cost', derived: true, derivedFrom: 'usg_sync_1', costMicros: 7 },
    ]);

    const rows = readUsageProjection(root);
    expect(rows.map((row) => [row.entryId, row.kind, row.derived])).toEqual([
      ['usg_sync_1', 'usage', false],
      ['usg_cost_1', 'cost', true],
    ]);
    expect(rows[1]?.derivedFrom).toBe('usg_sync_1');

    // 回灌只碰运行时区投影表，Ledger 零字节触碰
    expect(statSync(join(root, RUNTIME_EVENTS_PATH)).size).toBe(ledgerBytesAfterRecord);

    // 同 entryId 重放（重复回灌）幂等：先到先得，行集不变
    appendUsageRows(root, [{ ...rows[0]!, at: '9999-changed' }]);
    expect(readUsageProjection(root)).toEqual(rows);
  });

  it('撕裂行审计容忍：坏 JSON 行跳过不阻断读取', () => {
    const root = makeBook('mozhou-t19-torn-');
    appendUsageRows(root, [SYNC_ROW]);
    appendFileSync(join(root, USAGE_PROJECTION_PATH), Buffer.from('{torn\n', 'utf8'));
    appendUsageRows(root, [{ ...SYNC_ROW, entryId: 'usg_after_torn', kind: 'cost', derived: true, derivedFrom: 'usg_sync_1' }]);
    expect(readUsageProjection(root).map((row) => row.entryId)).toEqual(['usg_sync_1', 'usg_after_torn']);
  });

  it('缺失投影表返回空数组（从未记账的书）', () => {
    const root = makeBook('mozhou-t19-empty-');
    writeFileSync(join(root, '.mozhou', '.keep'), '');
    expect(readUsageProjection(root)).toEqual([]);
  });
});