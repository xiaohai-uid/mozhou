import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TensionSparkWidget } from './components/TensionSparkWidget'
import { MobileComposer } from './components/MobileComposer'
import { VersionHistoryDrawer } from './drawers/VersionHistoryDrawer'
import { WorkbenchHub } from './hubs/WorkbenchHub'

const BOOK = { root: 'C:\\tmp\\test-book', bookId: 'bk_mobile', title: '测试作品' }

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('闭环 1 · 张力波形前端渲染 (TensionSparkWidget & WorkbenchHub)', () => {
  it('无数据或点数不足时：诚实展示未接入，绝不伪造波形', () => {
    // 完全无数据
    const { rerender } = render(<TensionSparkWidget />)
    expect(screen.getByText('管线阶段与叙事张力尚未接入')).toBeInTheDocument()

    // 只有 score 但没有真实 points
    rerender(<TensionSparkWidget tensionScore={80} tensionDesc="冲突激烈" currentStage={2} />)
    expect(screen.getByText('管线阶段与叙事张力尚未接入')).toBeInTheDocument()

    // points 点数 < 2
    rerender(
      <TensionSparkWidget
        tensionScore={80}
        tensionDesc="冲突激烈"
        currentStage={2}
        tensionPoints={[80]}
      />,
    )
    expect(screen.getByText('管线阶段与叙事张力尚未接入')).toBeInTheDocument()
  })

  it('有真实时序数据（points >= 2）：真实渲染折线画布与描述，移除未接入提示', () => {
    render(
      <TensionSparkWidget
        tensionScore={75}
        tensionDesc="中段交锋升级：局势反转"
        currentStage={2}
        tensionPoints={[25, 40, 75, 60]}
      />,
    )
    expect(screen.queryByText('管线阶段与叙事张力尚未接入')).not.toBeInTheDocument()
    expect(screen.getByText('中段交锋升级：局势反转')).toBeInTheDocument()
    expect(screen.getByText('叙事张力与情绪波峰')).toBeInTheDocument()
    expect(screen.getByText('草稿')).toBeInTheDocument()
  })

  it('WorkbenchHub 自动请求 /api/chapter.tension 并传给组件', async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/chapter.tension') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              available: true,
              tensionScore: 82,
              tensionDesc: '终段悬念留钩：危机悬而未决',
              tensionPoints: [30, 45, 65, 82],
              currentStage: 2,
            }),
        })
      }
      if (path === '/api/works') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, chapters: [] }),
        })
      }
      if (path === '/api/draft.question') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, choices: [] }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkbenchHub book={BOOK} onOpenDrawer={vi.fn()} chapterIndex={1} />)

    await waitFor(() => {
      expect(screen.getByText('终段悬念留钩：危机悬而未决')).toBeInTheDocument()
    })
    expect(screen.queryByText('管线阶段与叙事张力尚未接入')).not.toBeInTheDocument()
  })
})

describe('闭环 2 · 技能胶囊状态与契约透传 (MobileComposer & WorkbenchHub)', () => {
  it('点击技能胶囊切换选中状态，输入框不被强塞中文标签', () => {
    const onSend = vi.fn()
    render(<MobileComposer onSendPrompt={onSend} />)

    const conflictBtn = screen.getByTestId('skill-conflict')
    const conciseBtn = screen.getByTestId('skill-concise')
    const textarea = screen.getByPlaceholderText(/输入推进指令/)
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)

    // 初始未选中
    expect(conflictBtn.className).not.toContain('active')
    expect(conflictBtn.getAttribute('aria-pressed')).toBe('false')

    // 点击“增加冲突”选中
    fireEvent.click(conflictBtn)
    expect(conflictBtn.className).toContain('active')
    expect(conflictBtn.getAttribute('aria-pressed')).toBe('true')
    // 输入框未受污染
    expect((textarea as HTMLTextAreaElement).value).toBe('')

    // 点击“精简叙述”选中
    fireEvent.click(conciseBtn)
    expect(conciseBtn.className).toContain('active')

    // 再次点击“增加冲突”取消选中
    fireEvent.click(conflictBtn)
    expect(conflictBtn.className).not.toContain('active')

    // 输入正文并发送
    fireEvent.change(textarea, { target: { value: '主角拔刀面对强敌' } })
    fireEvent.click(screen.getByLabelText('生成草稿'))

    expect(onSend).toHaveBeenCalledWith('主角拔刀面对强敌', ['concise'])
  })

  it('WorkbenchHub 携带选中的 activeSkills 向服务端发起 /api/draft.stream', async () => {
    let capturedBody: { prompt?: string; activeSkills?: string[] } | null = null
    const fetchMock = vi.fn().mockImplementation((path: string, options?: RequestInit) => {
      if (path === '/api/draft.stream') {
        const bodyStr = typeof options?.body === 'string' ? options.body : '{}'
        capturedBody = JSON.parse(bodyStr) as { prompt?: string; activeSkills?: string[] }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/x-ndjson; charset=utf-8' },
          body: {
            getReader: () => ({
              read: () => Promise.resolve({ done: true, value: undefined }),
            }),
          },
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, chapters: [], choices: [] }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<WorkbenchHub book={BOOK} onOpenDrawer={vi.fn()} chapterIndex={1} />)

    // 选中“增加冲突”和“回收伏笔”
    const conflictBtn = screen.getByTestId('skill-conflict')
    const foreshadowBtn = screen.getByTestId('skill-foreshadow')
    fireEvent.click(conflictBtn)
    fireEvent.click(foreshadowBtn)

    const textarea = screen.getByPlaceholderText(/输入推进指令/)
    fireEvent.change(textarea, { target: { value: '推进剧情发展' } })
    fireEvent.click(screen.getByLabelText('生成草稿'))

    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    const body = capturedBody as unknown as { prompt?: string; activeSkills?: string[] }
    expect(body.prompt).toBe('推进剧情发展')
    expect(body.activeSkills).toEqual(['conflict', 'foreshadow'])
  })
})

