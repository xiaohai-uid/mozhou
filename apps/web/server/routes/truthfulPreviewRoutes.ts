/**
 * Technical Preview truthfulness gate.
 *
 * These routes intentionally fail closed until a real provider/source is wired. They
 * run before legacy/demo route handlers so placeholder datasets can never be presented
 * to users as live analysis, web search, or ranking data.
 * 
 * T11: 当未配置真实检索/榜单服务时保持 501 诚实报错（WEB_SEARCH_NOT_CONFIGURED / RANK_SOURCE_NOT_CONFIGURED），
 * 配置真实源后放行至领域爬虫/检索适配器。
 */
import type { RouteHandler } from '../router.js'
import { defaultSearchProvider } from '../search/provider.js'

export const truthfulPreviewRoutes: RouteHandler = (req, _res, { path, json }) => {
  if (req.method !== 'POST') return false

  if (path === '/api/novel-breakdown') {
    json(501, {
      ok: false,
      code: 'NOVEL_BREAKDOWN_NOT_IMPLEMENTED',
      error: '小说拆解尚未接入真实分析 provider；Technical Preview 不返回示例分析冒充结果。',
    })
    return true
  }

  if (path === '/api/web-search' && !defaultSearchProvider.isConfigured()) {
    json(501, {
      ok: false,
      code: 'WEB_SEARCH_NOT_CONFIGURED',
      error: '联网搜索尚未接入真实外部搜索源；Technical Preview 不返回内置示例冒充联网结果。',
    })
    return true
  }

  if (path === '/api/rank-scan' && process.env['MOZHOU_LIVE_RANKINGS'] !== '1') {
    json(501, {
      ok: false,
      code: 'RANK_SOURCE_NOT_CONFIGURED',
      error: '网文榜单尚未接入可验证的实时数据源；Technical Preview 不返回静态示例榜单。',
    })
    return true
  }

  return false
}
