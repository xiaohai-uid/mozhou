// @vitest-environment node
/**
 * 行内选区 AI 编辑 Accept / Reject 决策观测写入与 Commit 飞轮闭环测试（CHG-20261006-06）。
 *
 * 覆盖：
 * 1. POST /api/prose.edit.decision 接收 accepted 决策，账本中成功写入 CandidateCreated 与 UserEditRecorded(candidate_decision)；
 * 2. POST /api/prose.edit.decision 接收 rejected 决策，两路相反记录；
 * 3. 错误校验：缺失 candidateId、非法的 decision 枚举返回 400；
 * 4. 真实偏好画像提取：决策记录后成功被 runPreferenceLearning 提取并折叠；
 * 5. 章节 Commit 后自动运行 runPreferenceLearning 推进偏好画像游标与物化。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { readPipelineLedger } from '@mozhou/pipeline'
import { hasMaterializedProfile, loadProfileSnapshot } from '@mozhou/flywheel'

let servers: ReturnType<typeof createServer>[] = []
const tempDirs: string[] = []

beforeEach(() => {
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
})

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

function makeDataRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-decision-test-'))
  tempDirs.push(dir)
  return dir
}

interface Booked {
  base: string
  root: string
}

async function createBook(dataRoot: string): Promise<Booked> {
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const created = await fetch(base + '/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '决策观测测试书' }),
  })
  expect(created.status).toBe(200)
  const book = (await created.json()) as { ok: boolean; root: string }
  return { base, root: book.root }
}

describe('proseEditDecision 观测写入与飞轮闭环', () => {
  it('1. /api/prose.edit.decision 记录 accepted 决策，账本产生双候选与择优事件', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/prose.edit.decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        editCandidateId: 'cand_accept_101',
        decision: 'accepted',
        selectedText: '原本的一句话。',
        proposedText: 'AI 扩写的更加生动优美的句子，带有丰富的细节。',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      candidateId: string
      editCandidateId: string
      decision: string
      acceptedOptionIds: string[]
      rejectedOptionIds: string[]
    }
    expect(json.ok).toBe(true)
    expect(json.decision).toBe('accepted')
    expect(json.acceptedOptionIds).toEqual(['cand_accept_101'])
    expect(json.rejectedOptionIds).toEqual(['orig_cand_accept_101'])

    // 检查账本是否真实落账
    const ledger = readPipelineLedger(root)
    const candidatesCreated = ledger.filter((r) => r.kind === 'task' && r.event.type === 'CandidateCreated')
    expect(candidatesCreated.length).toBe(2)
    const decisions = ledger.filter(
      (r) => r.kind === 'task' && r.event.type === 'UserEditRecorded' && r.event.payload?.['action'] === 'candidate_decision',
    )
    expect(decisions.length).toBe(1)
    const firstDecision = decisions[0]
    expect(firstDecision).toBeDefined()
    if (firstDecision?.kind === 'task') {
      expect(firstDecision.event.payload?.['acceptedOptionIds']).toEqual(['cand_accept_101'])
    }
  })

  it('2. /api/prose.edit.decision 记录 rejected 决策，原候选为 accepted，AI 候选为 rejected', async () => {
    const { base, root } = await createBook(makeDataRoot())

    const res = await fetch(base + '/api/prose.edit.decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        editCandidateId: 'cand_reject_202',
        decision: 'rejected',
        selectedText: '作者坚守的原句。',
        proposedText: 'AI 提出的被否决改写方案。',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      candidateId: string
      decision: string
      acceptedOptionIds: string[]
      rejectedOptionIds: string[]
    }
    expect(json.ok).toBe(true)
    expect(json.decision).toBe('rejected')
    expect(json.acceptedOptionIds).toEqual(['orig_cand_reject_202'])
    expect(json.rejectedOptionIds).toEqual(['cand_reject_202'])
  })

  it('3. 非法请求参数防御性拒绝', async () => {
    const { base, root } = await createBook(makeDataRoot())

    // 缺少 candidateId
    const res1 = await fetch(base + '/api/prose.edit.decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        decision: 'accepted',
      }),
    })
    expect(res1.status).toBe(400)

    // 非法 decision
    const res2 = await fetch(base + '/api/prose.edit.decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        editCandidateId: 'cand_999',
        decision: 'maybe',
      }),
    })
    expect(res2.status).toBe(400)
  })

  it('4. 章节 Commit 触发后，偏好画像成功折叠新观测并物化', async () => {
    const { base, root } = await createBook(makeDataRoot())

    // 1. 保存第 1 章草稿
    const saveRes = await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        body: '“夜色深沉。”林远拔出了长剑，目光如雪。\n剑锋映着月光，寒意逼人。',
        expectedRevision: null,
      }),
    })
    expect(saveRes.status).toBe(200)
    const saveJson = (await saveRes.json()) as { revision: number }

    // 2. 模拟作者做了一次行内 AI 采纳决策
    const decRes = await fetch(base + '/api/prose.edit.decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        editCandidateId: 'cand_inline_ch1',
        decision: 'accepted',
        selectedText: '目光如雪。',
        proposedText: '目光冷如冰雪，杀意若隐若现。',
      }),
    })
    expect(decRes.status).toBe(200)

    // 3. 提交该章
    const commitRes = await fetch(base + '/api/chapter.commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root,
        chapterIndex: 1,
        expectedRevision: saveJson.revision,
        summary: '第一章定稿',
      }),
    })
    expect(commitRes.status).toBe(200)

    // 4. 验证偏好学习器已成功物化 profile
    expect(hasMaterializedProfile(root)).toBe(true)
    const profile = loadProfileSnapshot(root)
    expect(profile).not.toBeNull()
    expect(profile!.obsCount).toBeGreaterThan(0)
    expect(profile!.cursor).toBeGreaterThan(0)
  })
})
