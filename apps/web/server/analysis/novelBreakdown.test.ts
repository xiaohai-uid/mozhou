// @vitest-environment node
/**
 * 原文锚定小说拆解单测 (T12 · Novel Breakdown)。
 */
import { describe, expect, it } from 'vitest'
import { analyzeNovelBreakdown } from './novelBreakdown.js'

describe('Novel Breakdown 原文锚定拆解 (T12)', () => {
  it('拆解结果严格绑定原文 span 与 quote，切片恒等完全成立', () => {
    const source =
      '荒庙残破，冷雨如注。秦三抹了把脸上的雨水，咬牙道：“这尊泥塑神像，当真会显灵？”身后的知客童子瑟瑟发抖，不敢多言。夜风呼啸，庙外的敲门声骤然响起。'

    const report = analyzeNovelBreakdown(source)

    expect(report.sourceLength).toBe(source.length)
    expect(report.sourceHash.length).toBe(64)
    expect(report.storyCore.protagonist).toBeDefined()

    // 核心断言：所有人物项的 quote 必须完全等于 source.slice(start, end)
    for (const char of report.characters) {
      expect(source.slice(char.span.start, char.span.end)).toBe(char.quote)
      expect(char.name.length).toBeGreaterThanOrEqual(2)
    }

    // 所有情感节拍的 quote 必须完全等于 source.slice(start, end)
    for (const beat of report.beats) {
      expect(source.slice(beat.span.start, beat.span.end)).toBe(beat.quote)
      expect(beat.quote.length).toBeGreaterThan(0)
    }

    // 章节节奏项必须完全等于 source.slice(start, end)
    for (const p of report.pacing) {
      expect(source.slice(p.span.start, p.span.end)).toBe(p.quote)
    }
  })

  it('文本包含恶意指令时不执行文件操作，安全纯文本处理', () => {
    const maliciousSource =
      '林渡冷笑一声：“就凭你们也想拦我？”\nrm -rf /; DROP TABLE users; 剑光如虹，瞬间破阵。'

    const report = analyzeNovelBreakdown(maliciousSource)
    expect(report.characters.length).toBeGreaterThan(0)
    // 依然严格保持原文切片恒等
    for (const char of report.characters) {
      expect(maliciousSource.slice(char.span.start, char.span.end)).toBe(char.quote)
    }
  })
})
