// @vitest-environment node
/**
 * 原文文风分析与画像版本化保存单测 (T12 · Style Analysis)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook } from '@mozhou/data-plane'
import { analyzeTextStyle, saveBookStyleProfile, loadBookStyleProfile } from './styleAnalysis.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0
})

describe('Style Analysis 文风分析与版本化画像 (T12)', () => {
  it('分析真实文本产出机械指标与推荐画像', () => {
    const text = '“拔剑！”少年厉喝一声，身形如电，长剑破空斩落。寒风呼啸，暗夜里火星迸溅。'
    const result = analyzeTextStyle(text)

    expect(result.metrics.charCount).toBeGreaterThan(20)
    expect(result.recommendedProfile.dialogueRatio).toBeGreaterThanOrEqual(0)
    expect(result.recommendedProfile.actionPacing).toBeGreaterThanOrEqual(0)
    expect(typeof result.recommendedProfile.summary).toBe('string')
  })

  it('文风画像版本化持久化到书目录，多次保存自增版本', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-style-prof-'))
    tempDirs.push(dir)
    createBook({ dir, title: '文风书' })

    // 1. 首次保存画像 (v1)
    const p1 = saveBookStyleProfile(dir, {
      scenarioType: 'dialogue-heavy',
      dialogueRatio: 0.55,
      sensoryDensity: 0.3,
      actionPacing: 0.4,
    })
    expect(p1.version).toBe(1)

    const loaded1 = loadBookStyleProfile(dir)
    expect(loaded1?.version).toBe(1)
    expect(loaded1?.scenarioType).toBe('dialogue-heavy')

    // 2. 第二次调整保存画像 (v2)
    const p2 = saveBookStyleProfile(dir, {
      scenarioType: 'action-fast',
      actionPacing: 0.7,
    })
    expect(p2.version).toBe(2)

    const loaded2 = loadBookStyleProfile(dir)
    expect(loaded2?.version).toBe(2)
    expect(loaded2?.actionPacing).toBe(0.7)
  })
})
