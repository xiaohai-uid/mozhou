import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  absorbReviewCounterexamples,
  harvestQuotesFromProse,
  readCounterexamples,
} from './negative-learning.js'

describe('negative-learning 反例吸收与金句收割引擎测试', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'mozhou-learn-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('正确吸收高危 AI 味反例并去重存盘', () => {
    const issues = [
      { category: 'ai_flavor', severity: 'critical', evidence: '他终于明白命运的安排' },
      { category: 'ai_flavor', severity: 'high', evidence: '宛如一幅壮丽的画卷' },
      { category: 'grammar', severity: 'high', evidence: '错别字' }, // 非 ai_flavor 不吸收
      { category: 'ai_flavor', severity: 'low', evidence: '低风险词' }, // 非 high/critical 不吸收
    ]

    const added = absorbReviewCounterexamples(tmpRoot, issues)
    expect(added).toBe(2)

    const list = readCounterexamples(tmpRoot)
    expect(list).toContain('他终于明白命运的安排')
    expect(list).toContain('宛如一幅壮丽的画卷')
    expect(list).not.toContain('错别字')

    // 重复调用去重
    const repeatAdded = absorbReviewCounterexamples(tmpRoot, issues)
    expect(repeatAdded).toBe(0)
  })

  it('收割短金句并排除对话引出词', () => {
    const sampleProse = `
暴雨倾盆，山神庙里透着刺骨的阴风。

落魄山中藏古神，一念神魔一念人。

陆玄冷冷说道：“你不懂这其中的规矩。”

这是一段很长很长很长很长很长很长很长很长很长很长很长很长超过二十五字的大段文字描述不应被收割。
`
    const quotes = harvestQuotesFromProse(tmpRoot, 1, sampleProse)
    expect(quotes.length).toBeGreaterThan(0)
    expect(quotes).toContain('落魄山中藏古神，一念神魔一念人。')
    expect(quotes.some((q) => q.includes('陆玄冷冷说道'))).toBe(false)
  })
})
