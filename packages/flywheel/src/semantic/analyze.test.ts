/**
 * T28 语义层骨架测试（#69；t66 D08/D11/D13/D15）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from '@mozhou/data-plane'
import {
  INPUT_TOKEN_CAP,
  analyzeSemantic,
  countSemanticReports,
  readSemanticReports,
} from '../index.js'
import type { AnalyzeDeps } from './analyze.js'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) { try { rmSync(root, { recursive: true, force: true }); } catch { /* 清理失败可忽略 */ } }
  roots = []
})

function hermeticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t28-'))
  roots.push(root)
  createBook({ dir: root, title: 'T28语义' })
  return root
}

function baseInput(root: string) {
  return {
    reportId: 'rpt_1',
    bookRoot: root,
    anchor: { receiptId: 'rcpt_abc', recomputationHash: 'hash_1', taskType: 'chapter_draft', chapterIndex: 1 },
    affectedRefs: [{ chapterIndex: 2, changeSummaryDigest: 'dig_2' }],
    contextTokens: 8000,
    provider: 'fake-eval',
  }
}

const happyDeps: AnalyzeDeps = {
  evaluate: () => ({ verdict: 'ok' as const, findings: [], outputTokens: 100 }),
  retry: { attempts: 1, backoffMs: () => 0 },
  sleep: async () => {},
}

describe('语义层骨架 · T28', () => {
  it('成功路径：报告一报一文件落盘、可读回、锚点与 refs 完整', async () => {
    const root = hermeticRoot()
    const outcome = await analyzeSemantic(baseInput(root), happyDeps)
    expect(outcome.status).toBe('reported')
    expect(outcome.relPath).toContain('.mozhou/semantic-analysis/report_')
    expect(existsSync(join(root, outcome.relPath ?? ''))).toBe(true)
    const reports = readSemanticReports(root)
    expect(reports).toHaveLength(1)
    const report = reports[0]
    if (report === undefined) throw new Error('expected report')
    expect(report.anchor.receiptId).toBe('rcpt_abc')
    expect(report.verdict).toBe('ok')
    expect(report.affectedRefs).toEqual([{ chapterIndex: 2, changeSummaryDigest: 'dig_2' }])
  })

  it('预算门：contextTokens 超 INPUT_TOKEN_CAP → refusal(budget_exceeded)、零文件', async () => {
    const root = hermeticRoot()
    const outcome = await analyzeSemantic(
      { ...baseInput(root), contextTokens: INPUT_TOKEN_CAP + 1 },
      happyDeps,
    )
    expect(outcome.status).toBe('refused')
    expect(outcome.refusalCode).toBe('budget_exceeded')
    expect(countSemanticReports(root)).toBe(0)
  })

  it('L2 重试：provider 抛错后重试成功；全失败 → refusal(provider_unavailable) 不静默', async () => {
    const root = hermeticRoot()
    let calls = 0
    const flakyDeps: AnalyzeDeps = {
      evaluate: () => {
        calls += 1
        if (calls === 1) throw new Error('provider down')
        return { verdict: 'attention' as const, findings: [{ severity: 'warning' as const, code: 'W1', message: 'x' }], outputTokens: 50 }
      },
      retry: { attempts: 2, backoffMs: () => 0 },
      sleep: async () => {},
    }
    const ok = await analyzeSemantic(baseInput(root), flakyDeps)
    expect(ok.status).toBe('reported')
    expect(calls).toBe(2) // 第一次失败 + 重试成功
    expect(ok.report?.verdict).toBe('attention')

    // 全失败
    const deadDeps: AnalyzeDeps = {
      evaluate: () => { throw new Error('provider dead') },
      retry: { attempts: 2, backoffMs: () => 0 },
      sleep: async () => {},
    }
    const other = hermeticRoot()
    const refused = await analyzeSemantic(baseInput(other), deadDeps)
    expect(refused.status).toBe('refused')
    expect(refused.refusalCode).toBe('provider_unavailable')
    expect(countSemanticReports(other)).toBe(0) // 无静默占位文件
  })

  it('MUST-NOT 结构约束：analyze 返回面只有报告/拒绝，零 Port/正文写面（编译层强制）', async () => {
    const root = hermeticRoot()
    const outcome = await analyzeSemantic(baseInput(root), happyDeps)
    // 结果形状只有 report/relPath/status/refusalCode（无 canon 写路径字段）
    expect(Object.keys(outcome).sort()).toEqual(['relPath', 'report', 'status'])
    // 未注入 refusal 时无 refusalCode 键
    expect('refusalCode' in outcome).toBe(false)
    // 报告文件内容不含正文源（零泄露）：载荷里没有 body/prose 字段
    const raw = readFileSync(join(root, outcome.relPath ?? ''), 'utf8')
    expect(raw).not.toMatch(/"body"|"prose"|"content"/)
  })
})
