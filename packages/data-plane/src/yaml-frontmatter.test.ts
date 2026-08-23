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

  it('round-trips Chinese plain scalars and quoting-needing strings', () => {
    const fields = {
      title: '凡人修仙传',
      tricky: '有冒号: 与 #井注 的值',
      numericLooking: '42',
      tags: ['主角', '雷系'],
    }
    const parsed = parseFrontmatter(emitFrontmatter(fields))
    expect(parsed.data).toEqual(fields)
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
    expect(() => parseFrontmatter('---\nk:\n- {a: b}\n---\n')).toThrow()
    // 标量以外的值类型（对象）发射即抛，不静默产出脏 YAML
    const badFields = { nested: [{ inner: 'x' }] } as unknown as Record<string, string>
    expect(() => emitFrontmatter(badFields)).toThrow()
  })
})
