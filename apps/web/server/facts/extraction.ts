/**
 * apps/web/server/facts · 章后事实提取（#117 · 两查第一查：章节事件）。
 *
 * 生成缝与行内编辑流同源：resolveGenerationTarget 单缝（注册表→BYOK）+
 * streamOpenAiChat（HTTPS-only + SSRF 门）；mock 判据共用 isMockDraftProviderMode。
 * 模型输出要求结构化 JSON；解析失败显式报错，绝不静默落空（规格 Testing Decisions）。
 */
import type { FactKind } from '@mozhou/data-plane'

export interface ExtractedFactCandidate {
  readonly kind: FactKind
  readonly payload: { readonly summary: string; readonly detail?: string }
  readonly evidence: string
}

export const FACT_EXTRACTION_SYSTEM_PROMPT =
  '你是中文网文的事实记录员。读完整章正文，只输出 JSON：{"events":[{"summary":"一句话事件","evidence":"原文依据摘句"}]}。' +
  'summary 记录该章发生的关键事件（不超过 8 条）；evidence 必须摘自原文原句。不要输出解释、不要 markdown 代码块以外的任何文字。'

export function buildFactExtractionUserPrompt(chapterIndex: number, proseBody: string): string {
  return `【任务】提取第 ${chapterIndex} 章的关键事件事实。\n【正文】\n${proseBody}`
}

/** mock 提取：确定性产出（测试与演示），证据取正文首句。 */
export function mockFactExtraction(chapterIndex: number, proseBody: string): ExtractedFactCandidate[] {
  const sentences = proseBody
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const first = sentences[0] ?? ''
  if (first.length === 0) {
    return []
  }
  return [
    {
      kind: 'event',
      payload: { summary: `第${chapterIndex}章事件：${first.slice(0, 24)}` },
      evidence: first.slice(0, 60),
    },
  ]
}

/** 剥掉模型可能包裹的 markdown 代码围栏，取首个 { 到末个 } 的 JSON 段。 */
function stripJsonFence(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('FACT_EXTRACTION_PARSE_FAILED: model output contains no JSON object')
  }
  return raw.slice(start, end + 1)
}

/**
 * 解析模型输出为候选事实。形状违例宁抛不猜（S5 纪律）；
 * 上限 8 条事件（与提示词一致，防超长输出打爆账本）。
 */
export function parseFactExtractionOutput(raw: string): ExtractedFactCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(raw))
  } catch (error) {
    throw new Error(`FACT_EXTRACTION_PARSE_FAILED: ${(error as Error).message}`)
  }
  const events = (parsed as { events?: unknown })['events']
  if (!Array.isArray(events)) {
    throw new Error('FACT_EXTRACTION_PARSE_FAILED: events array missing')
  }
  const candidates: ExtractedFactCandidate[] = []
  for (const entry of events.slice(0, 8)) {
    const item = entry as Record<string, unknown>
    const summary = typeof item['summary'] === 'string' ? item['summary'].trim() : ''
    const evidence = typeof item['evidence'] === 'string' ? item['evidence'].trim() : ''
    if (summary.length === 0 || evidence.length === 0) {
      throw new Error('FACT_EXTRACTION_PARSE_FAILED: event entry requires non-empty summary and evidence')
    }
    const detail = typeof item['detail'] === 'string' && item['detail'].trim().length > 0 ? item['detail'].trim() : undefined
    candidates.push({
      kind: 'event',
      payload: { summary, ...(detail !== undefined ? { detail } : {}) },
      evidence,
    })
  }
  return candidates
}
