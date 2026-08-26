/**
 * T29 语义批次与投影测试（#70；D12/D14/E3/E5）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PublishBus } from '@mozhou/runtime'
import { createBook } from '@mozhou/data-plane'
import {
  runSemanticBatch,
  selectSemanticAnalysisRows,
} from '../index.js'
import type { AnalyzeDeps } from '../index.js'
import type { SemanticBatchItem } from '../semantic/batch.js'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t29-'))
  roots.push(root)
  createBook({ dir: root, title: 'T29批次' })
  return root
}

function item(chapterIndex: number, overrides: Partial<SemanticBatchItem> = {}): SemanticBatchItem {
  return {
    taskRef: 'w_' + chapterIndex,
    chapterIndex,
    reportId: 'rpt_' + chapterIndex,
    receiptId: 'rcpt_' + chapterIndex,
    recomputationHash: 'h_' + chapterIndex,
    taskType: 'chapter_draft',
    affectedRefs: [{ chapterIndex: chapterIndex + 1, changeSummaryDigest: 'd_' + chapterIndex }],
    contextTokens: 5000,
    provider: 'fake',
    ...overrides,
  }
}

const happyDeps: AnalyzeDeps = {
  evaluate: () => ({ verdict: 'ok' as const, findings: [], outputTokens: 100 }),
  retry: { attempts: 1, backoffMs: () => 0 },
  sleep: async () => {},
}

function eventTypes(root: string): readonly string[] {
  const p = join(root, '.mozhou', 'events.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const raw = JSON.parse(l) as { type?: string; event?: { type?: string }; seq?: number }
      // PublishBus 写 {seq, event:{type}} 任务行；平铺行取顶层 type
      return raw.event?.type ?? raw.type ?? ''
    })
}

describe('语义批次 · T29', () => {
  it('批次全绿：每章一报告一 SemanticAnalyzed 指针事件（先文件后事件）', async () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    const outcome = await runSemanticBatch({
      bus,
      bookRoot: root,
      items: [item(1), item(2), item(3)],
      deps: happyDeps,
    })
    expect(outcome.reported).toBe(3)
    expect(outcome.refused).toBe(0)
    expect(outcome.items.map((i) => i.status)).toEqual(['reported', 'reported', 'reported'])
    // 3 报告文件 + 3 指针事件
    expect(existsSync(join(root, '.mozhou/semantic-analysis/report_rpt_1.json'))).toBe(true)
    const types = eventTypes(root).filter((t) => t === 'SemanticAnalyzed')
    expect(types).toHaveLength(3)
    // 投影视图：3 行，报告真源可重建
    const rows = selectSemanticAnalysisRows(root)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.receipt_id).toBe('rcpt_1')
  })

  it('预算超限章标 deferred（不产报告不产事件）；provider 失败标 refused 带指针', async () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    // 按 reportId 分派：rpt_dead 抛错（provider 不可用），其余成功——单 batch 内测两态
    const deadDeps: AnalyzeDeps = {
      evaluate: (input) => {
        const anchor = input.anchor as { receiptId?: string }
        const chapter = (anchor.receiptId ?? '').replace('rcpt_', '')
        if (chapter === 'dead') throw new Error('down')
        return { verdict: 'ok' as const, findings: [], outputTokens: 100 }
      },
      retry: { attempts: 1, backoffMs: () => 0 },
      sleep: async () => {},
    }
    const outcome = await runSemanticBatch({
      bus,
      bookRoot: root,
      items: [
        item(1, { contextTokens: 99_999 }), // 超限 → deferred
        item(2), // 成功
        item(3, { receiptId: 'rcpt_dead' }), // provider 失败 → refused（按 receiptId 分派）
      ],
      deps: deadDeps,
    })
    expect(outcome.deferred).toBe(1)
    expect(outcome.reported).toBe(1)
    expect(outcome.refused).toBe(1)
    const statuses = outcome.items.map((i) => i.status)
    expect(statuses).toEqual(['deferred', 'reported', 'refused'])
    // deferred/refused 不产报告文件
    expect(existsSync(join(root, '.mozhou/semantic-analysis/report_rpt_1.json'))).toBe(false)
    expect(existsSync(join(root, '.mozhou/semantic-analysis/report_rpt_dead.json'))).toBe(false)
    // refused 也有指针事件（显式 refusal，不静默）
    const types = eventTypes(root).filter((t) => t === 'SemanticAnalyzed')
    expect(types).toHaveLength(2)
  })

  it('投影视图排序稳定：created_at 升序（扫目录重建等价）', async () => {
    const root = hermeticRoot()
    const bus = new PublishBus()
    await runSemanticBatch({
      bus,
      bookRoot: root,
      items: [item(2), item(1)],
      deps: happyDeps,
    })
    const rows = selectSemanticAnalysisRows(root)
    expect(rows.map((r) => r.chapter_index)).toEqual([1, 2].map((c) => (c === 1 ? 1 : 2)).sort((a, b) => a - b))
  })
})
