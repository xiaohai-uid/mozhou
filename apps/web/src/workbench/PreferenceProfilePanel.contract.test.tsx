/** 实际新书路由响应 → 浏览器面板；禁止捏造 mean 数值的隔层夹具。 */
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendObservations, coldStartProfile, posteriorMean, reduce, saveProfileSnapshot, type PreferenceObservation } from '@mozhou/flywheel'
import { createMoZhouApiRouter } from '../../server/api.js'
import { defaultBookAccessManager } from '../../server/bookAccess.js'
import { PreferenceProfilePanel, type PreferenceResponse } from './PreferenceProfilePanel'
import type { BookInfo } from '../shell/workbenchStorage'

const realFetch = globalThis.fetch
const servers: ReturnType<typeof createServer>[] = []
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  defaultBookAccessManager.clear()
})

async function newBook() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'mozhou-preference-contract-'))
  roots.push(dataRoot)
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
  defaultBookAccessManager.setDataRoot(dataRoot)
  const router = createMoZhouApiRouter()
  const server = createServer((req, res) => {
    void router.dispatch(req, res).then((handled) => { if (!handled && !res.writableEnded) { res.statusCode = 404; res.end() } })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('isolated HTTP server has no loopback address')
  const origin = 'http://127.0.0.1:' + address.port
  const post = (path: string, body: Record<string, unknown>) => realFetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const created = await post('/api/book', { title: '偏好契约合成书' })
  expect(created.status).toBe(200)
  const book = await created.json() as BookInfo
  // 只将浏览器相对请求送到这个实际路由；响应没有替换或改造。
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => realFetch(typeof input === 'string' && input.startsWith('/api/') ? origin + input : input, init))
  return { book, post }
}

describe('PreferenceProfilePanel 实际 BFF 数值契约', () => {
  it('新书冷启动和重建响应可直接渲染，先验与零观测明确区分', async () => {
    const { book, post } = await newBook()
    const response = await post('/api/flywheel.preference', { root: book.root })
    expect(response.status).toBe(200)
    const body = await response.json() as PreferenceResponse
    const dim = body.profile.dims['sent_len_mean']
    // 修复前这里得到 S/W/M 等累积字段，四个展示字段均 undefined。
    expect({ materialized: body.materialized, observationCount: body.observationCount, mean: dim?.mean, variance: dim?.variance, nEffective: dim?.nEffective, streak: dim?.streak }).toMatchInlineSnapshot(`
      {
        "materialized": false,
        "mean": 42,
        "nEffective": 0,
        "observationCount": 0,
        "streak": 0,
        "variance": 0,
      }
    `)
    render(<PreferenceProfilePanel book={book} />)
    expect(await screen.findByTestId('preference-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('preference-dim-sent_len_mean').textContent).toMatchInlineSnapshot(`"句子均长42.000短窗方差 0.000 · 样本权 0.0"`)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '重建画像' }))
    expect(await screen.findByText('42.000')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('已有观测的真实持久画像经路由投影，保留原字段并按公有后验均值显示', async () => {
    const { book, post } = await newBook()
    const observation: PreferenceObservation = { obsId: '1', sourcePosition: 1, kind: 'candidate_decision', taskRef: 'synthetic-preference-task', sceneType: null, features: { sent_len_mean: 10 }, w: 1 }
    const persisted = reduce(coldStartProfile(), [observation])
    appendObservations(book.root, [observation])
    saveProfileSnapshot(book.root, persisted)
    const response = await post('/api/flywheel.preference', { root: book.root })
    expect(response.status).toBe(200)
    const body = await response.json() as PreferenceResponse
    const dim = body.profile.dims['sent_len_mean']
    expect(dim?.mean).toBe(posteriorMean('sent_len_mean', persisted.dims.sent_len_mean))
    expect(dim).toMatchObject(persisted.dims.sent_len_mean)
    render(<PreferenceProfilePanel book={book} />)
    expect(await screen.findByText('38.444')).toBeInTheDocument()
    expect({ title: screen.getByText('已物化 (1 条观测)').textContent, readout: screen.getByTestId('preference-dim-sent_len_mean').textContent, empty: screen.queryByTestId('preference-empty-state') !== null }).toMatchInlineSnapshot(`
      {
        "empty": false,
        "readout": "句子均长38.444短窗方差 153.600 · 样本权 1.0",
        "title": "已物化 (1 条观测)",
      }
    `)
  })

  it('累积字段有限但后验溢出时明确失败，面板不把不可用读数伪造为零', async () => {
    const { book, post } = await newBook()
    const profile = coldStartProfile()
    saveProfileSnapshot(book.root, { ...profile, obsCount: 1, dims: { ...profile.dims, sent_len_mean: { ...profile.dims.sent_len_mean, S: Number.MAX_VALUE, kappaEff: Number.MAX_VALUE } } })
    const response = await post('/api/flywheel.preference', { root: book.root })
    expect(response.status).toBe(500)
    render(<PreferenceProfilePanel book={book} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('偏好画像维度 sent_len_mean 包含非有限读数，无法展示')
    expect(screen.queryByTestId('preference-dim-sent_len_mean')).toBeNull()
  })
})
