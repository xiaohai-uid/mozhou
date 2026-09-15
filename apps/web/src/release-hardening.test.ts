// @vitest-environment node
import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../server/api'
import { LocalDataPlane } from '@mozhou/data-plane'

const servers: ReturnType<typeof createServer>[] = []
const roots: string[] = []

afterEach(() => {
  delete process.env.MOZHOU_DRAFT_PROVIDER
  for (const server of servers.splice(0)) server.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

async function jsonPost(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const data = (await response.json()) as Record<string, unknown>
  return { response, data }
}

function rawJsonPostWithHost(
  base: string,
  path: string,
  hostHeader: string,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const target = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: 'POST',
        headers: {
          Host: hostHeader,
          'Content-Type': 'application/json',
          'Content-Length': '2',
        },
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { raw += chunk })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            data: JSON.parse(raw) as Record<string, unknown>,
          })
        })
      },
    )
    req.on('error', reject)
    req.end('{}')
  })
}

describe('release hardening · HTTP boundary', () => {
  it('rejects an untrusted Host before routing', async () => {
    const base = await listen()
    const { status, data } = await rawJsonPostWithHost(base, '/api/capabilities', 'evil.example')
    expect(status).toBe(403)
    expect(data.code).toBe('UNTRUSTED_HOST')
  })

  it('rejects a foreign browser Origin before routing', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/capabilities', {}, { Origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(data.code).toBe('UNTRUSTED_ORIGIN')
  })

  it('rejects malformed non-empty JSON instead of silently treating it as an empty object', async () => {
    const base = await listen()
    const response = await fetch(base + '/api/capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    })
    const data = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(400)
    expect(data.code).toBe('INVALID_JSON')
  })

  it('rejects JSON request bodies larger than 1 MiB', async () => {
    const base = await listen()
    const response = await fetch(base + '/api/capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 1) }),
    })
    const data = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(413)
    expect(data.code).toBe('BODY_TOO_LARGE')
  })
})

describe('release hardening · truthful Technical Preview surfaces', () => {
  it('does not fabricate an active paid license', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/membership', {})
    expect(response.status).toBe(200)
    expect(data.license).toBeNull()
  })

  it('reports license activation as not implemented instead of accepting format-only keys', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/membership.activate', { key: 'MOZHOU-PRO-LIFETIME-TEST' })
    expect(response.status).toBe(501)
    expect(data.code).toBe('LICENSE_ACTIVATION_NOT_IMPLEMENTED')
  })

  it('reports backup as unavailable instead of returning a fabricated archive digest/path', async () => {
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-hardening-'))
    roots.push(dir)
    const created = await jsonPost(base, '/api/book', { title: '真实备份测试', dir })
    const root = created.data.root as string
    const { response, data } = await jsonPost(base, '/api/cloud-sync.backup', { root })
    expect(response.status).toBe(501)
    expect(data.code).toBe('BACKUP_NOT_IMPLEMENTED')
    expect(JSON.stringify(data)).not.toContain('sha256_mock_snapshot_digest')
  })

  it('does not fabricate a novel breakdown when no real breakdown provider is wired', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/novel-breakdown', { sampleText: '真实样本文本' })
    expect(response.status).toBe(501)
    expect(data.code).toBe('NOVEL_BREAKDOWN_NOT_IMPLEMENTED')
    expect(data.result).toBeUndefined()
  })

  it('does not present the built-in knowledge demo as live web search', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/web-search', { query: '唐代夜禁' })
    expect(response.status).toBe(501)
    expect(data.code).toBe('WEB_SEARCH_NOT_CONFIGURED')
    expect(data.results).toBeUndefined()
  })

  it('rank scan never falls back to fabricated boards or fabricated heat values', async () => {
    const base = await listen()
    const { response, data } = await jsonPost(base, '/api/rank-scan', {})
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('惹金枝')
    expect(serialized).not.toContain('98.5万在读')
    expect(serialized).not.toContain('长生苟道')
    expect(response.status).toBe(501)
    expect(data.ok).toBe(false)
    expect(data.code).toBe('RANK_SOURCE_NOT_CONFIGURED')
    expect(data.boards).toBeUndefined()
  })
})

describe('release hardening · core draft context', () => {
  it('includes the current book identity in the model-facing draft prompt/context', async () => {
    process.env.MOZHOU_DRAFT_PROVIDER = 'mock'
    const base = await listen()
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-draft-context-'))
    roots.push(dir)
    const created = await jsonPost(base, '/api/book', { title: '长篇上下文之书', dir })
    const root = created.data.root as string
    // C2（T04）：draft.stream 需要 draft 相位章（候选模式前置）
    const plane = LocalDataPlane.open(root)
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    } finally {
      plane.close()
    }

    const response = await fetch(base + '/api/draft.stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, prompt: '继续这一章', activeSkills: [] }),
    })
    expect(response.status).toBe(200)
    const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const start = lines.find((line) => line.event === 'start')
    expect(start?.prompt).toContain('长篇上下文之书')
  })
})
