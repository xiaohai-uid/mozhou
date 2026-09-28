/**
 * 草稿流 NDJSON 协议的唯一客户端实现。
 *
 * /api/draft.stream 的帧契约（发射端 apps/web/server/routes/pipelineRoutes.ts:533-584 是真源）：
 *   start  { ok:true,  event:'start', candidateId, prompt, contextMode, contextTokens, provider, base }
 *   delta  { ok:true,  event:'delta', candidateId, text }
 *   done   { ok:true,  event:'done',  candidateId, outcome, partial, chars }
 *   error  { ok:false, event:'error', candidateId?, outcome?, partial?, chars?, error }
 *
 * 两条纪律：
 * 1. 分帧、buffer、终帧归一只在这里做一次。桌面与移动此前各自解了一遍，
 *    契约一变就有一侧静默漂移。
 * 2. done 帧**不蕴含正文已落盘**。草稿落地的是候选（candidateId），
 *    要作者在 UI 上采纳才进正文；partial=true 时更只是断流半稿。
 *    谁把 done 说成「已持久化」，谁就在对作者撒谎。
 */

export interface DraftBase {
  readonly revision: number
  readonly sha256: string
}

export interface DraftStartFrame {
  readonly ok: true
  readonly event: 'start'
  readonly candidateId: string
  readonly prompt?: string | undefined
  readonly contextMode?: string | undefined
  readonly contextTokens?: number | undefined
  readonly provider?: string | undefined
  readonly base?: DraftBase | undefined
}

export interface DraftDeltaFrame {
  readonly ok: true
  readonly event: 'delta'
  readonly candidateId?: string | undefined
  readonly text: string
}

export interface DraftDoneFrame {
  readonly ok: true
  readonly event: 'done'
  readonly candidateId?: string | undefined
  readonly outcome: string
  readonly partial: boolean
  readonly chars: number
}

export interface DraftErrorFrame {
  readonly ok: false
  readonly event: 'error'
  readonly candidateId?: string | undefined
  readonly outcome?: string | undefined
  readonly partial?: boolean | undefined
  readonly chars?: number | undefined
  readonly error: string
}

export type DraftFrame = DraftStartFrame | DraftDeltaFrame | DraftDoneFrame | DraftErrorFrame

/** 终帧归一后的结论。渲染层只读它，不再自己解释帧。 */
export interface DraftStreamResult {
  readonly terminal: 'done' | 'error' | 'aborted'
  readonly candidateId: string | null
  readonly text: string
  /** done 帧自述：这次产出是否为断流半稿 */
  readonly partial: boolean
  readonly outcome: string | null
  readonly chars: number | null
  readonly error: string | null
  /** start 帧自述：这次上下文是走编译收据还是降级结构包。 */
  readonly contextMode: string | null
}

export interface DraftStreamHandlers {
  readonly onDelta?: ((text: string) => void) | undefined
  readonly onFrame?: ((frame: DraftFrame) => void) | undefined
  /** 返回 true 时立即停止读取（作者切书/切章/取消）。 */
  readonly shouldStop?: (() => boolean) | undefined
  /** 暴露 reader，供调用方在中途主动 cancel。 */
  readonly onReader?: ((reader: ReadableStreamDefaultReader<Uint8Array>) => void) | undefined
}

function isFrame(value: unknown): value is DraftFrame {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { ok?: unknown; event?: unknown }
  if (typeof v.event !== 'string') return false
  if (v.ok === false) return v.event === 'error'
  return v.ok === true && (v.event === 'start' || v.event === 'delta' || v.event === 'done')
}

/**
 * 读干一个 NDJSON 草稿流并归一成终帧结论。
 *
 * 绝不抛业务异常：断流、非 ndjson、坏 JSON 一律变成 terminal 结论，
 * 由调用方决定怎么呈现。
 */
