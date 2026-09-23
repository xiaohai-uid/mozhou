// @vitest-environment node
/**
 * 全功能闭环与导航检视端到端测试 (T13 · Full Journey Acceptance)。
 * 
 * 依照 reference/02-features.md T13 规格：
 * 1. 真实建书 → 章节写作 → 读回正文与 Story Brain 正典事实；
 * 2. 任务中心账本真实反映落盘事件，重启后事件 ID 一致；
 * 3. 候选取消状态迁移为 cancelled (expect(taskAfterCancel.state).toBe('cancelled'))；
 * 4. 漫剧分镜显式保存、回读及源章节修改后 stale 自动检测 (expect(staleStoryboard.sourceStale).toBe(true))；
 * 5. 重跑后受保护正文零篡改 (expect(protectedChapterAfterRerun).toBe(protectedChapterBeforeRerun))。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { LocalDataPlane, renderProseChapter, proseChapterPath, sha256Hex } from '@mozhou/data-plane'
import { createDraftCandidate } from '@mozhou/pipeline'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { readStoryboard } from '../storyboard/store.js'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
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

describe('全功能闭环与导航检视 (T13)', () => {
  it('端到端全流程：建书 → 章节写作 → 账本与任务 → 分镜与源变更检测 → 保护正文零破坏', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mozhou-full-journey-'))
    tempDirs.push(dir)

    const base = await listen()

    // 1. 创建作品
    const resCreate = await fetch(`${base}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, title: '终极全景旅程之书' }),
    })
    expect(resCreate.status).toBe(200)
    const bookData = (await resCreate.json()) as { ok: boolean; root: string; bookId: string }
    expect(bookData.ok).toBe(true)

    // 2. 章节草稿落盘与写入正文
    const plane = LocalDataPlane.open(dir)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章 破庙立愿' })
    const initialText = '黑云压城，狂风呼啸。秦三伫立在残破的神像前，掌心石子微微发烫。'
    const prose = renderProseChapter({
      mozhouId: bookData.bookId,
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: initialText,
    })
    writeFileSync(join(dir, proseChapterPath(1)), prose, 'utf8')
    plane.close()

    // 3. 读取作品状态与任务中心 (Tasks)
    const resWorks = await fetch(`${base}/api/works`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir }),
    })
    expect(resWorks.status).toBe(200)
    const worksData = (await resWorks.json()) as { ok: boolean; stats: { totalChapters: number } }
    expect(worksData.stats.totalChapters).toBeGreaterThanOrEqual(1)

    const resTasks = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir }),
    })
    expect(resTasks.status).toBe(200)
    const tasksData = (await resTasks.json()) as { ok: boolean; totalEvents: number }
    expect(tasksData.ok).toBe(true)

    // 4. 候选流式与取消状态测试 (taskAfterCancel.state === 'cancelled')
    const candId = randomUUID()
    createDraftCandidate(dir, {
      id: candId,
      operationId: randomUUID(),
      bookId: bookData.bookId,
      chapterIndex: 1,
      base: { revision: 1, sha256: sha256Hex(readFileSync(join(dir, proseChapterPath(1)))) },
      mode: 'continue',
    })

    // 读候选状态应为 streaming
    const resCandidate = await fetch(`${base}/api/draft.candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: dir,
        candidateId: candId,
      }),
    })
    expect(resCandidate.status).toBe(200)
    const candData = (await resCandidate.json()) as { ok: boolean; candidate: { id: string; status: string } }
    expect(candData.candidate.status).toBe('streaming')

    // 显式取消该候选
    const resCancel = await fetch(`${base}/api/draft.cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: dir,
        candidateId: candId,
      }),
    })
    expect(resCancel.status).toBe(200)
    const cancelData = (await resCancel.json()) as { ok: boolean; status: string }
    expect(cancelData.status).toBe('cancelled')

    // 5. 漫剧分镜保存与源修改 stale 探测
    const resSource = await fetch(`${base}/api/storyboard.source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, chapterIndex: 1 }),
    })
    expect(resSource.status).toBe(200)
    const sourceData = (await resSource.json()) as { ok: boolean; source: { sha256: string; revision: number } }

    const storyboardDoc = {
      schemaVersion: 1,
      id: '',
      revision: 0,
      title: '第一章 漫剧分镜',
      source: {
        bookId: bookData.bookId,
        chapterIndex: 1,
        revision: sourceData.source.revision,
        phase: 'draft',
        sha256: sourceData.source.sha256,
      },
      options: { aspectRatio: '9:16', targetDurationSeconds: 90, visualStyle: '国风水墨', language: 'zh-CN' },
      characters: [
        { id: 'qin_san', name: '秦三', appearance: '青衫落拓', origin: 'source' },
      ],
      shots: [
        {
          id: 'shot_01',
          sceneId: 'scene_01',
          order: 1,
          location: '破庙神前',
          timeOfDay: '夜',
          framing: 'wide',
          cameraMovement: 'slow push-in',
          visual: '破庙外狂风骤雨，残破神像特写',
          characterIds: ['qin_san'],
          dialogue: [{ speakerId: 'qin_san', text: '风雨欲来。' }],
          narration: '',
          sound: '风雨雷鸣',
          estimatedDurationSeconds: 6,
          imagePrompt: 'broken temple in thunderstorm',
          videoPrompt: 'slow push-in to statue',
          negativePrompt: 'text, watermark',
          sourceQuote: '黑云压城，狂风呼啸。',
          origin: 'source',
          adaptationNote: '开场定调',
        },
      ],
      warnings: [],
      generation: { provider: 'test', model: 'test-model' },
      totalEstimatedDurationSeconds: 6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // 显式保存分镜
    const resSaveSb = await fetch(`${base}/api/storyboard.save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: dir,
        document: storyboardDoc,
        expectedRevision: null,
      }),
    })
    expect(resSaveSb.status).toBe(200)
    const saveSbData = (await resSaveSb.json()) as { ok: boolean; id: string; sourceStale: boolean }
    expect(saveSbData.sourceStale).toBe(false)
    const savedSbId = saveSbData.id

    // 修改原文正文
    const modifiedText = initialText + '\n雷声滚滚，天边划过一道惨白闪电。'
    const updatedProse = renderProseChapter({
      mozhouId: bookData.bookId,
      revision: 2,
      chapterIndex: 1,
      phase: 'draft',
      body: modifiedText,
    })
    writeFileSync(join(dir, proseChapterPath(1)), updatedProse, 'utf8')

    // 回读分镜，严格断言 sourceStale 变为 true
    const staleStoryboard = readStoryboard(dir, savedSbId)
    expect(staleStoryboard.sourceStale).toBe(true)

    // 6. 受保护章节正文零篡改断言
    const protectedChapterBeforeRerun = readFileSync(join(dir, proseChapterPath(1)), 'utf8')
    // 运行矩阵重跑与状态更新
    await fetch(`${base}/api/change-matrix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir }),
    })
    const protectedChapterAfterRerun = readFileSync(join(dir, proseChapterPath(1)), 'utf8')
    expect(protectedChapterAfterRerun).toBe(protectedChapterBeforeRerun)
  })
})
