import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShellTelemetry } from './useShellTelemetry'
import { okJson } from '../test/http'

afterEach(() => { vi.unstubAllGlobals() })

function pendingReads() {
  const reads: Array<{ root: string; chapterIndex?: number; resolve: (response: Response) => void }> = []
  vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { root: string; chapterIndex?: number }
    return new Promise<Response>(resolve => { reads.push({ ...body, resolve }) })
  }))
  return {
    reads,
    async finish(offset: number, revision: number) {
      await act(async () => {
        reads[offset]!.resolve(okJson({ ok: true, chapters: [{ chapterIndex: 1, title: '第一章', revision, wordCount: revision * 10 }] }))
        reads[offset + 1]!.resolve(okJson({ ok: true, receipts: [] }))
        reads[offset + 2]!.resolve(okJson({ ok: true, status: 'current' }))
        reads[offset + 3]!.resolve(okJson({ ok: true, matrix: { rows: [] } }))
        await Promise.resolve()
      })
    },
  }
}

describe('壳层遥测响应顺序', () => {
  it('撤销后的刷新先返回时，迟到的采纳刷新不能覆盖新版本', async () => {
    const pending = pendingReads()
    const view = renderHook(() => useShellTelemetry('C:/test-book', 1))
    await pending.finish(0, 1)
    act(() => { window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh')) })
    act(() => { window.dispatchEvent(new CustomEvent('mozhou:telemetry-refresh')) })
    expect(pending.reads).toHaveLength(12)
    await pending.finish(8, 3)
    await waitFor(() => expect(view.result.current.works?.chapters[0]?.revision).toBe(3))
    await pending.finish(4, 2)
    expect(view.result.current.works?.chapters[0]?.revision).toBe(3)
  })

  it('切书后旧书迟到的响应不能覆盖新书状态', async () => {
    const pending = pendingReads()
    const view = renderHook(({ root }) => useShellTelemetry(root, 1), { initialProps: { root: 'C:/book-a' } })
    view.rerender({ root: 'C:/book-b' })
    expect(pending.reads[4]?.root).toBe('C:/book-b')
    await pending.finish(4, 7)
    await pending.finish(0, 2)
    expect(view.result.current.works?.chapters[0]?.revision).toBe(7)
  })

  it('关闭作品后旧请求不能恢复已清空的作品状态', async () => {
    const pending = pendingReads()
    const initialProps: { root: string | null } = { root: 'C:/book-a' }
    const view = renderHook(({ root }) => useShellTelemetry(root, 1), { initialProps })
    view.rerender({ root: null })
    expect(view.result.current.works).toBeNull()
    await pending.finish(0, 2)
    expect(view.result.current.works).toBeNull()
  })
})
