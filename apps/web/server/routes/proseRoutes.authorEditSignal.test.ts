// @vitest-environment node
/**
 * 步 5 User Edit 接线回归：/api/chapter.prose.save 落作者编辑信号。
 *
 * 被测行为：作者写作层整文保存 → 行级 diff 推导结构化块 → UserEditRecorded 落账
 * （taskRef 与提交侧窗口锚同源 windowTaskRef），使 runStyleLearnerForWindow 在窗口
 * 闭合时**真的读到本窗口的 author 编辑**（此前每窗口零条）。
 *
 * 关键不变量与失败路径：
 *   - taskRef = `web_commit_ch<N>_rev<保存后 revision>`，与 /api/chapter.commit 的
 *     窗口锚同源——否则学习器按 taskRef 精确匹配时读到零条；
 *   - 端到端：保存 → 提交 → 文风.md 数值分面真的更新 + StyleProfileUpdated 落账；
 *   - 作者原样重存（零文本变更）不落事件（零噪声）；
 *   - 信号是派生面：落账失败不阻断保存（200 + 正文已落盘），但 authorEditSignal
 *     如实上报错误（绝不静默）。
 *
 * 提取缝在本文件内替换为夹具（同 proseRoutes.flywheelRecord.test.ts）：本文件只考
 * 保存路径的编辑信号与窗口对齐，不考提取语义。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStyleProfiles, proseChapterPath } from '@mozhou/data-plane'

/** 提取缝夹具：提交走「无候选直提」分支，收尾记账与窗口闭合钩子照常执行。 */
vi.mock('../analysis/deltaExtractor.js', () => ({
  extractChapterDelta: () => ({ appends: {}, counts: {}, dropped: [], extractor: 'none', reason: 'fixture: 无候选' }),
}))

import { apiMiddleware } from '../api.js'

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

/** 12 句短句（>= Nmin=10）：作者一次性写入的整章正文。 */
const AUTHOR_BODY = Array.from({ length: 12 }, (_, i) => `他走了${i + 1}步。`).join('')

const EVENTS_RELPATH = '.mozhou/events.jsonl'

async function makeBook(): Promise<{ base: string; root: string }> {
  const base = await listen()
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-author-edit-'))
  roots.push(root)
  const created = await post(base, '/api/book', { title: '作者编辑信号之书', dir: root })
  expect(created.status).toBe(200)
  return { base, root }
}

/** 任务事件行（PublishBus 包装行）中的 UserEditRecorded 事件序列。 */
function userEditEvents(root: string): Record<string, unknown>[] {
  const path = join(root, EVENTS_RELPATH)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => row['event'])
    .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null)
    .filter((event) => event['type'] === 'UserEditRecorded')
}

function styleUpdateEvents(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, EVENTS_RELPATH), 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => row['event'])
    .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null)
    .filter((event) => event['type'] === 'StyleProfileUpdated')
}

function signalOf(data: Record<string, unknown>): Record<string, unknown> {
  const view = data['authorEditSignal']
  expect(view, JSON.stringify(data)).toBeTypeOf('object')
  return view as Record<string, unknown>
}

