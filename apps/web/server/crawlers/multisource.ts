/**
 * 多源并发检索聚合引擎（起点、七猫、番茄）。
 * 容错并发调度：单个源超时或反爬失败不影响其余源，聚合返回并提供去重与降级信息。
 */
import { searchQidian, type CrawledBook } from './qidian.js'
import { searchQimao } from './qimao.js'

export interface MultiSourceSearchOutcome {
  readonly ok: true
  readonly query: string
  readonly total: number
  readonly books: readonly CrawledBook[]
  readonly degraded: boolean
  readonly notes: readonly string[]
}

export async function searchMultipleSources(query: string): Promise<MultiSourceSearchOutcome> {
  const clean = query.trim()
  if (!clean) {
    return {
      ok: true,
      query: clean,
      total: 0,
      books: [],
      degraded: false,
      notes: [],
    }
  }

  const [qidianRes, qimaoRes] = await Promise.allSettled([
    searchQidian(clean),
    searchQimao(clean),
  ])

  const books: CrawledBook[] = []
  const notes: string[] = []
  let degraded = false

  if (qidianRes.status === 'fulfilled') {
    if (qidianRes.value.ok) {
      books.push(...qidianRes.value.books)
    } else {
      degraded = true
      if (qidianRes.value.note) notes.push(qidianRes.value.note)
    }
  } else {
    degraded = true
    notes.push(`起点异常: ${qidianRes.reason?.message ?? '超时'}`)
  }

  if (qimaoRes.status === 'fulfilled') {
    if (qimaoRes.value.ok) {
      books.push(...qimaoRes.value.books)
    } else {
      degraded = true
      if (qimaoRes.value.note) notes.push(qimaoRes.value.note)
    }
  } else {
    degraded = true
    notes.push(`七猫异常: ${qimaoRes.reason?.message ?? '超时'}`)
  }

  // 按书名 + 作者组合去重
  const seen = new Set<string>()
  const uniqueBooks = books.filter((b) => {
    const key = `${b.title}__${b.author}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    ok: true,
    query: clean,
    total: uniqueBooks.length,
    books: uniqueBooks,
    degraded,
    notes,
  }
}
