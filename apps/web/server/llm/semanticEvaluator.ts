/**
 * apps/web/server/llm · 语义分析真 LLM 适配器（T28 · #69；t66 D08/D11/D13/D17）。
 *
 * 这是 `AnalyzeDeps.evaluate`（packages/flywheel/src/semantic/analyze.ts）在生产端的
 * 唯一实现：把「受影响章引用 + receipt 锚点」发到 BYOK 真实端点，收严格 JSON 判定，
 * 回填 verdict / findings / outputTokens。传输层复用既有 SSRF 门禁流式代理
 * （./openaiStream.js streamOpenAiChat），不新增第二条出网路径。
 *
 * 纪律（与 analyze.ts 头注同源，字面落代码）：
 * - advisory-only：本适配器只产出判定文本，不触碰正文/canon/提案/路由；
 * - 绝不静默 mock：端点缺失由调用方收口（不产报告）；上游错误 / 非 JSON / 形状非法
 *   一律抛错 → analyzeSemantic 的 L2 重试 → 全败落 refusal（显式，不伪造报告）；
 * - 输出 ≤512 token 的闸在 analyzeSemantic 内（本适配器只如实计量）。
 */
import { createLocalTokenizer } from '@mozhou/context-compiler'
import type { ExactTokenizer } from '@mozhou/context-compiler'
import type { AffectedRef, SemanticAnalysisReport, SemanticFinding, SemanticVerdict } from '@mozhou/flywheel'
import { streamOpenAiChat } from './openaiStream.js'
import type { ResolvedEndpoint } from './types.js'

/** 判定词表（与 SemanticVerdict 同源；运行时白名单，防模型自造状态）。 */
const VERDICTS: readonly SemanticVerdict[] = ['ok', 'attention', 'refusal']
const SEVERITIES: readonly SemanticFinding['severity'][] = ['info', 'warning']

/**
 * 系统提示：只输出一个 JSON 对象。MUST-NOT 逐条写进提示（不裁决硬冲突、不判事实真伪、
 * 不代作者决策）——语义层是软标定，硬判据归机械层。
 */
export const SEMANTIC_SYSTEM_PROMPT = [
  '你是中文长篇小说的语义旁路审查器。你只做软性标定，不裁决冲突、不判断事实真伪、不替作者做决定。',
  '输入是「受影响章引用 + 编译凭证锚点」的 JSON：affectedRefs 列出上游正典变更波及的章号与变更摘要指纹。',
  '请判断这些章是否值得作者人工复核，并只输出一个 JSON 对象，不要输出任何其他文字或代码块围栏：',
  '{"verdict":"ok|attention|refusal","findings":[{"severity":"info|warning","code":"短标识","message":"一句中文说明"}]}',
  'verdict 语义：ok=未见需要复核的信号；attention=建议作者复核（findings 说明原因）；refusal=输入不足或无法判定。',
  'findings 最多 5 条；没有发现时输出空数组。禁止编造未在输入中出现的事实。',
].join('\n')

export interface SemanticPromptInput {
  readonly anchor: SemanticAnalysisReport['anchor']
  readonly affectedRefs: readonly AffectedRef[]
}

/**
 * 提示装配（D17：diffs 以引用进载荷、不内嵌全文）。导出以便调用方用同一份文本做
 * 输入计量——预算闸与实际出站内容必须同源，否则 token 数无意义。
 */
export function buildSemanticPrompt(input: SemanticPromptInput): { readonly system: string; readonly user: string } {
  return {
    system: SEMANTIC_SYSTEM_PROMPT,
    user: JSON.stringify({ anchor: input.anchor, affectedRefs: input.affectedRefs }),
  }
}

/** 随仓 bge-small-zh-v1.5 词表精确计量（惰性装载；与 draftContext 预算路径同一把尺）。 */
let tokenizerSingleton: ExactTokenizer | null = null
function defaultCountTokens(text: string): number {
  tokenizerSingleton ??= createLocalTokenizer()
  return tokenizerSingleton.count(text)
}

/** 从模型回复里取第一个平衡的 JSON 对象（容忍前后空白/围栏残留；其余原样丢弃）。 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * 严格解析：形状非法即抛（不猜测、不补默认值、不产半成品报告）。
 * 抛错经 analyzeSemantic 的 L2 重试后落 refusal —— 「宁 refused 不静默放行」。
 */
export function parseSemanticReply(text: string): {
  readonly verdict: SemanticVerdict
  readonly findings: readonly SemanticFinding[]
} {
  const json = extractJsonObject(text)
  if (json === null) throw new Error('semantic evaluator: 模型回复中无 JSON 对象')
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch (error) {
    throw new Error(`semantic evaluator: 模型回复 JSON 不可解析（${(error as Error).message}）`)
  }
  const record = asRecord(parsed)
  if (record === null) throw new Error('semantic evaluator: 模型回复不是 JSON 对象')

  const verdict = record['verdict']
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    throw new Error(`semantic evaluator: verdict 非法（${String(verdict)}）`)
  }

  const rawFindings = record['findings']
  if (rawFindings === undefined) throw new Error('semantic evaluator: 缺少 findings 字段')
  if (!Array.isArray(rawFindings)) throw new Error('semantic evaluator: findings 不是数组')

  const findings: SemanticFinding[] = rawFindings.map((raw, index) => {
    const finding = asRecord(raw)
    if (finding === null) throw new Error(`semantic evaluator: findings[${index}] 不是对象`)
    const severity = finding['severity']
    const code = finding['code']
    const message = finding['message']
    if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) {
      throw new Error(`semantic evaluator: findings[${index}].severity 非法（${String(severity)}）`)
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error(`semantic evaluator: findings[${index}].code 缺失`)
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new Error(`semantic evaluator: findings[${index}].message 缺失`)
    }
    return { severity: severity as SemanticFinding['severity'], code, message }
  })

  return { verdict: verdict as SemanticVerdict, findings }
}

export interface SemanticEvaluatorOptions {
  readonly endpoint: ResolvedEndpoint
  /** 精确计量注入（缺省随仓词表）；测试可注入确定性计数器。 */
  readonly countTokens?: ((text: string) => number) | undefined
}

/**
 * 构造 `AnalyzeDeps.evaluate` 的生产实现。
 * 上游错误、SSRF 门禁拒绝、非 JSON 回复均以抛错收口（analyzeSemantic 负责重试与 refusal）。
 */
export function createSemanticEvaluator(
  options: SemanticEvaluatorOptions,
): (input: SemanticPromptInput) => Promise<{
  readonly verdict: SemanticVerdict
  readonly findings: readonly SemanticFinding[]
  readonly outputTokens: number
}> {
  const countTokens = options.countTokens ?? defaultCountTokens
  return async (input) => {
    const prompt = buildSemanticPrompt(input)
    let reply = ''
    for await (const chunk of streamOpenAiChat(options.endpoint, prompt.user, prompt.system)) {
      reply += chunk.delta
    }
    const parsed = parseSemanticReply(reply)
    return { verdict: parsed.verdict, findings: parsed.findings, outputTokens: countTokens(reply) }
  }
}
