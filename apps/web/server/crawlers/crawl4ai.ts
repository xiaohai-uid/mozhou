/**
 * crawl4ai 客户端：端侧高级无头浏览器抓取通道（Playwright / Chromium 渲染底座）。
 * 具备自动探活、JS 动态等待 (wait_for) 与清洗后纯净 Markdown (fit_markdown) 提取能力。
 */
import { fetchText, isSafePublicUrl } from './provider-utils.js'

const CRAWL4AI_PORT = 11235
const DEFAULT_ENDPOINT = `http://127.0.0.1:${CRAWL4AI_PORT}`
const TOKEN = process.env['CRAWL4AI_TOKEN'] ?? 'local-dev-token'
const TIMEOUT_MS = 20_000

export interface Crawl4aiResult {
  readonly url: string
  readonly title?: string | undefined
  readonly markdown: string
  readonly html?: string | undefined
}

export interface Crawl4aiOutcome {
  readonly ok: boolean
  readonly results: readonly Crawl4aiResult[]
  readonly error?: string | undefined
}

function resolveCrawlServiceUrl(path: string): string {
  const envUrl = process.env['CRAWL4AI_BASE_URL']
  const base = (typeof envUrl === 'string' && envUrl.startsWith('http')) ? envUrl : DEFAULT_ENDPOINT
  return `${base.replace(/\/+$/, '')}${path}`
}

/**
 * 探活本地 crawl4ai 服务是否在线。
 */
export async function isCrawl4aiAlive(): Promise<boolean> {
  const targetUrl = resolveCrawlServiceUrl('/dashboard')
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(targetUrl, {
      method: 'GET',
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    return res.ok || res.status === 401 || res.status === 404
  } catch {
    return false
  }
}

/**
 * 使用 crawl4ai 抓取单个安全公网 URL，并返回结构化清洗 Markdown。
 */
export async function crawlWithCrawl4ai(
  targetPageUrl: string,
  waitFor?: string | { type: 'css' | 'js'; query: string; timeout?: number },
): Promise<Crawl4aiOutcome> {
  // 严格安全门禁：仅允许经过安全检查的公网 HTTP/HTTPS URL
  if (!isSafePublicUrl(targetPageUrl)) {
    return {
      ok: false,
      results: [],
      error: 'SECURITY_REJECT: 目标 URL 为私有/非安全地址，已被安全策略拦截',
    }
  }

  const body: Record<string, unknown> = { urls: [targetPageUrl], priority: 10 }
  if (waitFor !== undefined) {
    body['wait_for'] =
      typeof waitFor === 'string'
        ? { query: waitFor, type: 'css', timeout: 15_000 }
        : { query: waitFor.query, type: waitFor.type, timeout: waitFor.timeout ?? 15_000 }
  }

  const crawlEndpoint = resolveCrawlServiceUrl('/crawl')
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(crawlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return { ok: false, results: [], error: `crawl4ai HTTP ${res.status}` }
    }

    const data = (await res.json()) as {
      success?: boolean
      results?: Array<{ url?: string; markdown?: unknown; html?: string; title?: string }>
    }

    if (!data.success) {
      return { ok: false, results: [], error: 'crawl4ai 抓取执行未成功' }
    }

    const results: Crawl4aiResult[] = (data.results ?? []).map((r) => {
      const md = r.markdown as { fit_markdown?: string; raw_markdown?: string } | string | null
      const markdown =
        typeof md === 'string' ? md : (md?.fit_markdown ?? md?.raw_markdown ?? '')
      return {
        url: r.url ?? targetPageUrl,
        title: r.title,
        markdown,
        html: r.html,
      }
    })

    return { ok: true, results }
  } catch (err) {
    return { ok: false, results: [], error: (err as Error).message }
  }
}

/**
 * 双轨智能抓取调度器：优先 crawl4ai，不可用时平滑回退到 fetchText。
 */
export async function smartExtractContent(
  targetPageUrl: string,
): Promise<{ ok: boolean; title: string; content: string; channel: 'crawl4ai' | 'http_fallback'; error?: string }> {
  // 安全门禁：拒绝私网、环回与非法协议
  if (!isSafePublicUrl(targetPageUrl)) {
    return {
      ok: false,
      title: '',
      content: '',
      channel: 'http_fallback',
      error: 'SECURITY_REJECT: 目标 URL 为私有/非安全地址，已被安全策略拦截',
    }
  }

  // 1. 优先尝试 crawl4ai 无头提取
  const c4aOutcome = await crawlWithCrawl4ai(targetPageUrl)
  if (c4aOutcome.ok && c4aOutcome.results.length > 0) {
    const res = c4aOutcome.results[0]
    if (res && res.markdown.trim().length > 0) {
      return {
        ok: true,
        title: res.title ?? '未命名正文',
        content: res.markdown,
        channel: 'crawl4ai',
      }
    }
  }

  // 2. 自动回落轻量 HTTP 提取（fetchText 内部自含安全校验）
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
  const httpRes = await fetchText(targetPageUrl, { 'user-agent': UA, accept: 'text/html,text/plain' })
  if (!httpRes.ok) {
    return {
      ok: false,
      title: '',
      content: '',
      channel: 'http_fallback',
      error: httpRes.error ?? `HTTP ${httpRes.status}`,
    }
  }

  const titleMatch = httpRes.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1]?.replace(/<[^>]*>/g, '').trim() ?? '抓取正文' : '抓取正文'
  const textContent = httpRes.body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\n\s*\n/g, '\n\n')
    .trim()

  return {
    ok: textContent.length > 0,
    title,
    content: textContent,
    channel: 'http_fallback',
  }
}
