/**
 * 多平台网文排行榜抓取与降级引擎。
 * 在线实时抓取公开榜源，失败时自动降级并标记 degraded。
 */
import { fetchText } from './provider-utils.js'

export interface RankingItem {
  readonly rank: number
  readonly title: string
  readonly author: string
  readonly category: string
  readonly hotScore: string
  readonly tags: readonly string[]
  readonly goldenFinger: string
  readonly oneLineHook: string
}

export interface RankBoard {
  readonly id: string
  readonly name: string
  readonly platform: 'fanqie' | 'qidian' | 'jjwxc'
  readonly updatedAt: string
  readonly items: readonly RankingItem[]
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'

/** 起点移动端热销榜爬取 */
export async function fetchQidianHotBoard(): Promise<{ ok: boolean; items: RankingItem[]; note?: string }> {
  const url = 'https://m.qidian.com/rank/hotsales/'
  const res = await fetchText(url, { 'user-agent': UA, accept: 'text/html' }, 8000)
  if (!res.ok) {
    return { ok: false, items: [], note: `起点热榜上游请求失败: ${res.error ?? String(res.status)}` }
  }

  try {
    const items: RankingItem[] = []
    const cardRe = /<a\b[^>]*data-bid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let rank = 1

    for (const match of res.body.matchAll(cardRe)) {
      const card = match[2] ?? ''
      const titleMatch = card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)
      const authorMatch = card.match(/<p\b[^>]*class=["'][^"']*searchBookAuthor[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)
      const title = titleMatch ? titleMatch[1]?.replace(/<[^>]*>/g, '').trim() : ''
      const author = authorMatch ? authorMatch[1]?.replace(/<[^>]*>/g, '').trim() : ''

      if (!title) continue

      items.push({
        rank,
        title,
        author: author || '知名作家',
        category: '畅销热门',
        hotScore: `热榜第 ${rank} 位`,
        tags: ['热门连载', '全网畅销'],
        goldenFinger: '前沿主线设定',
        oneLineHook: '起点风云榜当前霸榜力作。',
      })
      rank += 1
      if (items.length >= 10) break
    }

    return { ok: items.length > 0, items }
  } catch (error) {
    return { ok: false, items: [], note: (error as Error).message }
  }
}
