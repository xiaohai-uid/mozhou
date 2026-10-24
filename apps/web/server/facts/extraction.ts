/**
 * apps/web/server/facts · 章后事实提取（#117 第一查事件 + #118 第二查人物心理状态）。
 *
 * 生成缝与行内编辑流同源：resolveGenerationTarget 单缝（注册表→BYOK）+
 * streamOpenAiChat（HTTPS-only + SSRF 门）；mock 判据共用 isMockDraftProviderMode。
 * 模型输出要求结构化 JSON；解析失败显式报错，绝不静默落空（规格 Testing Decisions）。
 * 心理状态候选载荷含人物标识（character）与前后状态（before / after），
 * 摘要由三字段确定性派生（psychStateSummary），mock 与解析共用同一口径。
 */
import type { FactCandidatePayload, FactKind } from '@mozhou/data-plane'

export interface ExtractedFactCandidate {
  readonly kind: FactKind
  readonly payload: FactCandidatePayload
  readonly evidence: string
}

/** 心理状态候选的展示摘要：由人物标识与前后状态确定性派生。 */
export function psychStateSummary(character: string, before: string, after: string): string {
  return `${character}：${before} → ${after}`
}

/** 单查上限：与提示词一致，防超长输出打爆账本。 */
const MAX_FACTS_PER_KIND = 8

export const FACT_EXTRACTION_SYSTEM_PROMPT =
  '你是中文网文的事实记录员。读完整章正文，只输出 JSON：' +
  '{"events":[{"summary":"一句话事件","evidence":"原文依据摘句"}],' +
  '"psychological_states":[{"character":"人物名","before":"之前心理状态","after":"之后心理状态","evidence":"原文依据摘句"}]}。' +
  'events 记录该章发生的关键事件（不超过 8 条）；' +
  'psychological_states 记录人物心理状态从前到后的变化（不超过 8 条，只记确实发生了变化的人物，没有变化就输出空数组）；' +
  '两类没有就输出空数组；evidence 必须摘自原文原句。不要输出解释、不要 markdown 代码块以外的任何文字。'

export function buildFactExtractionUserPrompt(chapterIndex: number, proseBody: string): string {
  return `【任务】提取第 ${chapterIndex} 章的关键事件事实与人物心理状态变化。\n【正文】\n${proseBody}`
}

/** mock 提取：确定性产出（测试与演示），证据取正文首句；人物标识锚定正文开头两字。 */
export function mockFactExtraction(chapterIndex: number, proseBody: string): ExtractedFactCandidate[] {
  const sentences = proseBody
    .split(/(?<=[。！？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const first = sentences[0] ?? ''
  if (first.length === 0) {
    return []
  }
  const mockCharacter = first.slice(0, 2)
  const mockBefore = '平静'
  const mockAfter = '戒备'
  return [
    {
      kind: 'event',
      payload: { summary: `第${chapterIndex}章事件：${first.slice(0, 24)}` },
      evidence: first.slice(0, 60),
    },
    {
      kind: 'psychological_state',
      payload: {
        summary: psychStateSummary(mockCharacter, mockBefore, mockAfter),
        character: mockCharacter,
        before: mockBefore,
        after: mockAfter,
      },
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

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析模型输出为候选事实。形状违例宁抛不猜（S5 纪律）：两类数组都必填
 * （无内容输出空数组），每查上限 8 条，心理状态条目必须含非空
 * character / before / after / evidence。
 */
export function parseFactExtractionOutput(raw: string): ExtractedFactCandidate[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(raw))
  } catch (error) {
    throw new Error(`FACT_EXTRACTION_PARSE_FAILED: ${(error as Error).message}`)
  }
  const container = parsed as Record<string, unknown>
  const events = container['events']
  if (!Array.isArray(events)) {
    throw new Error('FACT_EXTRACTION_PARSE_FAILED: events array missing')
  }
  const states = container['psychological_states']
  if (!Array.isArray(states)) {
    throw new Error('FACT_EXTRACTION_PARSE_FAILED: psychological_states array missing')
  }
  const candidates: ExtractedFactCandidate[] = []
  for (const entry of events.slice(0, MAX_FACTS_PER_KIND)) {
    const item = entry as Record<string, unknown>
    const summary = trimmedString(item['summary'])
    const evidence = trimmedString(item['evidence'])
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
  for (const entry of states.slice(0, MAX_FACTS_PER_KIND)) {
    const item = entry as Record<string, unknown>
    const character = trimmedString(item['character'])
    const before = trimmedString(item['before'])
    const after = trimmedString(item['after'])
    const evidence = trimmedString(item['evidence'])
    if (character.length === 0 || before.length === 0 || after.length === 0 || evidence.length === 0) {
      throw new Error('FACT_EXTRACTION_PARSE_FAILED: psychological_states entry requires non-empty character, before, after and evidence')
    }
    candidates.push({
      kind: 'psychological_state',
      payload: { summary: psychStateSummary(character, before, after), character, before, after },
      evidence,
    })
  }
  return candidates
}
