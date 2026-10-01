import { createServer, type Server } from 'node:http'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopToolModals } from './DesktopToolModals'

let server: Server | undefined
const nativeFetch = globalThis.fetch

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    server = undefined
  }
})

describe('作品导出失败与重试（真实 HTTP，未替换导出工作流）', () => {
  it('读取作品失败后显示原因，恢复按钮并允许重试', async () => {
    let requests = 0
    server = createServer((_req, res) => {
      requests++
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = requests === 1 ? 503 : 200
      res.end(JSON.stringify(requests === 1
        ? { ok: false, error: '作品暂时无法读取' }
        : { ok: true, chapters: [] }))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      nativeFetch(new URL(input, `http://127.0.0.1:${address.port}`), init))

    const user = userEvent.setup()
    render(<DesktopToolModals activeModal="export" book={{ root: 'C:/isolated-book', bookId: 'test-book', title: '测试作品' }} onClose={() => {}} />)
    await user.click(screen.getByRole('checkbox'))
    const button = screen.getByRole('button', { name: '打包全本《测试作品》并下载' })
    await user.click(button)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('作品暂时无法读取'))
    expect(button).toBeEnabled()
    expect(screen.queryByText('正在准备导出文件…')).not.toBeInTheDocument()
    await user.click(button)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂无正文章节内容'))
    expect(requests).toBe(2)
    expect(button).toBeEnabled()
  })

  it('导出未结束时阻止重复点击，失败后保留样章内容', async () => {
    let finish: (() => void) | undefined
    let requests = 0
    server = createServer((_req, res) => {
      requests++
      finish = () => {
        res.statusCode = 409
        res.end('export rejected')
      }
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP server address missing')
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      nativeFetch(new URL(input, `http://127.0.0.1:${address.port}`), init))

    const user = userEvent.setup()
    render(<DesktopToolModals activeModal="export" onClose={() => {}} />)
    const sample = screen.getByPlaceholderText(/章节或样章内容/)
    await user.type(sample, '这是作者保留的样章。')
    const button = screen.getByRole('button', { name: '打包下载本地作品' })
    await user.click(button)
    await waitFor(() => expect(requests).toBe(1))
    expect(button).toBeDisabled()
    await user.click(button)
    expect(requests).toBe(1)
    finish!()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('HTTP 409'))
    expect(button).toBeEnabled()
    expect(sample).toHaveValue('这是作者保留的样章。')
  })
})
