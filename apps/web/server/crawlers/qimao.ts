/**
 * 七猫小说官方公开搜索 API 适配器。
 */
import { fetchText } from './provider-utils.js'
import type { CrawledBook } from './qidian.js'

const SEARCH_URL = 'https://www.qimao.com/api/search/result?keyword='
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

export async function searchQimao(query: string): Promise<{ ok: boolean; books: CrawledBook[]; note?: string }> {
  const q = query.trim()
  if (!q) return { ok: true, books: [] }

  const res = await fetchText(
    `${SEARCH_URL}${encodeURIComponent(q)}&page=1&page_size=10`,
    {
      'user-agent': UA,
      accept: 'application/json',
      referer: 'https://www.qimao.com/search/index/',
    },
  )

  if (!res.ok) {
    return { ok: false, books: [], note: `七猫搜索失败: ${res.error ?? String(res.status)}` }
  }

  try {
    const json = JSON.parse(res.body) as {
      data?: {
        search_list?: Array<{
          book_id?: string | number
          title?: string
          author?: string
          category2_name?: string
          is_over_txt?: string
          read_url?: string
          intro?: string
        }>
      }
    }
    const books = (json.data?.search_list ?? [])
      .map((item) => {
        const bookId = String(item.book_id ?? '')
        return {
          platform: 'qimao' as const,
          platformName: '七猫小说',
          bookId,
          title: item.title?.trim() ?? '',
          author: item.author?.trim() || '佚名',
          category: item.category2_name?.trim() || null,
          status: item.is_over_txt?.trim() || null,
          intro: item.intro?.trim() || undefined,
          url: item.read_url?.trim() || `https://www.qimao.com/shuku/${bookId}/`,
        }
      })
      .filter((b) => b.bookId && b.title)

    return { ok: true, books }
  } catch (error) {
    return { ok: false, books: [], note: (error as Error).message }
  }
}
