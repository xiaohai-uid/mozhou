/**
 * 首次建书 Wizard 覆盖层测试（T42 / Q3 仅首次）：
 * - 五步按序走通：建书→世界观→大纲→首章→连写（步 5 收口回调落地工作台）；
 * - 可回退（上一步）；步 1 建书失败错误族内联呈现（不弹裸异常）；
 * - 重放场景（既有书）：步 1 不再建书，直接进入后续步；关闭回调触发。
 * 零 any：回调载荷类型 = WizardOutcome（包类型直引）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WizardOverlay } from './WizardOverlay'
import type { WizardOutcome } from './WizardOverlay'
import type { BookInfo } from '../shell/workbenchStorage'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOOK: BookInfo = { root: 'C:\\tmp\\book-a', bookId: 'bk_1', title: '雾港失真' }

describe('WizardOverlay（T42）', () => {
  it('首次建书：步 1 调 /api/book 建书；五步走通后 onComplete 收口为 WizardOutcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, root: 'C:\\tmp\\newbook', bookId: 'bk_new' }), { status: 200 })),
    )
    const onComplete = vi.fn()
    const onReplay = vi.fn()
    render(<WizardOverlay precreated={null} onComplete={onComplete} onReplay={onReplay} />)
    expect(screen.getByTestId('wizard-overlay')).not.toBeNull()
    expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 01 / 05')

    // 步 1 输入书名并继续
    const titleInput = screen.getByLabelText('作品名')
    await userEvent.type(titleInput, '雾港失真')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 02 / 05')
    })
    // 步 2 世界观
    await userEvent.type(screen.getByLabelText('世界规则'), '被潮汐钟遗忘的人消失')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 03 / 05')
    })
    // 步 3 大纲（含 OutlineNodeScan 读面包络说明）
    expect(screen.getByTestId('wizard-outline-scan').textContent).toContain('OutlineNodeScan')
    await userEvent.type(screen.getByLabelText('卷级承诺'), '找回一个全城都不记得的人')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 04 / 05')
    })
    // 步 4 首章
    await userEvent.type(screen.getByLabelText('开场画面'), '一张没有乘客姓名的末班船票')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 05 / 05')
    })
    expect(screen.getByRole('button', { name: /进入工作台/ })).not.toBeNull()
    // 步 5 连写目标 + 收口
    await userEvent.type(screen.getByLabelText('首章目标'), '800 字内意识到记忆被篡改')
    await userEvent.click(screen.getByRole('button', { name: /进入工作台/ }))
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1)
    })
    const outcome = onComplete.mock.calls[0]?.[0] as WizardOutcome
    expect(outcome.root).toBe('C:\\tmp\\newbook')
    expect(outcome.bookId).toBe('bk_new')
    expect(outcome.title).toBe('雾港失真')
    expect(outcome.worldRule).toBe('被潮汐钟遗忘的人消失')
    expect(outcome.volumePromise).toBe('找回一个全城都不记得的人')
    expect(outcome.opening).toBe('一张没有乘客姓名的末班船票')
    expect(outcome.firstChapterGoal).toBe('800 字内意识到记忆被篡改')
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('可回退：上一步回到建书步（步骤导航可逆）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, root: 'C:\\tmp\\b2', bookId: 'bk_2' }), { status: 200 })),
    )
    render(<WizardOverlay precreated={null} onComplete={() => {}} onReplay={() => {}} />)
    await userEvent.type(screen.getByLabelText('作品名'), '书乙')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 02 / 05')
    })
    await userEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 01 / 05')
  })

  it('步 1 建书失败：错误族内联呈现（role=alert），不跳步不弹裸异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'book directory not empty: /dir' }), { status: 400 }),
      ),
    )
    render(<WizardOverlay precreated={null} onComplete={() => {}} onReplay={() => {}} />)
    await userEvent.type(screen.getByLabelText('作品名'), '坏书')
    await userEvent.click(screen.getByRole('button', { name: /继续/ }))
    await waitFor(() => {
      expect(screen.getByTestId('wizard-error').textContent).toContain('book directory not empty')
    })
    // 仍停在步 1（错误内联不跳步）
    expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 01 / 05')
  })

  it('重放场景（既有书 precreated）：步 1 不再建书即直接可进，走完后以既有书收口', async () => {
    const io = vi.fn()
    render(<WizardOverlay precreated={BOOK} onComplete={io} onReplay={() => {}} />)
    // 步 1 可继续（created 已在）
    const nextBtn = screen.getByRole('button', { name: /继续/ })
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(nextBtn)
    await waitFor(() => {
      expect(screen.getByTestId('wizard-eyebrow').textContent).toBe('STEP 02 / 05')
    })
    // 快速走完
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /继续/ }))
      await waitFor(() => document.querySelector('.wiz-step.active'))
    }
    await userEvent.click(screen.getByRole('button', { name: /进入工作台/ }))
    await waitFor(() => {
      expect(io).toHaveBeenCalledTimes(1)
    })
    const outcome = io.mock.calls[0]?.[0] as WizardOutcome
    expect(outcome.root).toBe(BOOK.root)
    expect(outcome.bookId).toBe(BOOK.bookId)
    expect(outcome.title).toBe('未命名之书')
  })

  it('关闭按钮触发 onReplay（dismiss 返回工作台）', async () => {
    const onReplay = vi.fn()
    render(<WizardOverlay precreated={null} onComplete={() => {}} onReplay={onReplay} />)
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onReplay).toHaveBeenCalledTimes(1)
  })
})