/**
 * prose-ast 纯函数测试（CHG-20261006-02 同变新增）：
 * - Round-trip 无损不变量（验收「旧 textarea 草稿无损打开」的根基）；
 * - 行 ↔ ProseMirror 位置映射公式（验收「选区不漂移」的根基）；
 * - planRangeReplacement 的字符串语义等价性。
 */
import { describe, expect, it } from 'vitest'
import {
  buildLineSpans,
  planRangeReplacement,
  proseLinesToText,
  textOffsetToPmPos,
  textToProseLines,
} from './prose-ast'

describe('prose-ast · round-trip 无损不变量', () => {
  const CASES = [
    '',
    '第一段。\n第二段。',
    '　　全角缩进段落。\n\n　　另一个段落。',
    '***\n　　场景切分之后。\n---\n【场景切分】',
    ' *** 带空白的切分行 ',
    '夜雨敲窗。\n',
    '\n\n\n',
    '“对白行保持原样。”\n「另一行对白。」',
    '一行',
  ] as const

  it.each(CASES)('round-trip(%j) 恒等', (text) => {
    expect(proseLinesToText(textToProseLines(text))).toBe(text)
  })

  it('随机化 round-trip：任意拼接字符串恒等（含 \n 连续、全角空格、标记变形）', () => {
    const atoms = ['甲', '　　', '\n', '***', '---', '【场景切分】', '“', '”', ' ', ' *** ']
    // 固定种子 LCG：测试语料可复现（失败可重放），不用加密随机源。
    let seed = 0x5eed
    const next = (mod: number): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
      return Math.floor((seed / 4_294_967_296) * mod)
    }
    for (let i = 0; i < 300; i++) {
      let text = ''
      const n = 1 + next(12)
      for (let j = 0; j < n; j++) text += atoms[next(atoms.length)]
      expect(proseLinesToText(textToProseLines(text))).toBe(text)
    }
  })

  it('场景切分行识别为 scene_break 且保留原始文本；其余为 paragraph', () => {
    const lines = textToProseLines('　　正文段。\n***\n【场景切分】')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ kind: 'paragraph', text: '　　正文段。' })
    expect(lines[1]!.kind).toBe('scene_break')
    expect(lines[1]!.marker).toBe('***')
    expect(lines[2]!.kind).toBe('scene_break')
    expect(lines[2]!.text).toBe('【场景切分】')
  })

  it('「【场景切分 · POV视点】」等扩展标记不是 scene_break（保持诚实：只有三种合法形态）', () => {
    const lines = textToProseLines('【场景切分 · POV视点】')
    expect(lines[0]!.kind).toBe('paragraph')
  })
})

describe('prose-ast · PM 位置映射公式', () => {
  it('单段 "ab"：文本区间 PM [1,3)，节点 [0,4)', () => {
    const spans = buildLineSpans(textToProseLines('ab'))
    expect(spans[0]).toMatchObject({ textStart: 0, textEnd: 2, pmNodeStart: 0, pmTextFrom: 1, pmTextTo: 3, pmNodeEnd: 4 })
    expect(textOffsetToPmPos(spans, 0)).toBe(1)
    expect(textOffsetToPmPos(spans, 1)).toBe(2)
    expect(textOffsetToPmPos(spans, 2)).toBe(3)
  })

  it('两段 "ab\\ncd"：第二段节点起点 = 2+2=4，文本 [5,7)，节点 [4,8)', () => {
    const spans = buildLineSpans(textToProseLines('ab\ncd'))
    expect(spans[1]).toMatchObject({ textStart: 3, textEnd: 5, pmNodeStart: 4, pmTextFrom: 5, pmTextTo: 7, pmNodeEnd: 8 })
  })

  it('sceneBreak（atom）节点 size=1：后续行起点相应前移', () => {
    // 'ab' + sceneBreak('***') + 'cd'
    const spans = buildLineSpans(textToProseLines('ab\n***\ncd'))
    expect(spans[1]).toMatchObject({ pmNodeStart: 4, pmNodeEnd: 5, pmTextFrom: 5, pmTextTo: 5 })
    expect(spans[2]).toMatchObject({ textStart: 7, pmNodeStart: 5, pmTextFrom: 6, pmTextTo: 8, pmNodeEnd: 9 })
  })

  it('空行 = 空 paragraph（size=2），pmTextFrom === pmTextTo', () => {
    const spans = buildLineSpans(textToProseLines('a\n\nb'))
    expect(spans[1]).toMatchObject({ textStart: 2, textEnd: 2, pmNodeStart: 3, pmTextFrom: 4, pmTextTo: 4, pmNodeEnd: 5 })
    expect(spans[2]).toMatchObject({ pmNodeStart: 5, pmTextFrom: 6 })
  })
})

