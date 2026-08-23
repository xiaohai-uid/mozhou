import { describe, expect, it } from 'vitest'
import { emitFrontmatter, parseFrontmatter } from './yaml-frontmatter.js'

describe('yaml-frontmatter emit→parse 往返', () => {
  it('round-trips the frozen Q13 field shapes byte-stable', () => {
    const fields = {
      mozhouId: 'book_01M0QT40Q36SNCVZ8HYTK05JH6',
      nodeType: 'book',
      parentId: null,
      orderIndex: 0,
      revision: 3,
      status: 'drafted',
      originAuthor: true,
      protected: true,
      dependencyNodeIds: [],
    }
    const emitted = emitFrontmatter(fields)
    // 确定性发射：同状态两次发射逐字节一致，且 id 不带引号可 grep
    expect(emitted).toBe(emitFrontmatter(fields))
    expect(emitted).toContain('mozhouId: book_')

    const parsed = parseFrontmatter(emitted)
    expect(parsed.data).toEqual(fields)
    expect(parsed.body).toBe('')
  })

  it('round-trips Chinese plain scalars, quoting-needing strings and embedded newlines', () => {
    const fields = {
      title: '凡人修仙传',
      tricky: '有冒号: 与 #井注 的值',
      numericLooking: '42',
      multiline: '第一行\n第二行',
      tags: ['主角', '雷系'],
    }
    const parsed = parseFrontmatter(emitFrontmatter(fields))
    expect(parsed.data).toEqual(fields)
  })

  it('round-trips T2 alias record arrays as greppable one-line-per-alias flow maps', () => {
    const fields = {
      ref: 'char:lin-feng',
      name: '林枫',
      aliases: [
        { text: '林枫', kind: 'exact' },
        { text: '枫儿', kind: 'exact' },
        { text: 'Lin Feng', kind: 'exact', caseSensitive: true },
        { text: '林(小)?枫', kind: 'regex' },
      ],
    }
    const emitted = emitFrontmatter(fields)
    expect(emitted).toContain('- {text: 林枫, kind: exact}')
    expect(emitted).toContain('- {text: Lin Feng, kind: exact, caseSensitive: true}')

    const parsed = parseFrontmatter(emitted)
    expect(parsed.data).toEqual(fields)
  })

  it('accepts externally authored flow sequences and block scalars (entity-directory-spec §3 形态)', () => {
    const document = parseFrontmatter(
      [
        '---',
        'ref: char:x',
        'excludedPhrases: [枫叶林, "含 空格"]',
        'brief: >-',
        '  青云宗外门弟子，',
        '  身怀雷灵根……',
        'notes: |',
        '  字面行一',
        '  字面行二',
        '---',
        '',
      ].join('\n'),
    )
    expect(document.data['excludedPhrases']).toEqual(['枫叶林', '含 空格'])
    // 折叠标量：换行折空格；strip 尾无换行
    expect(document.data['brief']).toBe('青云宗外门弟子， 身怀雷灵根……')
    // 字面标量：逐行保留换行（clip 尾单换行）
    expect(document.data['notes']).toBe('字面行一\n字面行二\n')
  })

  it('carries the body region after the closing delimiter', () => {
    const document = parseFrontmatter(`${emitFrontmatter({ mozhouId: 'aint_x' })}# 标题\n\n正文\n`)
    expect(document.data['mozhouId']).toBe('aint_x')
    expect(document.body).toBe('# 标题\n\n正文\n')
  })

  it('rejects malformed or unsupported structures loudly', () => {
    expect(() => parseFrontmatter('no frontmatter here')).toThrow()
    expect(() => parseFrontmatter('---\nk: v\n----\n')).toThrow() // `\n----` 不是结束符
    expect(() => parseFrontmatter('---\n{k: v}\n---\n')).toThrow()
    expect(() => parseFrontmatter('---\n- a\n- b\n---\n')).toThrow() // 序列项游离于键之外
    expect(() => parseFrontmatter('---\nk: {a: b}\n---\n')).toThrow() // 键值位的内联映射不支持
    expect(() => parseFrontmatter('---\nk: [a, b\n---\n')).toThrow() // 流序列未闭合
    expect(() => parseFrontmatter('---\nk:\n- {a: b}\n- plain\n---\n')).toThrow() // 记录/标量混排
  })
})
