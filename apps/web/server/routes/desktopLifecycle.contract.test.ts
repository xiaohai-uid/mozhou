import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { createMoZhouApiRouter } from '../api.js'

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createNetServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => {
      s.close(() => resolve(true))
    })
    s.listen(port, '127.0.0.1')
  })
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer()
    s.once('error', (err) => reject(err))
    s.once('listening', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
    s.listen(0, '127.0.0.1')
  })
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderDiagnosticsHtml(
  port: number,
  errorMessage: string,
  logs: string[],
  dataRoot: string
): string {
  const escErr = escapeHtml(errorMessage)
  const escLogs = escapeHtml(logs.join('\n'))
  const escRoot = escapeHtml(dataRoot)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>墨舟 · 本地创作引擎诊断</title>
</head>
<body>
  <div class="panel">
    <h1>墨舟 · 本地创作引擎诊断</h1>
    <div class="error">${escErr}</div>
    <div class="port">${port}</div>
    <div class="data-root">${escRoot}</div>
    <pre class="logs">${escLogs}</pre>
  </div>
</body>
</html>`
}

describe('Tauri 桌面端服务生命周期契约测试', () => {
  it('1. 端口探测能够正确识别已占用端口与可用空闲端口', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    expect(port).toBeGreaterThan(0)

    const availableBefore = await isPortAvailable(port)
    expect(availableBefore).toBe(false)

    await new Promise<void>((resolve) => server.close(() => resolve()))

    const availableAfter = await isPortAvailable(port)
    expect(availableAfter).toBe(true)
  })

  it('2. 自动选择端口能返回合法的非零端口', async () => {
    const port = await findAvailablePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  it('3. 本地健康检查探针 /api/health 返回标准就绪状态', async () => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const res = await fetch(`http://127.0.0.1:${port}/api/health`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; status: string; dataRoot: string }
    expect(json.ok).toBe(true)
    expect(json.status).toBe('ok')
    expect(json.dataRoot).toBeDefined()

    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('4. 诊断页面生成具备防 XSS 与完整的诊断元数据', () => {
    const html = renderDiagnosticsHtml(
      5173,
      '<script>alert("crash")</script>',
      ['[stderr] EADDRINUSE: port 5173'],
      'C:\\Users\\Mock\\AppData\\Local\\MoZhou'
    )
    expect(html).toContain('墨舟 · 本地创作引擎诊断')
    expect(html).toContain('5173')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert')
    expect(html).toContain('EADDRINUSE')
    expect(html).toContain('MoZhou')
  })
})
