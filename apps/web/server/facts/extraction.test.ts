// @vitest-environment node
/**
 * 章后事实提取单元测试（#117 第一查事件 + #118 第二查人物心理状态）。
 * 断言 mock 确定性产出与模型输出解析的形状契约：宁抛不猜（S5）；
 * 心理状态候选载荷必须含人物标识（character）与前后状态（before / after）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildFactExtractionUserPrompt,
  FACT_EXTRACTION_SYSTEM_PROMPT,
  mockFactExtraction,
  parseFactExtractionOutput,
} from './extraction.js'

const PROSE_BODY = '萧炎走进坊市，与萧宁当街冲突。两人不欢而散，各自记恨。'

describe('mock 提取（#118 两种候选）', () => {
  it('一次产出事件与心理状态两类候选；心理载荷含人物标识与前后状态', () => {
    const candidates = mockFactExtraction(1, PROSE_BODY)
    expect(candidates.map((c) => c.kind)).toEqual(['event', 'psychological_state'])

    const psych = candidates[1]!
    expect(psych.payload['character']).toBe('萧炎')
    expect(psych.payload['before']).toBe('平静')
    expect(psych.payload['after']).toBe('戒备')
    expect(psych.payload.summary).toBe('萧炎：平静 → 戒备')
    expect(psych.evidence.length).toBeGreaterThan(0)
  })

  it('确定性：同输入两次产出逐字段一致', () => {
    expect(mockFactExtraction(3, PROSE_BODY)).toEqual(mockFactExtraction(3, PROSE_BODY))
  })

  it('空正文：不产任何候选（空提取同样是新现场，由账本作废旧 pending）', () => {
    expect(mockFactExtraction(1, '')).toEqual([])
    expect(mockFactExtraction(1, '   \n  ')).toEqual([])
  })

  it('事件候选保持 #117 口径：章号前缀摘要 + 原文首句证据', () => {
    const event = mockFactExtraction(7, PROSE_BODY)[0]!
    expect(event.kind).toBe('event')
    expect(event.payload.summary.startsWith('第7章事件：')).toBe(true)
    expect(event.evidence).toBe('萧炎走进坊市，与萧宁当街冲突。')
  })
})

describe('真实模型输出解析（#118 两查同缝）', () => {
  const validBoth = JSON.stringify({
    events: [{ summary: '坊市冲突', evidence: '与萧宁当街冲突' }],
    psychological_states: [{ character: '萧炎', before: '平静', after: '戒备', evidence: '各自记恨' }],
  })

  it('两类候选都解析：事件走 summary 载荷，心理状态走结构化载荷并派生摘要', () => {
    const candidates = parseFactExtractionOutput(validBoth)
    expect(candidates.map((c) => c.kind)).toEqual(['event', 'psychological_state'])
    expect(candidates[0]!.payload.summary).toBe('坊市冲突')
    const psych = candidates[1]!
    expect(psych.payload['character']).toBe('萧炎')
    expect(psych.payload['before']).toBe('平静')
    expect(psych.payload['after']).toBe('戒备')
    expect(psych.payload.summary).toBe('萧炎：平静 → 戒备')
    expect(psych.evidence).toBe('各自记恨')
  })

  it('markdown 代码围栏可剥除', () => {
    const fenced = '```json\n' + validBoth + '\n```'
    expect(parseFactExtractionOutput(fenced).length).toBe(2)
  })

  it('两类都为空数组是合法输出：零候选不报错', () => {
    const empty = JSON.stringify({ events: [], psychological_states: [] })
    expect(parseFactExtractionOutput(empty)).toEqual([])
  })

  it('两类各自超过 8 条只取前 8 条（与提示词上限一致，防超长输出打爆账本）', () => {
    const many = JSON.stringify({
      events: Array.from({ length: 10 }, (_, i) => ({ summary: `事件${i}`, evidence: '原文' })),
      psychological_states: Array.from({ length: 9 }, (_, i) => ({
        character: `人物${i}`,
        before: '甲',
        after: '乙',
        evidence: '原文',
      })),
    })
    const candidates = parseFactExtractionOutput(many)
    expect(candidates.filter((c) => c.kind === 'event').length).toBe(8)
    expect(candidates.filter((c) => c.kind === 'psychological_state').length).toBe(8)
  })
})

describe('解析负例（宁抛不猜，绝不静默落空）', () => {
  it.each([
    ['非 JSON 输出', '完全不是 JSON'],
    ['events 数组缺失', JSON.stringify({ psychological_states: [] })],
    ['psychological_states 数组缺失', JSON.stringify({ events: [] })],
    ['psychological_states 非数组', JSON.stringify({ events: [], psychological_states: '无变化' })],
    ['心理条目缺 character', JSON.stringify({ events: [], psychological_states: [{ before: '甲', after: '乙', evidence: '原文' }] })],
    ['心理条目 after 为空白', JSON.stringify({ events: [], psychological_states: [{ character: '萧炎', before: '甲', after: '  ', evidence: '原文' }] })],
    ['心理条目缺 evidence', JSON.stringify({ events: [], psychological_states: [{ character: '萧炎', before: '甲', after: '乙' }] })],
    ['事件条目缺 summary', JSON.stringify({ events: [{ evidence: '原文' }], psychological_states: [] })],
  ])('%s → FACT_EXTRACTION_PARSE_FAILED', (_label, raw) => {
    expect(() => parseFactExtractionOutput(raw)).toThrow(/FACT_EXTRACTION_PARSE_FAILED/)
  })
})

describe('提示词（mock 与真实 provider 同缝）', () => {
  it('系统提示词同时要求事件与心理状态两种结构化输出', () => {
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain('events')
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain('psychological_states')
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain('character')
  })

  it('用户提示词带章号、两查任务与正文', () => {
    const prompt = buildFactExtractionUserPrompt(3, PROSE_BODY)
    expect(prompt).toContain('第 3 章')
    expect(prompt).toContain('心理状态')
    expect(prompt).toContain(PROSE_BODY)
  })
})
