import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MembershipView } from './membership/MembershipView'
import { WorkbenchView } from './workbench/WorkbenchView'
import { TopBar } from './shell/TopBar'
import { DesktopToolModals } from './shell/DesktopToolModals'
import { AuthLicenseDrawer } from './mobile/drawers/AuthLicenseDrawer'
import { ComplianceDrawer } from './mobile/drawers/ComplianceDrawer'
import { ExportPublishDrawer } from './mobile/drawers/ExportPublishDrawer'
import { VersionHistoryDrawer } from './mobile/drawers/VersionHistoryDrawer'

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

  it('does not fabricate daily progress in the global top bar', () => {
    render(
      <TopBar
        book={{ root: '/tmp/book', bookId: 'book_1', title: '书' }}
        onHome={() => undefined}
        onReplayWizard={() => undefined}
        onOpenModal={() => undefined}
      />,
    )
    expect(screen.queryByText(/3,420 \/ 4,000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/85%/)).not.toBeInTheDocument()
    expect(screen.getByText(/统计未接入/)).toBeInTheDocument()
  })

  it('desktop history/export/compliance tools never report invented successful operations', () => {
    const { rerender } = render(<DesktopToolModals activeModal="history" onClose={() => undefined} />)
    expect(screen.queryByText(/Rev 4/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复此版本/ })).not.toBeInTheDocument()
    expect(screen.getByText(/版本历史.*尚未接入/)).toBeInTheDocument()

    rerender(<DesktopToolModals activeModal="export" onClose={() => undefined} />)
    expect(screen.queryByRole('button', { name: /导出 Word/ })).not.toBeInTheDocument()
    expect(screen.getByText(/导出.*尚未接入/)).toBeInTheDocument()

    rerender(<DesktopToolModals activeModal="compliance" onClose={() => undefined} />)
    expect(screen.queryByText(/合规率 100%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026 红线库/)).not.toBeInTheDocument()
    expect(screen.getByText(/合规审查.*尚未接入/)).toBeInTheDocument()
  })

  it('mobile commercial drawers expose unavailable state instead of fake login, rollback, export, or compliance success', () => {
    const noop = () => undefined
    const { rerender } = render(
      <AuthLicenseDrawer onLoginSuccess={() => undefined} onOpenLicense={noop} />,
    )
    expect(screen.queryByPlaceholderText('请输入注册邮箱')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /立即登录/ })).not.toBeInTheDocument()
    expect(screen.getByText(/账号服务尚未接入/)).toBeInTheDocument()

    rerender(<VersionHistoryDrawer onClose={noop} />)
    expect(screen.queryByText(/Rev 4/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复此版本/ })).not.toBeInTheDocument()
    expect(screen.getByText(/版本历史.*尚未接入/)).toBeInTheDocument()

    rerender(<ExportPublishDrawer onClose={noop} />)
    expect(screen.queryByRole('button', { name: /导出 Word/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/3,420 字/)).not.toBeInTheDocument()
    expect(screen.getByText(/导出.*尚未接入/)).toBeInTheDocument()

    rerender(<ComplianceDrawer />)
    expect(screen.queryByText(/合规率 100%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026 最新/)).not.toBeInTheDocument()
    expect(screen.getByText(/合规审查.*尚未接入/)).toBeInTheDocument()
  })

  it('does not claim a paid lifetime license is active when the API reports community preview', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      ok: true,
      license: null,
      plans: [{ id: 'free_community', name: '社区免费版', price: '免费', features: [], current: true }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<MembershipView />)
    await screen.findByTestId('membership-no-license')
    expect(screen.queryByText('● 终身买断已激活')).not.toBeInTheDocument()
    expect(screen.queryByText(/离线校验 · 即时解锁/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/正式购买与激活服务尚未上线/)).toBeInTheDocument())
  })
})