describe('prose-ast · planRangeReplacement（字符串切片语义）', () => {
  it('同段内替换：只动该行，pm 区间对齐', () => {
    // '墨舟网文操作系统，沉浸创作。' 选中 [2,8)「网文操作系统」→ 替换 '编辑器'
    const text = '墨舟网文操作系统，沉浸创作。'
    const plan = planRangeReplacement(text, 2, 8, '编辑器内核')
    expect(plan).not.toBeNull()
    expect(plan!.pmFrom).toBe(3) // 行内偏移 2 → PM 1+2
    expect(plan!.pmTo).toBe(9) // 行内偏移 8 → PM 1+8
    expect(plan!.newLines).toEqual([{ kind: 'paragraph', text: '墨舟编辑器内核，沉浸创作。' }])
  })

  it('跨行替换：首行保前缀、末行保后缀、中间行删除（newLines = 受影响区间展开）', () => {
    const text = '甲乙\n丙丁\n戊己'
    const plan = planRangeReplacement(text, 1, 5, 'X\nY')
    expect(plan).not.toBeNull()
    // 受影响区间 [行0 偏移1, 行1 末尾]：prefix='甲'，suffix=''（to 到达行 1 末尾）
    expect(plan!.newLines.map((l) => l.text)).toEqual(['甲X', 'Y'])
    // 全文等价（调用方重组：区间前行 + newLines + 区间后行）与字符串切片逐字节一致
    const lines = textToProseLines(text)
    const full = [...lines.slice(0, 0), ...plan!.newLines, ...lines.slice(2)]
    expect(proseLinesToText(full)).toBe(text.slice(0, 1) + 'X\nY' + text.slice(5))
  })

  it('整行替换（含场景切分行）：pmFrom 走节点边界、pmTo 走节点终点', () => {
    const text = '　　前文。\n***\n　　后文。'
    const plan = planRangeReplacement(text, 6, 9, '【场景切分】') // 替换 '***' 行
    expect(plan).not.toBeNull()
    // 行 0：len=5，pmNodeEnd=7；行 1（sceneBreak）pmNodeStart=7
    expect(plan!.pmFrom).toBe(7)
    expect(plan!.pmTo).toBe(8) // sceneBreak 节点终点
    // aOff=0 且 suffix=''：新内容自成一行
    expect(plan!.newLines).toEqual([{ kind: 'scene_break', text: '【场景切分】', marker: '【场景切分】' }])
  })

  it('替换结果与区间外行重组后 round-trip 成立（配合序列化）', () => {
    const text = '第一行。\n第二行目标。\n第三行。'
    const plan = planRangeReplacement(text, 5, 11, '替换后的\n两行')
    expect(plan).not.toBeNull()
    // newLines 是受影响区间展开（aOff=0，prefix=''；to 达行末，suffix=''）
    expect(plan!.newLines.map((l) => l.text)).toEqual(['替换后的', '两行'])
    const lines = textToProseLines(text)
    const full = [...lines.slice(0, 1), ...plan!.newLines, ...lines.slice(2)]
    expect(proseLinesToText(full)).toBe(text.slice(0, 5) + '替换后的\n两行' + text.slice(11))
    expect(proseLinesToText(textToProseLines(proseLinesToText(full)))).toBe(proseLinesToText(full))
  })

  it('非法区间返回 null（from>to / 越界 / 非整数）', () => {
    expect(planRangeReplacement('abc', 2, 1, 'x')).toBeNull()
    expect(planRangeReplacement('abc', 0, 4, 'x')).toBeNull()
    expect(planRangeReplacement('abc', 0.5, 2, 'x')).toBeNull()
    expect(planRangeReplacement('abc', -1, 2, 'x')).toBeNull()
  })

  it('from === to（纯插入）合法：pmFrom === pmTo', () => {
    const plan = planRangeReplacement('甲乙', 1, 1, '插入')
    expect(plan).not.toBeNull()
    expect(plan!.pmFrom).toBe(plan!.pmTo)
    expect(plan!.newLines[0]!.text).toBe('甲插入乙')
  })
})
