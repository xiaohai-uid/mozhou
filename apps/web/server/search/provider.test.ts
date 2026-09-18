// @vitest-environment node
/**
 * 资料检索服务适配器单测 (T11 · Search Provider)。
 */
import { describe, expect, it } from 'vitest'
import {
  ApiSearchProvider,
  InMemorySearchProvider,
  validateSearchQuery,
  type SearchCitation,
} from './provider.js'

describe('Search Provider (T11)', () => {
  it('validateSearchQuery 严格校验查询长度与边界', () => {
    expect(() => validateSearchQuery('')).toThrow(/empty/)
    expect(() => validateSearchQuery('   ')).toThrow(/empty/)
    expect(() => validateSearchQuery(123)).toThrow(/string/)
    expect(() => validateSearchQuery('a'.repeat(201))).toThrow(/200 characters/)
    expect(validateSearchQuery('  唐代夜禁制度  ')).toBe('唐代夜禁制度')
  })

  it('未配置 Key 时 ApiSearchProvider 诚实返回未配置与空列表', async () => {
    const provider = new ApiSearchProvider({ apiKey: '' })
    expect(provider.isConfigured()).toBe(false)

    const result = await provider.search('唐代夜禁')
    expect(result.ok).toBe(false)
    expect(result.configured).toBe(false)
    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(result.error).toContain('PROVIDER_UNAVAILABLE')
  })

  it('InMemorySearchProvider 真实检索匹配与零匹配空结果', async () => {
    const corpus: SearchCitation[] = [
      {
        id: 'src_01',
        title: '唐代长安城坊里制度',
        url: 'https://example.com/tang-chang-an',
        source: 'example.com',
        snippet: '一百零八坊棋盘布局，金吾卫巡夜禁断私行。',
        sourceHash: 'hash_01',
        fetchedAt: '2026-09-18T00:00:00Z',
      },
    ]
    const provider = new InMemorySearchProvider(corpus)
    expect(provider.isConfigured()).toBe(true)

    // 匹配查询
    const matched = await provider.search('长安')
    expect(matched.ok).toBe(true)
    expect(matched.items.length).toBe(1)
    expect(matched.items[0]!.title).toBe('唐代长安城坊里制度')
    expect(matched.items[0]!.url.startsWith('https://')).toBe(true)

    // 无匹配查询：返回空数组，绝不伪造虚假内容
    const empty = await provider.search('绝对不存在的火星遗迹百科')
    expect(empty.ok).toBe(true)
    expect(empty.items).toEqual([])
    expect(empty.total).toBe(0)
  })
})
