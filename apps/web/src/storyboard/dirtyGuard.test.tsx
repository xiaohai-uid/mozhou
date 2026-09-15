/**
 * U06 离开保护回归 + U05 徽标三态语义：
 * - dirtyGuard 纯模块：三态（idle/dirty/saved）注册/通知/确认文案；
 * - StoryboardView 注册语义：空工作区=idle（就绪，不显示「已保存」）；
 *   生成候选（未保存）→ dirty；保存成功 → saved；卸载 → idle。
 * - MobileShell 徽标映射：idle=就绪 / dirty=●未保存 / saved=已保存。
 * 外壳接线（App 切页/切书、MobileShell 关抽屉）另有真实浏览器验收
 * （evidence/R-fixes + u06-leave-guard.py --expect-dialog）。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmStoryboardLeave,
  getStoryboardSaveState,
  isStoryboardDirty,
  onStoryboardSaveState,
  setStoryboardSaveState,
  type StoryboardSaveState,
} from './dirtyGuard'
import { StoryboardView } from './StoryboardView'
import { MobileShell } from '../mobile/MobileShell'
import type { BookInfo } from '../shell/workbenchStorage'

afterEach(() => {
  setStoryboardSaveState('idle')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const BOOK: BookInfo = { root: 'C:/tmp/book-a', bookId: 'book_aaaa', title: '雾港失真' }

function candidateDoc() {
  return {
    schemaVersion: 1, id: 'sb_01JBGZ000000000000000000AA', revision: 0,
    title: '灯塔夜谈', characters: [], shots: [{
      id: 'shot_01', sceneId: 's', order: 1, location: 'l', timeOfDay: '夜', framing: 'wide',
      cameraMovement: 'c', visual: 'v', characterIds: [], dialogue: [], narration: '', sound: '',
      estimatedDurationSeconds: 3, imagePrompt: '', videoPrompt: '', negativePrompt: '',
      sourceQuote: '', origin: 'adaptation', adaptationNote: '',
    }],
    warnings: [], options: { aspectRatio: '9:16', targetDurationSeconds: 90, visualStyle: 'x', language: 'zh-CN' },
    totalEstimatedDurationSeconds: 3,
    createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z',
    generation: { provider: 'p', model: 'm' },
    source: { bookId: 'book_aaaa', chapterIndex: 1, revision: 1, phase: 'draft', sha256: 'a'.repeat(64) },
  } as never
}

function stubRoutes() {
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    const path = input
    if (path === '/api/capabilities') return new Response(JSON.stringify({ ok: true, capabilities: [], providerAvailable: true }), { status: 200 })
    if (path === '/api/works') return new Response(JSON.stringify({ ok: true, chapters: [{ chapterIndex: 1, title: 't', phase: 'draft', wordCount: 1, revision: 1 }] }), { status: 200 })
    if (path === '/api/storyboard.source') return new Response(JSON.stringify({ ok: true, source: { bookId: 'book_aaaa', chapterIndex: 1, revision: 1, phase: 'draft', sha256: 'a'.repeat(64) }, title: 't', characterCount: 1, excerpt: 'x' }), { status: 200 })
    if (path === '/api/storyboards') return new Response(JSON.stringify({ ok: true, items: [], skippedInvalid: 0 }), { status: 200 })
    if (path === '/api/storyboard.generate') return new Response(JSON.stringify({ ok: true, candidate: candidateDoc() }), { status: 200 })
    if (path === '/api/storyboard.save') return new Response(JSON.stringify({ ok: true, id: 'sb_01JBGZ000000000000000000AA', revision: 1, sourceStale: false }), { status: 200 })
    throw new Error('unexpected ' + path)
  }))
}

describe('dirtyGuard（U06 共享脏状态 · U05 三态保存状态）', () => {
  it('三态注册/通知：状态变化推给监听者；同值不重推', () => {
    const seen: StoryboardSaveState[] = []
    const off = onStoryboardSaveState((s) => seen.push(s))
    setStoryboardSaveState('dirty')
    setStoryboardSaveState('dirty')
    setStoryboardSaveState('saved')
    off()
    setStoryboardSaveState('dirty')
    expect(seen).toEqual(['dirty', 'saved']) // 退订后不再通知
    expect(getStoryboardSaveState()).toBe('dirty') // 模块状态独立于订阅存在
    expect(isStoryboardDirty()).toBe(true)
  })

  it('isStoryboardDirty 只在 dirty 为真；idle/saved 均不拦', () => {
    expect(isStoryboardDirty()).toBe(false)
    setStoryboardSaveState('saved')
    expect(isStoryboardDirty()).toBe(false)
    setStoryboardSaveState('dirty')
    expect(isStoryboardDirty()).toBe(true)
  })

  it('confirmStoryboardLeave：干净直接放行；脏时经确认', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    expect(confirmStoryboardLeave('切换页面')).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
    setStoryboardSaveState('dirty')
    confirmSpy.mockReturnValue(false)
    expect(confirmStoryboardLeave('切换页面')).toBe(false)
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('未保存修改'))
    confirmSpy.mockReturnValue(true)
    expect(confirmStoryboardLeave('切换作品')).toBe(true)
  })
})

describe('StoryboardView 脏注册（U06 外壳联动源 · U05 徽标真源）', () => {
  it('空工作区=idle；生成候选=dirty；保存成功=saved；卸载=idle', async () => {
    const user = userEvent.setup()
    stubRoutes()
    const { unmount } = render(<StoryboardView book={BOOK} />)
    expect(getStoryboardSaveState()).toBe('idle') // 空工作区：就绪，徽标不得显示「已保存」

    await user.click(await screen.findByTestId('sb-generate'))
    await screen.findByTestId('sb-shots')
    expect(getStoryboardSaveState()).toBe('dirty') // U06：未保存候选受保护

    await user.click(screen.getByTestId('sb-save'))
    await vi.waitFor(() => expect(screen.getByTestId('sb-notice')).toHaveTextContent('已保存 r1'))
    expect(getStoryboardSaveState()).toBe('saved') // 保存成功：才允许「已保存」

    unmount()
    expect(getStoryboardSaveState()).toBe('idle') // 卸载解除
  })
})

describe('MobileShell 分镜徽标三态（U05）', () => {
  it('无文档时徽标为「就绪」，不显示「已保存」', async () => {
    // 全部接口离线：分镜视图各读面走 catch 空态（不影响徽标真源）
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('offline') }))
    render(<MobileShell book={BOOK} onSwitchBook={vi.fn()} />)
    await userEvent.click(screen.getByTestId('workbench-open-storyboard'))
    const badge = await screen.findByTestId('mfp-badge')
    expect(badge.textContent).toBe('就绪')
    expect(badge.className).not.toContain('dirty')
  })
})
