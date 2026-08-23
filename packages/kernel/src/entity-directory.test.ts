import { describe, expect, it } from 'vitest'
import { detectEntityMentions, type DetectableEntity } from './entity-directory.js'

const WAN_JIE: DetectableEntity = {
  ref: 'char:lin-wan',
  aliases: [
    { text: '林晚', kind: 'exact' },
    { text: '晚姐', kind: 'exact' },
  ],
  excludedPhrases: [],
}

describe('detectEntityMentions（entity-directory-spec Q3 冻结语义）', () => {
  it('hits a card through its Chinese alias 晚姐', () => {
    const hits = detectEntityMentions([WAN_JIE], '夜色里，晚姐把伞递了过来。')
    expect(hits).toEqual([
      { ref: 'char:lin-wan', matchedText: '晚姐', aliasIndex: 1, kind: 'exact' },
    ])
  })

  it('respects alias priority order: first matching rule wins per card', () => {
    const hits = detectEntityMentions([WAN_JIE], '林晚低声说：「晚姐我。」')
    expect(hits).toEqual([
      { ref: 'char:lin-wan', matchedText: '林晚', aliasIndex: 0, kind: 'exact' },
    ])
  })

  it('is case-insensitive for latin aliases by default and strict when caseSensitive', () => {
    const card: DetectableEntity = {
      ref: 'faction:aether',
      aliases: [{ text: 'Aether Guild', kind: 'exact' }],
    }
    expect(detectEntityMentions([card], 'the AETHER GUILD rose.')).toHaveLength(1)
    const strict: DetectableEntity = {
      ref: 'faction:aether',
      aliases: [{ text: 'Aether Guild', kind: 'exact', caseSensitive: true }],
    }
    expect(detectEntityMentions([strict], 'the AETHER GUILD rose.')).toHaveLength(0)
    expect(detectEntityMentions([strict], 'join Aether Guild now')).toHaveLength(1)
  })

  it('falls back to regex variants when no exact rule matches', () => {
    const card: DetectableEntity = {
      ref: 'char:lin-feng',
      aliases: [
        { text: '林枫', kind: 'exact' },
        { text: '林(小)?枫', kind: 'regex' },
      ],
    }
    const hits = detectEntityMentions([card], '林小枫皱了皱眉。')
    expect(hits).toEqual([
      { ref: 'char:lin-feng', matchedText: '林小枫', aliasIndex: 1, kind: 'regex' },
    ])
  })

  it('suppresses only the occurrences overlapping an excluded phrase', () => {
    // 「老王村」压掉嵌在地名里的那次命中，独立出现的「老王」照常命中
    const card: DetectableEntity = {
      ref: 'char:lao-wang',
      aliases: [{ text: '老王', kind: 'exact' }],
      excludedPhrases: ['老王村'],
    }
    expect(detectEntityMentions([card], '他们绕过了老王村。')).toEqual([])
    const hits = detectEntityMentions([card], '老王说，村子叫老王村。')
    expect(hits).toEqual([
      { ref: 'char:lao-wang', matchedText: '老王', aliasIndex: 0, kind: 'exact' },
    ])
  })

  it('falls through to lower-priority rules when the top rule is fully suppressed', () => {
    const card: DetectableEntity = {
      ref: 'concept:hei-sen-lin',
      aliases: [
        { text: '黑暗森林', kind: 'exact' },
        { text: '黑森林', kind: 'exact' },
      ],
      excludedPhrases: ['黑暗森林'],
    }
    const hits = detectEntityMentions([card], '黑暗森林外还有一片黑森林。')
    expect(hits).toEqual([
      { ref: 'concept:hei-sen-lin', matchedText: '黑森林', aliasIndex: 1, kind: 'exact' },
    ])
  })

  it('never reports entities without cards (D6) and one entry per card at most', () => {
    const prose = '林晚与林枫对坐，晚姐沉默。'
    const hits = detectEntityMentions([WAN_JIE], prose)
    expect(hits.map((hit) => hit.ref)).toEqual(['char:lin-wan'])

    const both: DetectableEntity[] = [
      WAN_JIE,
      { ref: 'char:lin-feng', aliases: [{ text: '林枫', kind: 'exact' }] },
    ]
    expect(detectEntityMentions(both, prose).map((hit) => hit.ref)).toEqual([
      'char:lin-wan',
      'char:lin-feng',
    ])
  })

  it('returns nothing for empty text or cards without aliases', () => {
    expect(detectEntityMentions([WAN_JIE], '')).toEqual([])
    expect(detectEntityMentions([{ ref: 'item:x-1' }], 'x-1 在桌上。')).toEqual([])
  })
})
