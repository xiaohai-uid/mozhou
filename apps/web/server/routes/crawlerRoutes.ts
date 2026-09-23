/**
 * apps/web · 爬虫抓取、书源检索、热榜与联网搜索路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { searchMultipleSources } from '../crawlers/multisource.js'
import { fetchQidianHotBoard } from '../crawlers/rankings.js'
import { smartExtractContent } from '../crawlers/crawl4ai.js'
import { defaultSearchProvider } from '../search/provider.js'

export const crawlerRoutes: RouteHandler = async (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  /* ---- 网文榜单扫描端点 ---- */
  if (path === '/api/rank-scan') {
    let qidianItems: {
      rank: number
      title: string
      author: string
      category: string
      hotScore: string
      tags: string[]
      goldenFinger: string
      oneLineHook: string
    }[] = []

    let degraded = false
    let note = ''

    const isDemoMode = process.env['MOZHOU_DEMO_DATA'] === '1'

    if (isDemoMode) {
      degraded = true
      note = '当前为显式启用的演示数据模式（Demo Environment）'
      qidianItems = [
        {
          rank: 1,
          title: '道诡异仙',
          author: '狐尾的笔',
          category: '东方玄幻',
          hotScore: '月票 12.8万',
          tags: ['克苏鲁', '修仙', '心素', '民俗'],
          goldenFinger: '迷惘心素：认知即现实，真假难辨',
          oneLineHook: '李火旺分不清现实与幻觉，但他知道大千录上的名字都要死。',
        },
        {
          rank: 2,
          title: '宿命之环',
          author: '爱潜水的乌贼',
          category: '西方奇幻',
          hotScore: '月票 9.6万',
          tags: ['诡秘世界', '塔罗会', '猎人途径'],
          goldenFinger: '宿命之环受契者：向未知伟大存在借取权柄',
          oneLineHook: '在科尔杜村的迷雾中，卢米安点燃了第一簇猎人之火。',
        },
        {
          rank: 3,
          title: '赤心巡天',
          author: '情何以甚',
          category: '古典仙侠',
          hotScore: '月票 8.4万',
          tags: ['正统修真', '群像演义', '家国天下'],
          goldenFinger: '天生神魂明净，开脉通天第一人',
          oneLineHook: '山河万里，我以此剑巡天！',
        },
      ]
    } else {
      try {
        const live = await fetchQidianHotBoard()
        if (live.ok && live.items.length > 0) {
          qidianItems = live.items.map((it) => ({
            rank: it.rank,
            title: it.title,
            author: it.author,
            category: it.category,
            hotScore: it.hotScore,
            tags: it.tags.slice(0, 4),
            goldenFinger: it.goldenFinger,
            oneLineHook: it.oneLineHook,
          }))
          if (!live.ok) {
            degraded = true
            note = live.note ?? '起点数据源降级为备用通道'
          }
        } else {
          degraded = true
          note = live.note ?? '起点热榜实时抓取暂不可用，未回退伪造数据'
        }
      } catch (err) {
        degraded = true
        note = `实时抓取异常: ${(err as Error).message}`
      }
    }

    const boards = [
      {
        id: 'qidian_yuepiao',
        name: '起点中文网 · 畅销风云榜',
        platform: 'qidian' as const,
        updatedAt: new Date().toISOString().slice(0, 10),
        items: qidianItems,
      },
    ]

    const trendingKeywords = qidianItems.length > 0
      ? Array.from(new Set(qidianItems.flatMap((it) => it.tags))).slice(0, 6).map((name, i) => ({
          name,
          heat: 95 - i * 4,
        }))
      : []

    json(200, {
      ok: true,
      boards,
      trendingKeywords,
      ...(degraded ? { degraded: true, note } : {}),
    })
    return true
  }

  /* ---- 端侧多源实时书源检索 ---- */
  if (path === '/api/book-source.search') {
    const query = typeof body['query'] === 'string' ? body['query'].trim() : ''
    const outcome = await searchMultipleSources(query)
    json(200, {
      ok: true,
      query: outcome.query,
      total: outcome.total,
      books: outcome.books,
      degraded: outcome.degraded,
      notes: outcome.notes,
    })
    return true
  }

  /* ---- crawl4ai 网页正文深度提取端点 ---- */
  if (path === '/api/crawler.extract') {
    const url = typeof body['url'] === 'string' ? body['url'].trim() : ''
    if (!url) {
      json(400, { ok: false, error: 'url required' })
      return true
    }
    const extractResult = await smartExtractContent(url)
    json(200, {
      ok: extractResult.ok,
      title: extractResult.title,
      content: extractResult.content,
      channel: extractResult.channel,
      error: extractResult.error,
    })
    return true
  }

  /* ---- 联网搜索端点 ---- */
  if (path === '/api/web-search') {
    const rawQuery = typeof body['query'] === 'string' ? body['query'].trim() : ''
    const hotQueries = ['唐代夜禁', '山海经异兽', '金丹品阶', '克苏鲁神话', '古代称谓', '官制职级']

    if (rawQuery.length === 0) {
      json(200, {
        ok: true,
        query: '',
        results: [],
        hotQueries,
      })
      return true
    }

    if (rawQuery.length > 200) {
      json(400, { ok: false, code: 'INVALID_QUERY', error: 'query length must not exceed 200 characters' })
      return true
    }

    const outcome = await defaultSearchProvider.search(rawQuery)
    if (!outcome.ok) {
      json(501, {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        error: outcome.error ?? '搜索服务不可用',
      })
      return true
    }

    json(200, {
      ok: true,
      query: rawQuery,
      results: outcome.items,
      hotQueries,
    })
    return true
  }

  return false
}