describe('POST /api/chapter.prose.save · 步 5 User Edit 接线', () => {
  it('端到端：作者保存 → 提交 → StyleLearner 真的读到本窗口编辑并更新文风.md', async () => {
    const { base, root } = await makeBook()

    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: AUTHOR_BODY, expectedRevision: null,
    })
    expect(saved.status, JSON.stringify(saved.data)).toBe(200)
    expect(signalOf(saved.data)).toEqual({ published: true, blocks: 1, errorDetail: null })

    // 落账事件：taskRef 与提交侧窗口锚同源（保存后 revision = 1 ⇒ rev1）
    const events = userEditEvents(root)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'UserEditRecorded',
      taskRef: 'web_commit_ch1_rev1',
      chapterIndex: 1,
      payload: {
        action: 'edit_blocks',
        level: 'selection',
        source: 'author',
        revision: 1,
        deltaStats: { opsInsert: 1, opsDelete: 0, opsReplace: 0, insertedChars: AUTHOR_BODY.length, removedChars: 0 },
      },
    })

    // 提交：窗口锚 taskRef = web_commit_ch1_rev<盘上 revision> —— 与上面同键
    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)
    expect(committed.data['flywheelRecord']).toMatchObject({ status: 'succeeded', afterRecordError: null })

    // 学习器确实折算了本窗口编辑：数值分面更新 + 审计事件落账（此前恒为 noEdits 零写盘）
    const profiles = readStyleProfiles(root)
    expect(profiles.action.revision).toBe(1)
    expect(profiles.action.sentenceLengthDistribution[0]?.share).toBeGreaterThan(0.15)
    const audits = styleUpdateEvents(root)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ taskRef: 'web_commit_ch1_rev1', chapterIndex: 1 })
    expect((audits[0]?.['payload'] as { sampleCount: number }).sampleCount).toBeGreaterThanOrEqual(10)
  })

  it('连续保存：每次以「本次保存后的 revision」落窗口键，且第二次带本窗口累计链', async () => {
    const { base, root } = await makeBook()
    const first = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '第一版正文。\n', expectedRevision: null,
    })
    expect(first.status).toBe(200)
    const second = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '第一版正文。\n追加一句。\n', expectedRevision: Number(first.data['revision']),
    })
    expect(second.status).toBe(200)
    expect(Number(second.data['revision'])).toBe(Number(first.data['revision']) + 1)

    const events = userEditEvents(root)
    expect(events.map((event) => event['taskRef'])).toEqual(['web_commit_ch1_rev1', 'web_commit_ch1_rev2'])
    // 第二条 = 本窗口累计链（第一段的整篇 insert + 本次增量），而非仅本次增量
    const blocks = (events[1]?.['payload'] as { blocks: { op: string; paragraphStart: number }[] }).blocks
    expect(blocks).toEqual([
      { op: 'insert', paragraphStart: 1, paragraphEnd: 1, replacementText: '第一版正文。' },
      { op: 'insert', paragraphStart: 2, paragraphEnd: 2, replacementText: '追加一句。' },
    ])
  })

  it('复核复现 1：改完再原样重存（无改动）不丢本窗口信号——提交后学习器仍读到编辑', async () => {
    const { base, root } = await makeBook()
    const first = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: AUTHOR_BODY, expectedRevision: null,
    })
    expect(first.status).toBe(200)
    expect(signalOf(first.data)).toEqual({ published: true, blocks: 1, errorDetail: null })

    // 作者改完再原样点一次保存：revision 照常 +1，但本窗口信号必须继续可用
    const again = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: AUTHOR_BODY, expectedRevision: Number(first.data['revision']),
    })
    expect(again.status, JSON.stringify(again.data)).toBe(200)
    expect(signalOf(again.data)).toEqual({ published: true, blocks: 1, errorDetail: null })

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)

    // 窗口键 = 提交时盘上 revision（rev2）——累计链把它带到 rev2，学习器据此读到编辑
    const profiles = readStyleProfiles(root)
    expect(profiles.action.revision).toBe(1)
    const audits = styleUpdateEvents(root)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ taskRef: 'web_commit_ch1_rev2', chapterIndex: 1 })
    expect((audits[0]?.['payload'] as { sampleCount: number }).sampleCount).toBeGreaterThanOrEqual(10)
  })

  it('复核复现 2：多次小增量合成窗口样本（不再因单次增量 < Nmin 而本窗口判零）', async () => {
    const { base, root } = await makeBook()
    const first = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: AUTHOR_BODY, expectedRevision: null,
    })
    expect(first.status).toBe(200)
    // 只追加一句：单看本次增量 = 1 条正观测（< Nmin=10，改前本窗口等于零学习）
    const second = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: `${AUTHOR_BODY}他又走了一步。`, expectedRevision: Number(first.data['revision']),
    })
    expect(second.status).toBe(200)

    const events = userEditEvents(root)
    expect(events.map((event) => event['taskRef'])).toEqual(['web_commit_ch1_rev1', 'web_commit_ch1_rev2'])
    // 累计链两条：第一次整篇 insert（12 句）+ 第二次 replace（13 句）
    expect((events[1]?.['payload'] as { blocks: unknown[] }).blocks).toHaveLength(2)

    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)

    // 数值分面真的更新（改前：sampleCount=1 < Nmin ⇒ action.revision 恒 0）
    const profiles = readStyleProfiles(root)
    expect(profiles.action.revision).toBe(1)
    const audits = styleUpdateEvents(root)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ taskRef: 'web_commit_ch1_rev2', chapterIndex: 1 })
    // 口径：累计链按块折算正观测（12 + 13 = 25，非去重；被后续改写覆盖的早期文本也计入）
    expect((audits[0]?.['payload'] as { sampleCount: number }).sampleCount).toBe(25)
  })

  it('窗口边界：提交+重开后首个窗口原样保存 ⇒ 本窗口无编辑可落，不落事件（零噪声）', async () => {
    const { base, root } = await makeBook()
    const created = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '一字未改。\n', expectedRevision: null,
    })
    expect(created.status).toBe(200)
    const committed = await post(base, '/api/chapter.commit', { root, chapterIndex: 1, summary: '定稿' })
    expect(committed.status, JSON.stringify(committed.data)).toBe(200)
    const reopened = await post(base, '/api/chapter.reopen', { root, chapterIndex: 1 })
    expect(reopened.status).toBe(200)
    const before = userEditEvents(root).length

    // 重开即新窗口（ChapterReopened 是窗口终结行）：原样保存 ⇒ 上一窗口的编辑不被累积
    const snap = await post(base, '/api/chapter.prose', { root, chapterIndex: 1 })
    const same = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: String(snap.data['body']), expectedRevision: Number(snap.data['revision']),
    })
    expect(same.status, JSON.stringify(same.data)).toBe(200)
    expect(signalOf(same.data)).toEqual({ published: false, blocks: 0, errorDetail: null })
    expect(userEditEvents(root)).toHaveLength(before)
  })

  it('落账失败不阻断保存（S12 同款降级）：200 + 正文已落盘 + 错误可见 + 零事件行', async () => {
    const { base, root } = await makeBook()
    // 故障注入：把账本路径占成目录 ⇒ PublishBus 读取/追加必抛（EISDIR）
    rmSync(join(root, EVENTS_RELPATH), { force: true })
    mkdirSync(join(root, EVENTS_RELPATH), { recursive: true })

    const saved = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: AUTHOR_BODY, expectedRevision: null,
    })
    expect(saved.status, JSON.stringify(saved.data)).toBe(200)
    // 正文照常落定（派生面失败不回退权威写路径）
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toContain(AUTHOR_BODY)
    const signal = signalOf(saved.data)
    expect(signal['published']).toBe(false)
    expect(signal['blocks']).toBe(0)
    expect(String(signal['errorDetail'])).toContain('EISDIR')

    // 零事件行：占位目录移除后账本文件从未被建出
    rmSync(join(root, EVENTS_RELPATH), { recursive: true, force: true })
    expect(existsSync(join(root, EVENTS_RELPATH))).toBe(false)
  })

  it('冲突路径零事件：409 拒绝的保存不得落编辑信号', async () => {
    const { base, root } = await makeBook()
    const created = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '基线。\n', expectedRevision: null,
    })
    expect(created.status).toBe(200)
    const before = userEditEvents(root).length

    const conflict = await post(base, '/api/chapter.prose.save', {
      root, chapterIndex: 1, body: '过期版本。\n', expectedRevision: Number(created.data['revision']) + 5,
    })
    expect(conflict.status).toBe(409)
    expect(conflict.data['code']).toBe('PROSE_REVISION_CONFLICT')
    expect(userEditEvents(root)).toHaveLength(before)
  })
})