describe('闭环 3 · 版本时光机前端呈现与 Diff 对比 (VersionHistoryDrawer)', () => {
  it('未建书或无历史记录时：诚实展示“尚未接入”卡片', () => {
      render(<VersionHistoryDrawer onClose={vi.fn()} book={null} />)
      expect(screen.getByText(/版本历史尚未接入/)).toBeInTheDocument()
      expect(screen.queryByTestId('restore-version-btn')).not.toBeInTheDocument()
    })

    it('有真实历史时：移除尚未接入提示，展示版本列表、段落级 Diff 对比与恢复操作', async () => {
      const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === '/api/chapter.history') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              chapterIndex: 1,
              currentRevision: 12,
              revisions: [
                { revision: 12, wordCount: 3500, savedAt: '2026-10-06T10:00:00Z' },
                { revision: 8, wordCount: 3000, savedAt: '2026-10-06T09:00:00Z' },
              ],
            }),
        })
      }
      if (path === '/api/chapter.history.diff') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              chapterIndex: 1,
              fromRevision: 8,
              toRevision: 12,
              diffs: [
                { kind: 'unchanged', text: '开篇背景保持一致', index: 0 },
                { kind: 'removed', text: '旧版第8版的废弃段落', index: 1 },
                { kind: 'added', text: '新版第12版新增的情节段落', index: 2 },
              ],
            }),
        })
      }
      if (path === '/api/chapter.history.restore') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              chapterIndex: 1,
              restoredFromRevision: 8,
              newRevision: 13,
            }),
        })
      }
      return Promise.reject(new Error('unexpected path ' + path))
    })
    vi.stubGlobal('fetch', fetchMock)

    const onReverted = vi.fn()
    render(
      <VersionHistoryDrawer
        book={BOOK}
        chapterIndex={1}
        onClose={vi.fn()}
        onReverted={onReverted}
      />,
    )

    // 等待历史数据加载
    await waitFor(() => {
      expect(screen.getByText('第 1 章 · 版本时光机')).toBeInTheDocument()
    })
    // 尚未接入提示已被移除
    expect(screen.queryByText(/版本历史尚未接入/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/当前 Rev 12/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('history-chip-r12')).toBeInTheDocument()
    expect(screen.getByTestId('history-chip-r8')).toBeInTheDocument()

    // 默认对比 r8 与 r12 的段落 Diff
    await waitFor(() => {
      expect(screen.getByText('旧版第8版的废弃段落')).toBeInTheDocument()
    })
    expect(screen.getByText('新版第12版新增的情节段落')).toBeInTheDocument()
    expect(screen.getByText('[+新增]')).toBeInTheDocument()
    expect(screen.getByText('[-删除]')).toBeInTheDocument()

    // 点击恢复 Rev 8
    const restoreBtn = screen.getByTestId('restore-version-btn')
    expect(restoreBtn.textContent).toContain('恢复此版本 (Rev 8)')
    fireEvent.click(restoreBtn)

    await waitFor(() => {
      expect(onReverted).toHaveBeenCalledWith(13)
    })
    expect(screen.getByText(/已创建新版本 Rev 13/)).toBeInTheDocument()
  })
})
