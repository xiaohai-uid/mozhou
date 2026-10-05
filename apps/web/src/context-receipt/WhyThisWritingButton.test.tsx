/**
 * 「为什么这么写」入口测试（T2）。
 *
 * 覆盖三条作者真会遇到的情形：无书不渲染、本章无装配如实说明、点击交出本章最近一条。
 * 第三条特意锁住「取列表最后一条」这个口径——回执一证一文件、ULID 文件名字典序 =
 * 时间序，所以最后一条就是最近一次装配；口径变了就是行为漂移，测试必须报警。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReceiptListResponse } from '../../shared/api'
import { okJson } from '../test/http'
import { WhyThisWritingButton } from './WhyThisWritingButton'

afterEach(() => {
  vi.unstubAllGlobals()
})

const LIST: ReceiptListResponse['receipts'] = [
  { receiptId: 'rcpt_t0001', chapterIndex: 1, totalTokens: 4000, hashMatch: true },
  { receiptId: 'rcpt_t0002', chapterIndex: 2, totalTokens: 5000, hashMatch: true },
  { receiptId: 'rcpt_t0003', chapterIndex: 2, totalTokens: 5200, hashMatch: true },
]

describe('WhyThisWritingButton（T2）', () => {
  it('未建书时不渲染按钮', () => {
    render(<WhyThisWritingButton root={null} chapterIndex={1} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '为什么这么写' })).toBeNull()
  })

  it('本章无装配记录时如实说明，不跳到空看板', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, receipts: LIST })))
    const onOpen = vi.fn()
    render(<WhyThisWritingButton root={'C:\\tmp\\book-a'} chapterIndex={7} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: '为什么这么写' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('本章还没有装配记录')
    })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('点击交出本章最近一次装配（列表最后一条），不跨章', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ ok: true, receipts: LIST })))
    const onOpen = vi.fn()
    render(<WhyThisWritingButton root={'C:\\tmp\\book-a'} chapterIndex={2} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: '为什么这么写' }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    expect(onOpen).toHaveBeenCalledWith('rcpt_t0003')
  })

  it('读取失败显式报错，不静默', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: '装配记录读取失败' }), { status: 500 })),
    )
    const onOpen = vi.fn()
    render(<WhyThisWritingButton root={'C:\\tmp\\book-a'} chapterIndex={1} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: '为什么这么写' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('装配记录读取失败')
    })
    expect(onOpen).not.toHaveBeenCalled()
  })
})
