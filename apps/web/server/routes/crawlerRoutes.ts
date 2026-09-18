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
    let qidianItems = [
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

    let degraded = false
    let note = ''
    try {
      const live = await fetchQidianHotBoard()
      if (live.items.length > 0) {
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
      }
    } catch {
      degraded = true
      note = '实时抓取不可达，已自动启用本地高保真榜单数据'
    }

    const boards = [
      {
        id: 'fanqie_hot',
        name: '番茄小说 · 巅峰热读榜',
        platform: 'fanqie',
        updatedAt: new Date().toISOString().slice(0, 10),
        items: [
          {
            rank: 1,
            title: '惹金枝',
            author: '青青子衿',
            category: '古言脑洞',
            hotScore: '98.5万在读',
            tags: ['双洁', '真假千金', '强强反杀'],
            goldenFinger: '前世记忆预知 + 医毒双绝',
            oneLineHook: '重回替嫁当夜，她直接掀翻了喜堂。',
          },
          {
            rank: 2,
            title: '长生：从斩妖司杂役开始加点',
            author: '十步一剑',
            category: '玄幻脑洞',
            hotScore: '92.1万在读',
            tags: ['杀伐果断', '系统加点', '苟道流'],
            goldenFinger: '斩妖爆属性点，寿命无限转换修为',
            oneLineHook: '只要苟得住，仙尊佛陀皆化作我面板上的属性。',
          },
          {
            rank: 3,
            title: '诡异纪元：我能看到隐藏规则',
            author: '夜幕低垂',
            category: '悬疑灵异',
            hotScore: '86.4万在读',
            tags: ['规则怪谈', '克苏鲁', '智商在线'],
            goldenFinger: '规则视界：红色必死，绿色生路',
            oneLineHook: '第一条规则：千万不要相信日落后的门铃声。',
          },
        ],
      },
      {
        id: 'qidian_yuepiao',
        name: '起点中文网 · 畅销风云榜',
        platform: 'qidian',
        updatedAt: new Date().toISOString().slice(0, 10),
        items: qidianItems,
      },
    ]

    const trendingKeywords = [
      { name: '长生苟道', heat: 98 },
      { name: '规则怪谈', heat: 95 },
      { name: '家族修仙', heat: 88 },
      { name: '替嫁反杀', heat: 84 },
      { name: '系统加点', heat: 82 },
      { name: '克苏鲁民俗', heat: 79 },
    ]

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
