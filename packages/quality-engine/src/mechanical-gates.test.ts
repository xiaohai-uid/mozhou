import { describe, expect, it } from 'vitest'
import {
  detect4GramRepetition,
  evaluateMechanicalGates,
  findCommon5Gram,
  isInsideQuotes,
} from './mechanical-gates.js'

describe('mechanical-gates 机械门禁与算术方差算法测试', () => {
  it('正确识别中英文成对引号内的对话片段', () => {
    const text = '陆玄冷冷说道：“白磷乃是天地奇物，不可轻慢。”'
    expect(isInsideQuotes(text, '白磷乃是')).toBe(true)
    expect(isInsideQuotes(text, '陆玄冷冷')).toBe(false)
  })

  it('相邻段落相同 5 字片段检测（对话回环允许，叙述复读拦截）', () => {
    const para1 = '庙门外大雨倾盆，残瓦碎砖落了一地。'
    const para2 = '庙门外大雨倾盆，陆玄缓缓站起身来。'
    expect(findCommon5Gram(para1, para2)).toBe('庙门外大雨')

    // 对话回环（两段均在引号内）不应判定为复读
    const dialog1 = '陆玄道：“你不知道的事情还很多。”'
    const dialog2 = '赵捕头咬牙道：“你不知道的事情还很多，休要装蒜！”'
    expect(findCommon5Gram(dialog1, dialog2)).toBeNull()
  })

  it('4-gram 词频统计（过滤标点与引号，同一 4 字短语 >= 6 次拦截）', () => {
    const normalText = '暴雨倾盆。落魄山腰处的山神庙早已破败多年，残垣断瓦间透着刺骨的阴风。'
    expect(detect4GramRepetition(normalText).repeated).toBe(false)

    // 重复 6 次的恶意短语
    const repeatPhrase = '诡异的磷火'
    const textWithRepeats = Array(7).fill(repeatPhrase).join('。然后他又看到了')
    const res = detect4GramRepetition(textWithRepeats, 5)
    expect(res.repeated).toBe(true)
    expect(res.detail).toContain('高频出现')
  })

  it('evaluateMechanicalGates 完整门禁审查（红线拦截、占位符拦截）', () => {
    const badProse = '陆玄盘坐在破庙中，TODO 补充道具。他终于明白，这一夜注定无人入眠。'
    const report = evaluateMechanicalGates(badProse, { minWords: 10, maxWords: 1000 })
    expect(report.passed).toBe(false)
    expect(report.fails.some((f) => f.includes('占位符'))).toBe(true)
    expect(report.fails.some((f) => f.includes('AI红线'))).toBe(true)
  })
})