export async function readDraftStream(
  res: Response,
  handlers: DraftStreamHandlers = {},
): Promise<DraftStreamResult> {
  const contentType = res.headers.get('Content-Type') ?? ''
  if (!contentType.includes('ndjson') || res.body === null) {
    return {
      terminal: 'aborted',
      candidateId: null,
      text: '',
      partial: false,
      outcome: null,
      chars: null,
      error: '草稿服务未返回预期的流式响应',
      contextMode: null,
    }
  }

  const reader = res.body.getReader()
  handlers.onReader?.(reader)
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let candidateId: string | null = null
  let terminal: DraftStreamResult['terminal'] = 'aborted'
  let partial = false
  let outcome: string | null = null
  let chars: number | null = null
  let error: string | null = '草稿流在终帧之前结束'
  let contextMode: string | null = null

  const settle = (frame: DraftDoneFrame | DraftErrorFrame): boolean => {
    if (frame.candidateId !== undefined) candidateId = frame.candidateId
    if (frame.event === 'done') {
      terminal = 'done'
      partial = frame.partial
      outcome = frame.outcome
      chars = frame.chars
      error = null
      return true
    }
    terminal = 'error'
    partial = frame.partial ?? false
    outcome = frame.outcome ?? null
    chars = frame.chars ?? null
    error = frame.error
    return true
  }

  try {
    for (;;) {
      if (handlers.shouldStop?.() === true) {
        terminal = 'aborted'
        error = null
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.length > 0) {
          let frame: DraftFrame | null = null
          try {
            const parsed: unknown = JSON.parse(line)
            if (isFrame(parsed)) frame = parsed
          } catch {
            frame = null
          }
          if (frame !== null) {
            if (frame.event === 'start') {
              candidateId = frame.candidateId
              contextMode = frame.contextMode ?? null
            }
            if (frame.event === 'delta') {
              text += frame.text
              handlers.onDelta?.(frame.text)
            }
            handlers.onFrame?.(frame)
            if (frame.event === 'done' || frame.event === 'error') {
              settle(frame)
              return { terminal, candidateId, text, partial, outcome, chars, error, contextMode }
            }
          }
        }
        newline = buffer.indexOf('\n')
      }
    }
  } catch (cause) {
    error = (cause as Error).message
    terminal = 'aborted'
  }

  return { terminal, candidateId, text, partial, outcome, chars, error, contextMode }
}

/**
 * 终帧结论 → 给作者看的一句话。
 *
 * 文案与协议同处，这样桌面与移动不可能各说各话。
 * 特别注意：**任何分支都不说「已落盘 / 已持久化」**——草稿落地的是候选，
 * 进正文要作者点采纳；半稿更只是断流残留。
 */
export function describeDraftResult(result: DraftStreamResult): string {
  if (result.terminal === 'error') {
    return result.text.length > 0
      ? '生成中断：' + (result.error ?? '未知原因') + '（已保留部分内容，可重新生成）'
      : '生成失败：' + (result.error ?? '未知原因')
  }
  if (result.terminal === 'aborted') {
    return result.error ?? '草稿流中断'
  }
  if (result.partial) {
    return '草稿已生成为候选，但本次是断流半稿——请检查内容后再决定是否采纳进正文。'
  }
  return '草稿已生成为候选，采纳后才会写入正文。'
}

/**
 * 上下文模式 → 给作者看的一句话。
 *
 * 为什么必须有这句：`structural_fallback` 降级出来的包比编译包**小得多**——
 * 没有文风画像、没有有界质量切片、settings 为空（无任何被激活的设定条目）。
 * 服务端一直在 start 帧里如实发 contextMode，但客户端两个界面都没读它，
 * 于是作者看着一段和平时无异的生成结果，无从知道模型这次几乎没拿到设定。
 * 降级本身是允许的（宁跑不裸奔），**默默降级**不是。
 *
 * 未知模式按原样透出，不猜——猜错等于对作者撒谎。
 */
export function describeContextMode(mode: string | null | undefined): string | null {
  if (mode === undefined || mode === null) return null
  if (mode === 'structural_fallback') {
    return '上下文降级：未走编译（无文风画像 / 质量切片 / 激活设定）——生成质量可能低于平时'
  }
  if (mode === 'compiled_receipt') return '上下文已编译（含收据）'
  return `上下文模式：${mode}`
}

/**
 * 这个模式该不该挂「降级」告警。
 *
 * 和 describeContextMode 分开，是因为两者回答的不是同一个问题：
 * 「这次上下文是什么」几乎总有话说；「作者需不需要被提醒」只在两种情况下为真——
 * 明确降级（structural_fallback），或我们**不认识**这个模式。
 *
 * 把 `compiled_receipt` 也算成要告警，等于每次正常编译都挂一条琥珀色横幅。
 * 那不是提示，那是狼来了：真降级那天作者已经学会无视它了。
 *
 * 不认识也算要告警：客户端看不懂服务端说的事，只能原样交给作者，不能装作没看见。
 */
export function isDegradedContextMode(mode: string | null | undefined): boolean {
  if (mode === undefined || mode === null) return false
  return mode !== 'compiled_receipt'
}
