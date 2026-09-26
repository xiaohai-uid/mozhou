// @vitest-environment node
/**
 * 结构化日志契约：单行 JSON、级别决定流向。
 *
 * 生产排障依赖可被采集器按字段检索的日志。多行人类可读输出在容器里无法按
 * `level`/`event` 过滤，故此处锁定「一行一条、可 JSON.parse、warn/error 落 stderr」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { log, nextRequestId } from './observability.js'

function capture(stream: NodeJS.WriteStream): { lines: () => string[]; restore: () => void } {
  const collected: string[] = []
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
    collected.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  })
  return { lines: () => collected, restore: () => spy.mockRestore() }
}

const restores: (() => void)[] = []

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

function captureStdout(): string[] {
  const handle = capture(process.stdout)
  restores.push(handle.restore)
  return handle.lines()
}

function captureStderr(): string[] {
  const handle = capture(process.stderr)
  restores.push(handle.restore)
  return handle.lines()
}

describe('log · 单行 JSON 与流向', () => {
  it('info 落 stdout，且一行即一条可解析 JSON，附加字段并入', () => {
    const lines = captureStdout()

    log('info', 'http.request', { status: 200, durationMs: 1.5 })

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] ?? '') as Record<string, unknown>
    expect(parsed['level']).toBe('info')
    expect(parsed['event']).toBe('http.request')
    expect(parsed['status']).toBe(200)
    expect(parsed['durationMs']).toBe(1.5)
    expect(typeof parsed['ts']).toBe('string')
    expect(lines[0]?.endsWith('\n')).toBe(true)
  })

  it('error 落 stderr 而非 stdout', () => {
    const stdout = captureStdout()
    const stderr = captureStderr()

    log('error', 'server.unhandled_error', { error: 'boom' })

    expect(stdout).toHaveLength(0)
    expect(stderr).toHaveLength(1)
    expect((JSON.parse(stderr[0] ?? '') as Record<string, unknown>)['level']).toBe('error')
  })
})

describe('nextRequestId · 请求标识', () => {
  it('逐次调用不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => nextRequestId()))

    expect(ids.size).toBe(50)
  })
})
