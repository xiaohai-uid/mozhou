/**
 * apps/web/server/search · 真实资料检索与榜单引用适配器 (Search Provider · T11)。
 * 
 * 依照 reference/02-features.md T11 规格：
 * - 接入商业化检索服务（支持 Bocha / Bing / SerpAPI 等开放 API 及测试适配器）；
 * - 严格校验输入 Schema：query trim 后 1–200 字符；
 * - 真实无结果返回空数组，坚决消除伪造假数据（ALL_KNOWLEDGE）；
 * - 每条引用记录 title / url / sourceHash / fetchedAt / snippet；
 * - SSRF 防护：严格校验出站 URL 为公网 HTTP/HTTPS。
 */
import { createHash } from 'node:crypto'
import { isSafePublicUrl } from '../crawlers/provider-utils.js'

export interface SearchCitation {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly source: string
  readonly snippet: string
  readonly sourceHash: string
  readonly fetchedAt: string
}

export interface SearchExecutionResult {
  readonly ok: boolean
  readonly query: string
  readonly items: readonly SearchCitation[]
  readonly total: number
  readonly configured: boolean
  readonly error?: string | undefined
}

export interface ISearchProvider {
  readonly name: string
  isConfigured(): boolean
  search(query: string): Promise<SearchExecutionResult>
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function validateSearchQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') {
    throw new Error('INVALID_QUERY: query must be a string')
  }
  const query = rawQuery.trim()
  if (query.length === 0) {
    throw new Error('INVALID_QUERY: query must not be empty')
  }
  if (query.length > 200) {
    throw new Error('INVALID_QUERY: query length must not exceed 200 characters')
  }
  return query
}

/* ============================================================================
 * 通用商业搜索适配器 (支持配置化 API 端点与 Key)
 * ========================================================================== */

export class ApiSearchProvider implements ISearchProvider {
  readonly name: string
  private readonly _apiKey: string | null
  private readonly _endpoint: string

  constructor(options: { name?: string; apiKey?: string; endpoint?: string } = {}) {
    this.name = options.name ?? 'commercial-search'
    this._apiKey = options.apiKey ?? process.env['SEARCH_API_KEY'] ?? process.env['BOCHA_API_KEY'] ?? null
    this._endpoint = options.endpoint ?? process.env['SEARCH_API_URL'] ?? 'https://api.bocha.cn/v1/web-search'
  }

  isConfigured(): boolean {
    return Boolean(this._apiKey && this._apiKey.trim().length > 0)
  }

  async search(rawQuery: string): Promise<SearchExecutionResult> {
    const query = validateSearchQuery(rawQuery)

    if (!this.isConfigured()) {
      return {
        ok: false,
        query,
        items: [],
        total: 0,
        configured: false,
        error: 'PROVIDER_UNAVAILABLE: 检索服务未配置 API Key（SEARCH_API_KEY / BOCHA_API_KEY）',
      }
    }

    try {
      if (!isSafePublicUrl(this._endpoint)) {
        throw new Error(`SSRF 门禁：拒绝调用非安全或私有目标 ${this._endpoint}`)
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)

      const res = await fetch(this._endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this._apiKey}`,
        },
        body: JSON.stringify({ query, count: 10 }),
        signal: controller.signal,
        redirect: 'manual',
      })
      clearTimeout(timer)

      if (!res.ok) {
        return {
          ok: false,
          query,
          items: [],
          total: 0,
          configured: true,
          error: `UPSTREAM_ERROR: search upstream returned HTTP ${res.status}`,
        }
      }

      const data = (await res.json()) as { data?: { webPages?: { value?: { name?: string; url?: string; snippet?: string; siteName?: string }[] } } }
      const rawPages = data?.data?.webPages?.value ?? []
      const now = new Date().toISOString()

      const items: SearchCitation[] = []
      for (const p of rawPages) {
        if (!p.url || (!p.url.startsWith('https://') && !p.url.startsWith('http://'))) continue
        const title = p.name || '无标题'
        const snippet = p.snippet || ''
        items.push({
          id: 'src_' + sha256(p.url).slice(0, 16),
          title,
          url: p.url,
          source: p.siteName || new URL(p.url).hostname,
          snippet,
          sourceHash: sha256(title + '\n' + snippet),
          fetchedAt: now,
        })
      }

      return {
        ok: true,
        query,
        items,
        total: items.length,
        configured: true,
      }
    } catch (err) {
      return {
        ok: false,
        query,
        items: [],
        total: 0,
        configured: true,
        error: `SEARCH_FAILED: ${(err as Error).message}`,
      }
    }
  }
}

/* ============================================================================
 * 测试专用内存搜索适配器 (确定性断言)
 * ========================================================================== */

export class InMemorySearchProvider implements ISearchProvider {
  readonly name = 'in-memory-search'
  private readonly _corpus: SearchCitation[]

  constructor(fixtures: SearchCitation[] = []) {
    this._corpus = [...fixtures]
  }

  isConfigured(): boolean {
    return true
  }

  search(rawQuery: string): Promise<SearchExecutionResult> {
    const query = validateSearchQuery(rawQuery)
    const lower = query.toLowerCase()
    const matched = this._corpus.filter(
      (c) => c.title.toLowerCase().includes(lower) || c.snippet.toLowerCase().includes(lower),
    )

    return Promise.resolve({
      ok: true,
      query,
      items: matched,
      total: matched.length,
      configured: true,
    })
  }
}

export const defaultSearchProvider = new ApiSearchProvider()
