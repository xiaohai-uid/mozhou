// @vitest-environment node
/**
 * 漫剧分镜路由集成测试（T02 · 黑盒真实 HTTP + 真实临时书磁盘）：
 * - source：磁盘字节 hash + 标题 + 预览；空章 400；缺章 404；
 * - save：新建（服务端铸 id/revision=1）→ 重启语义（新 HTTP 实例再读）一致；
 *   expectedRevision 不符 → 409 且上次有效文件不动；越界 id 拒绝；
 *   书身份伪冒拒绝；源章缺失拒绝；损坏文件列表如实计数、不拖垮列表；
 * - 模型输出按不可信 JSON：空镜头/引用不存在角色/order 断档 → 400 不落盘；
 * - stale：改原文后读取/列表如实标 stale（保存仍允许——人工编辑优先）；
 * - 改编不触碰正文：除作者显式改原文外，prose 文件 hash 全程不变。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiMiddleware } from '../../server/api.js'
import { createBook, proseChapterPath, renderProseChapter, atomicReplace, sha256Hex } from '@mozhou/data-plane'

let servers: ReturnType<typeof createServer>[] = []
let roots: string[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
})

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => { res.statusCode = 404; res.end('nf') })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

const CH1_PROSE = '雾从灯塔脚下漫上来的时候，程蔚把最后一格电池按进了录音机。她数着秒，等那句一定会来的话。'

function makeBookWithChapter(bodyText: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-web-storyboard-'))
  roots.push(dir)
  createBook({ dir, title: '雾港失真' })
  writeFileSync(
    join(dir, proseChapterPath(1)),
    renderProseChapter({
      mozhouId: 'chapter_01JBGZ00000000000000000000',
      revision: 1,
      chapterIndex: 1,
      phase: 'draft',
      body: bodyText,
    }),
  )
  return dir
}

function validDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: '',
    revision: 0,
    title: '灯塔夜谈（分镜）',
    source: { bookId: 'bk_placeholder', chapterIndex: 1, revision: 1, phase: 'draft', sha256: '0'.repeat(64) },
    options: { aspectRatio: '9:16', targetDurationSeconds: 90, visualStyle: '雾港冷银蓝', language: 'zh-CN' },
    characters: [
      { id: 'cheng_wei', name: '程蔚', appearance: '短发记者，风衣', origin: 'source' },
    ],
    shots: [
      {
        id: 'shot_01', sceneId: 'scene_01', order: 1, location: '灯塔脚下', timeOfDay: '夜',
        framing: 'wide', cameraMovement: 'slow push-in',
        visual: '浓雾漫上礁石，灯塔黑影立于雾线之上',
        characterIds: ['cheng_wei'],
        dialogue: [{ speakerId: 'cheng_wei', text: '你听，潮水退下去的声音。' }],
        narration: '', sound: '退潮卵石声',
        estimatedDurationSeconds: 6, imagePrompt: 'wide lighthouse in fog', videoPrompt: 'slow push',
        negativePrompt: 'text, watermark', sourceQuote: '雾从灯塔脚下漫上来', origin: 'source',
        adaptationNote: '开场定调',
      },
    ],
    warnings: [],
    generation: { provider: 'test', model: 'test-model' },
    totalEstimatedDurationSeconds: 6,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  }
}

let currentRoot = ''

/** 保存前用真实快照回填 bookId/sha256（模拟客户端从 source 接口拿到服务端值）。 */
async function preparedDocument(base: string, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { data } = await post(base, '/api/storyboard.source', { root: currentRoot, chapterIndex: 1 })
  const source = data['source'] as Record<string, unknown>
  return validDocument({ source, ...overrides })
}

describe('POST /api/storyboard.source（T02 源快照）', () => {
  it('返回磁盘字节 hash、标题、字数与预览；正文文件全程未被修改', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const proseHashBefore = sha256Hex(readFileSync(join(root, proseChapterPath(1))))
    const base = await listen()

    const { status, data } = await post(base, '/api/storyboard.source', { root, chapterIndex: 1 })
    expect(status).toBe(200)
    expect(data['ok']).toBe(true)
    const source = data['source'] as Record<string, unknown>
    expect(source['sha256']).toBe(proseHashBefore)
    expect(String(source['bookId'])).toMatch(/^book_/)
    expect(source['phase']).toBe('draft')
    expect(data['title']).toBeTruthy()
    expect(data['characterCount']).toBe(CH1_PROSE.length)
    expect((data['excerpt'] as string).length).toBeLessThanOrEqual(400)
    expect(sha256Hex(readFileSync(join(root, proseChapterPath(1))))).toBe(proseHashBefore)
  })

  it('空章 400；缺章 404；root 越界 400', async () => {
    makeBookWithChapter('　\n')
    const base1 = await listen()
    const empty = await post(base1, '/api/storyboard.source', { root: roots[0], chapterIndex: 1 })
    expect(empty.status).toBe(400)

    makeBookWithChapter('有内容的章。')
    const base2 = await listen()
    const missing = await post(base2, '/api/storyboard.source', { root: roots[1], chapterIndex: 9 })
    expect(missing.status).toBe(404)

    const evil = await post(base2, '/api/storyboard.source', { root: 'C:/Windows/System32', chapterIndex: 1 })
    expect(evil.status).toBe(400)
  })
})

