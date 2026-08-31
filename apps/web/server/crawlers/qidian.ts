/**
 * 起点中文网移动端真实公开搜索抓取适配器。
 */
import { decodeHtml, fetchText } from './provider-utils.js'

export interface CrawledBook {
  readonly platform: 'qidian' | 'qimao' | 'fanqie'
  readonly platformName: string
  readonly bookId: string
  readonly title: string
  readonly author: string
  readonly category: string | null
  readonly status: string | null
  readonly intro?: string | undefined
  readonly url: string
}

const SEARCH_URL = 'https://m.qidian.com/search?kw='
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'

function firstMatch(html: string, expression: RegExp): string {
  return decodeHtml(html.match(expression)?.[1] ?? '')
}

function parseCards(html: string): CrawledBook[] {
  const books: CrawledBook[] = []
  const cardRe = /<a\b[^>]*data-bid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(cardRe)) {
    const bookId = match[1] ?? ''
    const card = match[2] ?? ''
    const title = firstMatch(card, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
    const author = firstMatch(
      card,
      /<p\b[^>]*class=["'][^"']*searchBookAuthor[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )
    const tagBlock =
      card.match(/<div\b[^>]*class=["'][^"']*tags[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
    const tags = [...tagBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((item) =>
      decodeHtml(item[1] ?? ''),
    )
    const intro = firstMatch(
      card,
      /<p\b[^>]*class=["'][^"']*searchBookIntro[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    )
    if (!bookId || !title || !author) continue

    books.push({
      platform: 'qidian',
      platformName: '起点中文网',
      bookId,
      title,
      author,
      category: tags[0] || null,
      status: tags[1] || null,
      intro: intro || undefined,
      url: `https://m.qidian.com/book/${bookId}/`,
    })
    if (books.length >= 10) break
  }
  return books
}

export async function searchQidian(query: string): Promise<{ ok: boolean; books: CrawledBook[]; note?: string }> {
  const q = query.trim()
  if (!q) return { ok: true, books: [] }
  const res = await fetchText(SEARCH_URL + encodeURIComponent(q), {
    'user-agent': UA,
    accept: 'text/html,application/xhtml+xml',
  })
  if (!res.ok) {
    return { ok: false, books: [], note: `起点搜索失败: ${res.error ?? String(res.status)}` }
  }
  try {
    return { ok: true, books: parseCards(res.body) }
  } catch (error) {
    return { ok: false, books: [], note: (error as Error).message }
  }
}
