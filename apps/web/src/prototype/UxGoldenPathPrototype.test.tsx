import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UxGoldenPathPrototype } from './UxGoldenPathPrototype'

const STORAGE_KEY = 'mozhou.prototype.ux-golden-path.v1'

function openVariantD(): void {
  window.history.replaceState(null, '', '/?prototype=ux-golden-path&variant=D')
}

async function createBook(): Promise<void> {
  await userEvent.type(screen.getByLabelText('作品名'), '雾港失真')
  await userEvent.type(screen.getByLabelText('作品方向'), '近未来港城，修理师追查一张不存在的末班船票。')
  await userEvent.click(screen.getByRole('button', { name: '开始写第一章' }))
}

beforeEach(() => {
  window.localStorage.clear()
  openVariantD()
})

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('UX Golden Path variant D — layered Novel OS model', () => {
  it('keeps project context, the eight-stage production spine, and contextual inspector visible without the global app catalog', async () => {
    render(<UxGoldenPathPrototype />)
    await createBook()

    expect(screen.getByLabelText('作品上下文')).toBeInTheDocument()
    expect(screen.getByText('人物 · 6')).toBeInTheDocument()
    expect(screen.getByText('世界观 · 4')).toBeInTheDocument()
    expect(screen.getByLabelText('章节生产阶段').querySelectorAll('[data-stage]')).toHaveLength(8)
    expect(screen.getByRole('tab', { name: '质量' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('网文扫榜')).toBeNull()
    expect(screen.getByRole('button', { name: '全部能力' })).toBeInTheDocument()
  })

  it('keeps generated text as Candidate until the author explicitly accepts it', async () => {
    render(<UxGoldenPathPrototype />)
    await createBook()

    const manuscript = screen.getByLabelText('正文') as HTMLTextAreaElement
    const before = manuscript.value
    await userEvent.clear(screen.getByLabelText('AI 写作要求'))
    await userEvent.type(screen.getByLabelText('AI 写作要求'), '让这一段更有压迫感')
    await userEvent.click(screen.getByRole('button', { name: '生成候选' }))

    expect(screen.getByText('候选 · 尚未进入正文')).toBeInTheDocument()
    expect(manuscript.value).toBe(before)
    expect(screen.getByRole('tab', { name: '质量' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('可继续 · 1 条建议')).toBeInTheDocument()
  })

  it('distinguishes Accepted active draft from durable Committed state', async () => {
    render(<UxGoldenPathPrototype />)
    await createBook()

    await userEvent.click(screen.getByRole('button', { name: '生成候选' }))
    await userEvent.click(screen.getByRole('button', { name: '接受到草稿' }))

    expect(screen.getByText('已接受 · 尚未提交')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提交本章' })).toBeInTheDocument()
    expect(screen.queryByText('已提交 · rev.04')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '提交本章' }))
    expect(screen.getByText('已提交 · rev.04')).toBeInTheDocument()
    expect(document.querySelector('[data-prototype-phase="committed"]')).not.toBeNull()
  })

  it('reveals Context Receipt details on demand instead of keeping evidence expanded', async () => {
    render(<UxGoldenPathPrototype />)
    await createBook()

    await userEvent.click(screen.getByRole('tab', { name: '上下文' }))
    const inspector = screen.getByLabelText('情境检视')
    expect(within(inspector).getByText('已读取 4 类 · 6,438 tokens')).toBeInTheDocument()
    expect(within(inspector).getByText(/人物状态/)).toBeInTheDocument()
    expect(within(inspector).getByText(/当前章节末尾/)).toBeInTheDocument()
  })

  it('keeps global capabilities reachable in a secondary drawer', async () => {
    render(<UxGoldenPathPrototype />)
    await createBook()

    await userEvent.click(screen.getByRole('button', { name: '全部能力' }))
    const drawer = screen.getByRole('dialog', { name: '全部能力' })
    expect(within(drawer).getByText('网文扫榜')).toBeInTheDocument()
    expect(within(drawer).getByText('技能广场')).toBeInTheDocument()
    expect(within(drawer).getByText('云同步')).toBeInTheDocument()
    expect(within(drawer).getByText('会员中心')).toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: '关闭全部能力' }))
    expect(screen.queryByRole('dialog', { name: '全部能力' })).toBeNull()
  })

  it('persists committed manuscript and restores it after remount', async () => {
    const first = render(<UxGoldenPathPrototype />)
    await createBook()
    await userEvent.click(screen.getByRole('button', { name: '生成候选' }))
    await userEvent.click(screen.getByRole('button', { name: '接受到草稿' }))
    await userEvent.click(screen.getByRole('button', { name: '提交本章' }))

    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(stored).toContain('committed')

    first.unmount()
    render(<UxGoldenPathPrototype />)
    expect(screen.getByText('已提交 · rev.04')).toBeInTheDocument()
  })
})