describe('POST /api/storyboard.save（T02 独立存储）', () => {
  it('新建：服务端铸 id/revision=1/总时长重算；重读（重启语义）一致；文件落 adaptations/storyboards', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()
    const doc = await preparedDocument(base, {
      shots: [{
        id: 'shot_01', sceneId: 's1', order: 1, location: '灯塔', timeOfDay: '夜', framing: 'wide',
        cameraMovement: 'static', visual: '画面', characterIds: ['cheng_wei'],
        dialogue: [{ speakerId: 'cheng_wei', text: '台词' }], narration: '', sound: '',
        estimatedDurationSeconds: 5.555, imagePrompt: '', videoPrompt: '', negativePrompt: '',
        sourceQuote: '雾从灯塔脚下', origin: 'source', adaptationNote: '',
      }],
    })

    const saved = await post(base, '/api/storyboard.save', { root, document: doc, expectedRevision: null })
    expect(saved.status).toBe(200)
    const id = saved.data['id'] as string
    expect(id).toMatch(/^sb_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(saved.data['revision']).toBe(1)
    expect(saved.data['sourceStale']).toBe(false)
    expect(existsSync(join(root, 'adaptations', 'storyboards', `${id}.json`))).toBe(true)

    // 磁盘上的总时长是服务端重算值（5.555 → 5.56），不是输入自报
    const stored = JSON.parse(readFileSync(join(root, 'adaptations', 'storyboards', `${id}.json`), 'utf8')) as Record<string, unknown>
    expect(stored['totalEstimatedDurationSeconds']).toBe(5.56)

    // “重启”语义：新 HTTP 实例读同一文件一致
    const base2 = await listen()
    const again = await post(base2, '/api/storyboard', { root, id })
    expect(again.status).toBe(200)
    expect((again.data['document'] as Record<string, unknown>)['id']).toBe(id)
    expect(again.data['sourceStale']).toBe(false)
  })

  it('409 冲突：expectedRevision 过期拒绝，上次有效文件不动；正确 revision 更新 → r2', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()
    const doc = await preparedDocument(base)
    const saved = await post(base, '/api/storyboard.save', { root, document: doc, expectedRevision: null })
    expect(saved.status).toBe(200)
    const id = saved.data['id'] as string
    const filePath = join(root, 'adaptations', 'storyboards', `${id}.json`)
    const bytesBefore = readFileSync(filePath)
    const fullDoc = validDocument({ ...(doc), id })

    const staleUpdate = await post(base, '/api/storyboard.save', { root, document: fullDoc, expectedRevision: 0 })
    expect(staleUpdate.status).toBe(409)
    expect(staleUpdate.data['code']).toBe('STORYBOARD_REVISION_CONFLICT')
    expect(staleUpdate.data['storedRevision']).toBe(1)
    expect(readFileSync(filePath)).toEqual(bytesBefore)

    const goodUpdate = await post(base, '/api/storyboard.save', { root, document: fullDoc, expectedRevision: 1 })
    expect(goodUpdate.status).toBe(200)
    expect(goodUpdate.data['revision']).toBe(2)
  })

  it('路径安全：伪造 id 越界拒绝；书身份伪冒拒绝；源章缺失拒绝', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()

    const traversal = await post(base, '/api/storyboard', { root, id: '../../book.json' })
    expect(traversal.status).toBe(400)

    const forged = await preparedDocument(base, {
      source: { bookId: 'bk_forged0000000000000000000000', chapterIndex: 1, revision: 1, phase: 'draft', sha256: 'a'.repeat(64) },
    })
    const forgedRes = await post(base, '/api/storyboard.save', { root, document: forged, expectedRevision: null })
    expect(forgedRes.status).toBe(400)
    expect(forgedRes.data['code']).toBe('STORYBOARD_INVALID')

    const real = await post(base, '/api/storyboard.source', { root, chapterIndex: 1 })
    const realSource = real.data['source'] as Record<string, unknown>
    const missingChapter = await preparedDocument(base, {
      source: { ...realSource, chapterIndex: 42 },
    })
    const missing = await post(base, '/api/storyboard.save', { root, document: missingChapter, expectedRevision: null })
    expect(missing.status).toBe(404)
    expect(missing.data['code']).toBe('CHAPTER_MISSING')
  })

  it('模型输出不可信：空镜头/引用不存在角色/order 断档 → 400 且不落盘', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()

    const baseShot = {
      id: 'shot_x', sceneId: 's', order: 1, location: 'l', timeOfDay: '夜', framing: 'wide',
      cameraMovement: 'c', visual: 'v', characterIds: [], dialogue: [], narration: '', sound: '',
      estimatedDurationSeconds: 3, imagePrompt: '', videoPrompt: '', negativePrompt: '',
      sourceQuote: '', origin: 'adaptation', adaptationNote: '',
    }
    const badCases: Record<string, unknown>[] = [
      validDocument({ shots: [] }),
      validDocument({
        characters: [{ id: 'someone_else', name: '别人', appearance: 'x', origin: 'source' }],
      }),
      validDocument({
        shots: [
          { ...baseShot, id: 'a', order: 1 },
          { ...baseShot, id: 'b', order: 3 },
        ],
      }),
    ]
    for (const [i, bad] of badCases.entries()) {
      const doc = await preparedDocument(base, bad)
      const res = await post(base, '/api/storyboard.save', { root, document: doc, expectedRevision: null })
      expect(res.status, `case ${i} should reject`).toBe(400)
      expect(res.data['code'], `case ${i} code`).toBe('STORYBOARD_INVALID')
    }
    expect(existsSync(join(root, 'adaptations'))).toBe(false) // 全部拒绝 → 目录都不该建
  })

  it('stale：改原文后读取/列表如实标 stale；stale 不拦截人工保存', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()
    const doc = await preparedDocument(base)
    const saved = await post(base, '/api/storyboard.save', { root, document: doc, expectedRevision: null })
    const id = saved.data['id'] as string

    // 作者显式改原文（分镜链路绝不改它——此处是测试模拟作者操作）
    const raw = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    atomicReplace(root, proseChapterPath(1), raw.replace('录音机', '旧收音机'))

    const after = await post(base, '/api/storyboard', { root, id })
    expect(after.status).toBe(200)
    expect(after.data['sourceStale']).toBe(true)
    const list = await post(base, '/api/storyboards', { root })
    const items = list.data['items'] as { id: string; sourceStale: boolean }[]
    expect(items.find((it) => it.id === id)?.sourceStale).toBe(true)

    const resume = await post(base, '/api/storyboard.save', {
      root, document: validDocument({ ...(after.data['document'] as Record<string, unknown>), id }), expectedRevision: 1,
    })
    expect(resume.status).toBe(200)
    expect(resume.data['sourceStale']).toBe(true)
  })

  it('损坏文件：列表如实计数 skippedInvalid；直接读坏文件 500 且文件保留', async () => {
    const root = makeBookWithChapter(CH1_PROSE)
    currentRoot = root
    const base = await listen()
    const doc = await preparedDocument(base)
    const saved = await post(base, '/api/storyboard.save', { root, document: doc, expectedRevision: null })
    const goodId = saved.data['id'] as string

    writeFileSync(join(root, 'adaptations', 'storyboards', 'sb_00000000000000000000000000.json'), '{broken json')
    const list = await post(base, '/api/storyboards', { root })
    expect(list.status).toBe(200)
    expect(list.data['skippedInvalid']).toBe(1)
    expect((list.data['items'] as unknown[]).length).toBe(1)

    const broken = await post(base, '/api/storyboard', { root, id: 'sb_00000000000000000000000000' })
    expect(broken.status).toBe(500)
    expect(existsSync(join(root, 'adaptations', 'storyboards', 'sb_00000000000000000000000000.json'))).toBe(true)
    const good = await post(base, '/api/storyboard', { root, id: goodId })
    expect(good.status).toBe(200)
  })
})

describe('POST /api/storyboard.generate（provider 缺失语义）', () => {
  it('无 provider key → 503 PROVIDER_UNAVAILABLE（明确不可用，不生成假分镜），不写盘', async () => {
    vi.stubEnv('MOZHOU_API_KEY', '')
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    try {
      const root = makeBookWithChapter(CH1_PROSE)
      currentRoot = root
      const base = await listen()
      const { data: src } = await post(base, '/api/storyboard.source', { root, chapterIndex: 1 })
      const res = await post(base, '/api/storyboard.generate', {
        root, chapterIndex: 1,
        expectedSourceHash: (src['source'] as Record<string, unknown>)['sha256'],
        options: { aspectRatio: '9:16', targetDurationSeconds: 90, visualStyle: '雾港冷银蓝', language: 'zh-CN' },
      })
      expect(res.status).toBe(503)
      expect(res.data['code']).toBe('PROVIDER_UNAVAILABLE')
      expect(existsSync(join(root, 'adaptations'))).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
