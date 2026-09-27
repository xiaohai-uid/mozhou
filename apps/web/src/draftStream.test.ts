/**
 * 草稿流 NDJSON 协议客户端测试。
 *
 * 这里最要紧的一条：任何终帧都不得让调用方以为「正文已落盘」。
 * 移动端此前对 done(partial) 也宣称「已完成并持久化」——那是对作者撒谎。
 */
import { describe, expect, it } from 'vitest'
import { describeContextMode, describeDraftResult, readDraftStream } from './draftStream'

function ndjsonResponse(lines: string[], contentType = 'application/x-ndjson; charset=utf-8'): Response {
  const chunks = lines.map((line) => new TextEncoder().encode(line + '\n'))
  let index = 0
  return {
    headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader: () => ({
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined },
          ),
      }),
    },
  } as unknown as Response
}

const START = JSON.stringify({ ok: true, event: 'start', candidateId: 'cand_1', provider: 'real-openai-compatible' })
const delta = (text: string): string => JSON.stringify({ ok: true, event: 'delta', candidateId: 'cand_1', text })
const done = (partial: boolean): string =>
  JSON.stringify({ ok: true, event: 'done', candidateId: 'cand_1', outcome: 'succeeded', partial, chars: 6 })
const errFrame = JSON.stringify({ ok: false, event: 'error', error: '上游 502' })

describe('readDraftStream · 帧协议', () => {
  it('完整成功流：累计正文、透传 candidateId、终帧 done', async () => {
    const result = await readDraftStream(ndjsonResponse([START, delta('第一段'), delta('第二段'), done(false)]))

    expect(result.terminal).toBe('done')
    expect(result.text).toBe('第一段第二段')
    expect(result.candidateId).toBe('cand_1')
    expect(result.partial).toBe(false)
    expect(result.chars).toBe(6)
  })

  it('onDelta 逐段回调，拼接结果等于累计正文', async () => {
    const seen: string[] = []
    await readDraftStream(ndjsonResponse([START, delta('甲'), delta('乙'), done(false)]), {
      onDelta: (text) => seen.push(text),
    })
    expect(seen).toEqual(['甲', '乙'])
  })

  it('onFrame 能看到 start 帧的 provider 与 base（桌面端据此建候选）', async () => {
    const start = JSON.stringify({
      ok: true,
      event: 'start',
      candidateId: 'cand_9',
      provider: 'real-openai-compatible',
      base: { revision: 3, sha256: 'abc' },
    })
    const seen: string[] = []
    let base: unknown = null
    await readDraftStream(ndjsonResponse([start, done(false)]), {
      onFrame: (frame) => {
        seen.push(frame.event)
        if (frame.event === 'start') base = frame.base
      },
    })
    expect(seen).toEqual(['start', 'done'])
    expect(base).toEqual({ revision: 3, sha256: 'abc' })
  })

  it('坏 JSON 行被跳过，不炸流', async () => {
    const result = await readDraftStream(
      ndjsonResponse([START, '{ 这不是 json', delta('可用'), done(false)]),
    )
    expect(result.terminal).toBe('done')
    expect(result.text).toBe('可用')
  })

  it('shouldStop 返回 true 时立即中止，不再读流', async () => {
    const result = await readDraftStream(ndjsonResponse([START, delta('不再读'), done(false)]), {
      shouldStop: () => true,
    })
    expect(result.terminal).toBe('aborted')
    expect(result.text).toBe('')
  })

  it('非 ndjson 响应 → aborted 且带明确原因', async () => {
    const result = await readDraftStream(ndjsonResponse([START], 'application/json'))
    expect(result.terminal).toBe('aborted')
    expect(result.error).toBe('草稿服务未返回预期的流式响应')
  })

  it('流在终帧前结束 → aborted，不得被当成完成', async () => {
    const result = await readDraftStream(ndjsonResponse([START, delta('半截')]))
    expect(result.terminal).toBe('aborted')
    expect(result.text).toBe('半截')
    expect(result.error).toBe('草稿流在终帧之前结束')
  })

  it('error 帧 → error 终态，带原因，绝不当成 done', async () => {
    const result = await readDraftStream(ndjsonResponse([START, delta('已有内容'), errFrame]))
    expect(result.terminal).toBe('error')
    expect(result.error).toBe('上游 502')
    expect(result.text).toBe('已有内容')
  })
})

describe('describeDraftResult · 任何分支都不得宣称正文已落盘', () => {
  it('done(partial=false)：说是候选，不是已持久化', () => {
    const text = describeDraftResult({
      terminal: 'done',
      candidateId: 'c1',
      text: '正文',
      partial: false,
      contextMode: null,
      outcome: 'succeeded',
      chars: 2,
      error: null,
    })
    expect(text).toContain('候选')
    expect(text).not.toContain('已持久化')
    expect(text).not.toContain('已落盘')
  })

  it('done(partial=true)：必须明说是断流半稿', () => {
    const text = describeDraftResult({
      terminal: 'done',
      candidateId: 'c1',
      text: '半截',
      partial: true,
      contextMode: null,
      outcome: 'failed_recoverable',
      chars: 2,
      error: null,
    })
    expect(text).toContain('半稿')
    expect(text).not.toContain('已持久化')
  })

  it('error 终态：说明中断，不说完成', () => {
    const text = describeDraftResult({
      terminal: 'error',
      candidateId: 'c1',
      text: '部分',
      partial: false,
      contextMode: null,
      outcome: null,
      chars: null,
      error: '上游 502',
    })
    expect(text).toContain('生成中断')
    expect(text).toContain('上游 502')
    expect(text).not.toContain('已持久化')
  })

  it('aborted 终态：只报中断', () => {
    const text = describeDraftResult({
      terminal: 'aborted',
      candidateId: null,
      text: '',
      partial: false,
      outcome: null,
      contextMode: null,
      chars: null,
      error: '草稿流在终帧之前结束',
    })
    expect(text).toContain('草稿流在终帧之前结束')
    expect(text).not.toContain('已持久化')
  })
})

const startWith = (mode: string): string =>
  JSON.stringify({ ok: true, event: 'start', candidateId: 'cand_1', provider: 'real-openai-compatible', contextMode: mode })

describe('contextMode · 降级必须让作者看见', () => {
  it('从 start 帧透传到结果', async () => {
    const result = await readDraftStream(ndjsonResponse([startWith('structural_fallback'), delta('正文'), done(false)]))
    expect(result.contextMode).toBe('structural_fallback')
  })

  it('未带 contextMode 的旧帧不得编造（结果为 null，不猜）', async () => {
    const result = await readDraftStream(ndjsonResponse([START, delta('正文'), done(false)]))
    expect(result.contextMode).toBeNull()
  })

  it('降级模式给出明确说明，且不得含「已落盘 / 已持久化」等措辞', () => {
    const text = describeContextMode('structural_fallback')
    expect(text).toContain('降级')
    expect(text).not.toContain('已落盘')
    expect(text).not.toContain('已持久化')
  })

  it('编译模式如实呈现，缺省返回 null（调用方不渲染空提示）', () => {
    expect(describeContextMode('compiled_receipt')).toContain('已编译')
    expect(describeContextMode(null)).toBeNull()
    expect(describeContextMode(undefined)).toBeNull()
  })

  it('未知模式原样透出，不猜', () => {
    expect(describeContextMode('some_future_mode')).toBe('上下文模式：some_future_mode')
  })
})
