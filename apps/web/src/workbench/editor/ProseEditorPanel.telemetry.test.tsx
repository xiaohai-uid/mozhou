/**
 * 生产接线回归（工单 7）：质量遥测条必须真的挂在正文写作层里。
 *
 * 本文件守护的是「包内有实现 + 单测全绿 + 生产零调用」这一失败模式：
 * 断言 ProseEditorPanel（WorkbenchView → App 的生产渲染路径）实际渲染出
 * EditorQualityTelemetry，且其数值随作者键入的真实正文变化——
 * 而不是仅仅「组件自己能渲染」。
 *
 * 失败/边界路径：
 * - 未绑书（book=null）：写作层整体不渲染，遥测条必须随之缺席（不伪造空态指标）；
 * - 正文变化：指标必须跟着变，不能停在首帧快照。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProseEditorPanel } from './ProseEditorPanel'
import { chapterDraftKey, saveDraftCache } from '../../shell/workbenchStorage'
import type { BookInfo } from '../../shell/workbenchStorage'

const BOOK: BookInfo = { root: 'C:/tmp/book-a', bookId: 'bk_aaaa', title: '雾港失真' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    if (input === '/api/chapter.prose') {
      return new Response(JSON.stringify({ ok: true, exists: false, chapterIndex: 1 }), { status: 200 })
    }
    throw new Error('unexpected fetch: ' + input)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('ProseEditorPanel × EditorQualityTelemetry（生产接线）', () => {
  it('已绑书：正文写作层内实际渲染质量遥测条，且指标来自当前草稿文本', async () => {
    saveDraftCache('夜幕降临，钟声在海港回荡。', chapterDraftKey(BOOK, 1))
    render(<ProseEditorPanel book={BOOK} chapterIndex={1} />)

    const panel = screen.getByTestId('prose-editor')
    // 挂载位置证明：遥测条确实在正文写作层 section 内，不是游离组件
    await waitFor(() => {
      const telemetry = screen.getByTestId('editor-quality-telemetry')
      expect(panel.contains(telemetry)).toBe(true)
      const text = telemetry.textContent ?? ''
      expect(text).toContain('字数')
      expect(text).toContain('11') // 夜幕降临(4) + 钟声在海港回荡(7)
      expect(text).toContain('De-AI 正典纯净 (100分)')
    })
  })

  it('键入正文后指标随真实文本更新（不停在首帧）', async () => {
    const user = userEvent.setup()
    saveDraftCache('夜幕降临，钟声在海港回荡。', chapterDraftKey(BOOK, 1))
    render(<ProseEditorPanel book={BOOK} chapterIndex={1} />)
    expect(screen.getByTestId('editor-quality-telemetry').textContent ?? '').toContain('11')

    await user.type(screen.getByRole<HTMLTextAreaElement>('textbox'), '海边')

    await waitFor(() => {
      expect(screen.getByTestId('editor-quality-telemetry').textContent ?? '').toContain('13')
    })
  })

  it('AI 腔调正文：遥测条在同一生产路径上转为「待净化」（失败路径不静默）', async () => {
    const user = userEvent.setup()
    render(<ProseEditorPanel book={BOOK} chapterIndex={1} />)
    await user.type(screen.getByRole<HTMLTextAreaElement>('textbox'), '恐惧瞬间吞噬了他的理智。')

    await waitFor(() => {
      const text = screen.getByTestId('editor-quality-telemetry').textContent ?? ''
      expect(text).toContain('AI 腔调待净化')
      expect(text).toContain('Tier 1 必阻断')
    })
  })

  it('未绑书（book=null）：写作层只剩空态，遥测条必须缺席（不伪造指标）', () => {
    render(<ProseEditorPanel book={null} chapterIndex={1} />)
    // 写作层外壳与空态仍在（与 isolation.test.tsx 的既有语义一致）
    expect(screen.getByTestId('prose-editor')).toBeTruthy()
    expect(screen.getByText(/建书后此处成为当前章/)).toBeTruthy()
    // 无正文即无遥测——不得以 0 字/满分伪装成「已接入的质量证据」
    expect(screen.queryByTestId('editor-quality-telemetry')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
