import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MembershipView } from './membership/MembershipView'
import { WorkbenchView } from './workbench/WorkbenchView'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('Technical Preview UI truthfulness', () => {
  it('does not display fabricated daily progress or streak values', () => {
    render(
      <WorkbenchView
        book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }}
        onBookCreated={() => undefined}
      />,
    )
    expect(screen.queryByText(/3,420 \/ 4,000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/连更12天/)).not.toBeInTheDocument()
  })

  it('does not claim a paid lifetime license is active when the API reports community preview', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      license: null,
      plans: [{ id: 'free_community', name: '社区免费版', price: '免费', features: [], current: true }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    render(<MembershipView />)
    await screen.findByTestId('membership-no-license')
    expect(screen.queryByText('● 终身买断已激活')).not.toBeInTheDocument()
    expect(screen.queryByText(/离线校验 · 即时解锁/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/正式购买与激活服务尚未上线/)).toBeInTheDocument())
  })
})
