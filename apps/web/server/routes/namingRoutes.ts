/**
 * AI 起名路由（OpenWrite 对标切片 · 工单 22）：
 * - POST /api/naming {mode:'ai', category, count?, hint?} → 模型生成名称+释义。
 * - 端点解析走 resolveChatEndpoint（BYOK：环境变量或用户设置）；未配置 → 501
 *   NAMING_NOT_CONFIGURED 诚实报错，绝不返回伪造名称（真实性门禁同族）。
 * - 本地随机摇号（零 AI）在灵感面板 DesktopToolModals，不经过本路由。
 * - 测试接缝：MOZHOU_NAMING_PROVIDER=mock（对齐 MOZHOU_DRAFT_PROVIDER 先例），
 *   仅测试环境使用；生产不设置该变量。
 */
import type { RouteHandler } from '../router.js'
import { resolveChatEndpoint, streamOpenAiChat } from '../llm/openaiStream.js'

export const NAMING_CATEGORIES = ['character', 'sect', 'item', 'place', 'technique'] as const
export type NamingCategory = (typeof NAMING_CATEGORIES)[number]

export const NAMING_CATEGORY_LABELS: Readonly<Record<NamingCategory, string>> = Object.freeze({
  character: '人物名',
  sect: '宗门势力',
  item: '法宝神兵',
  place: '地点场景',
  technique: '功法武学',
})

export const NAMING_DEFAULT_COUNT = 5
export const NAMING_MAX_COUNT = 10
export const NAMING_MAX_HINT_CHARS = 200

export interface NamingSuggestion {
  readonly name: string
  readonly meaning?: string | undefined
}

export interface NamingSuccessResponse {
  readonly ok: true
  readonly mode: 'ai'
  readonly names: readonly NamingSuggestion[]
}

export interface NamingErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

export type NamingResponse = NamingSuccessResponse | NamingErrorResponse

export const NAMING_SYSTEM_PROMPT = '你是中文网文起名助手。只输出合法 JSON 数组，不输出任何其他文字。'

export function buildNamingPrompt(category: NamingCategory, count: number, hint: string): string {
  const label = NAMING_CATEGORY_LABELS[category]
  const trimmedHint = hint.trim()
  return [
    `请为一部中文网络小说生成 ${count} 个「${label}」。`,
    '要求：贴合中文网文语境、朗朗上口、避免与知名作品重名；每个条目附一句不超过 30 字的释义。',
    '只输出 JSON 数组，元素形如 {"name":"名字","meaning":"释义"}。',
    trimmedHint === '' ? '' : `题材与风格提示：${trimmedHint}`,
  ].filter((line) => line !== '').join('\n')
}

/** 容错解析模型输出：截取首个 '[' 到末个 ']' 的 JSON 数组；解析失败返回 null。 */
export function parseNamingNames(raw: string): NamingSuggestion[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const names: NamingSuggestion[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const name = typeof rec['name'] === 'string' ? rec['name'].trim() : ''
    if (name === '') continue
    const meaning = typeof rec['meaning'] === 'string' && rec['meaning'].trim() !== ''
      ? rec['meaning'].trim()
      : undefined
    names.push(meaning === undefined ? { name } : { name, meaning })
    if (names.length >= NAMING_MAX_COUNT) break
  }
  return names
}

function mockNamingNames(category: NamingCategory, count: number): NamingSuggestion[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `mock-${category}-${i + 1}`,
    meaning: 'mock provider 固定释义',
  }))
}

export const namingRoutes: RouteHandler = async (req, res, { path, body, json, principal }) => {
  if (req.method !== 'POST' || path !== '/api/naming') return false

  if (principal === null || principal === undefined) {
    json(401, { ok: false, code: 'UNAUTHORIZED', error: 'authentication required' })
    return true
  }

  if (body['mode'] !== 'ai') {
    json(400, { ok: false, code: 'INVALID_NAMING_REQUEST', error: "mode 仅支持 'ai'（本地随机摇号在灵感面板，零 AI）" })
    return true
  }
  const category = body['category']
  if (typeof category !== 'string' || !(NAMING_CATEGORIES as readonly string[]).includes(category)) {
    json(400, { ok: false, code: 'INVALID_NAMING_REQUEST', error: `category 必须是 ${NAMING_CATEGORIES.join('/')}` })
    return true
  }
  const count = body['count'] ?? NAMING_DEFAULT_COUNT
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > NAMING_MAX_COUNT) {
    json(400, { ok: false, code: 'INVALID_NAMING_REQUEST', error: `count 必须是 1-${NAMING_MAX_COUNT} 的整数` })
    return true
  }
  const hint = typeof body['hint'] === 'string' ? body['hint'] : ''
  if (hint.length > NAMING_MAX_HINT_CHARS) {
    json(400, { ok: false, code: 'INVALID_NAMING_REQUEST', error: `hint 超过 ${NAMING_MAX_HINT_CHARS} 字上限` })
    return true
  }

  // 测试接缝（对齐 MOZHOU_DRAFT_PROVIDER 先例）：仅显式 mock 时返回固定样本。
  if (process.env['MOZHOU_NAMING_PROVIDER'] === 'mock') {
    json(200, { ok: true, mode: 'ai', names: mockNamingNames(category as NamingCategory, count) })
    return true
  }

  const endpoint = resolveChatEndpoint(process.env, principal.userId)
  if (endpoint === null) {
    json(501, {
      ok: false,
      code: 'NAMING_NOT_CONFIGURED',
      error: 'AI 起名需要可用模型：请到「模型设置」配置 API Key 后重试（本地随机摇号无需配置）。',
    })
    return true
  }

  let text = ''
  try {
    for await (const chunk of streamOpenAiChat(endpoint, buildNamingPrompt(category as NamingCategory, count, hint), NAMING_SYSTEM_PROMPT)) {
      text += chunk.delta
    }
  } catch (error) {
    json(502, { ok: false, code: 'NAMING_UPSTREAM_FAILED', error: `模型调用失败：${(error as Error).message}` })
    return true
  }

  const names = parseNamingNames(text)
  if (names === null || names.length === 0) {
    json(502, { ok: false, code: 'NAMING_PARSE_FAILED', error: '模型未返回可解析的 JSON 名称数组，请重试或更换模型。' })
    return true
  }
  json(200, { ok: true, mode: 'ai', names: names.slice(0, count) })
  return true
}
