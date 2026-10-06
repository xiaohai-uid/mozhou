// @vitest-environment node
/**
 * 移动端三闭环服务端契约测试（CHG-20261006-07）。
 *
 * 覆盖：
 * 1. 真实章节张力与情绪波峰时序：/api/chapter.tension（无数据/短文本诚实不可用；真实文本纯数据驱动波形与描述，零硬编码）；
 * 2. 技能胶囊映射：decoratePromptWithSkills 映射 conflict, concise, foreshadow 及其别名；
 * 3. 版本时光机 sidecar、Diff 与恢复：
 *    - /api/chapter.history 读取历史版本快照；
 *    - /api/chapter.history.diff 对比 r8 与 r12 真实段落差异；
 *    - /api/chapter.history.restore 恢复 r8 创建新版本 r13（body=r8），且 r8~r12 历史完整保留。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { decoratePromptWithSkills } from './pipelineRoutes.js'
import { computeParagraphDiff, computeChapterTension } from './proseRoutes.js'

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
      // Windows 容错
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
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-mobile-test-'))
  tempDirs.push(dir)
  return dir
}

async function createTestBook(dataRoot: string): Promise<{ base: string; root: string }> {
  defaultBookAccessManager.setDataRoot(dataRoot)
  const base = await listen()
  const created = await fetch(base + '/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '移动端闭环书' }),
  })
  const book = (await created.json()) as { ok: boolean; root: string }
  return { base, root: book.root }
}

describe('移动端闭环 1 · 真实章节张力与情绪波峰分析 (/api/chapter.tension)', () => {
  it('章节未创建或正文太短时：诚实返回 available=false，绝不伪造点', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createTestBook(dataRoot)

    // 章节未创建
    const resEmpty = await fetch(base + '/api/chapter.tension', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    expect(resEmpty.status).toBe(200)
    const jsonEmpty = (await resEmpty.json()) as { ok: boolean; available: boolean }
    expect(jsonEmpty.ok).toBe(true)
    expect(jsonEmpty.available).toBe(false)

    // 保存极短正文 (<20 字)
    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: null, body: '短文本' }),
    })

    const resShort = await fetch(base + '/api/chapter.tension', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    const jsonShort = (await resShort.json()) as { ok: boolean; available: boolean }
    expect(jsonShort.ok).toBe(true)
    expect(jsonShort.available).toBe(false)
  })

  it('真实章节正文：计算真实张力时序点与波峰描述，无硬编码序列', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createTestBook(dataRoot)

    const fullChapterText = [
      '夜色如墨，狂风呼啸着掠过断崖。',
      '少年拔剑而立，眼中杀意毕露！“今日你我，唯有一人能活着走出这黑风岭！”',
      '黑衣人冷笑一声，身形如鬼魅般暴起扑来，凌厉刀光轰然斩落，空气中激荡起刺耳的破空之声！',
      '双锋剧烈碰撞，火星四溅，少年被震退三步，嘴角溢出血迹，局势骤然陷入生死悬崖。',
      '“还不束手就擒？”敌手狂笑逼近，杀招层层封锁生路。',
      '就在刀锋将临咽喉的千钧一发之际，远处暗林中骤然射出一道寒芒！',
    ].join('\n\n')

    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: null, body: fullChapterText }),
    })

    const res = await fetch(base + '/api/chapter.tension', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      available: boolean
      tensionScore: number
      tensionDesc: string
      tensionPoints: number[]
      currentStage: number
    }

    expect(json.ok).toBe(true)
    expect(json.available).toBe(true)
    expect(Array.isArray(json.tensionPoints)).toBe(true)
    expect(json.tensionPoints.length).toBeGreaterThanOrEqual(4)
    // 验证绝非原来的前 7 个硬编码点 [20, 38, 30, 60, 48, 75, 68]
    expect(json.tensionPoints.slice(0, 7)).not.toEqual([20, 38, 30, 60, 48, 75, 68])
    expect(json.tensionScore).toBeGreaterThanOrEqual(20)
    expect(typeof json.tensionDesc).toBe('string')
    expect(json.tensionDesc.length).toBeGreaterThan(0)
  })

  it('纯函数单元测试：computeChapterTension', () => {
    const emptyResult = computeChapterTension('', 1, 'draft')
    expect(emptyResult.available).toBe(false)

    const normal = computeChapterTension(
      '拔剑拔刀生死厮杀！\n\n轰然撞击血光崩裂！\n\n黑夜杀机追逃！\n\n冷笑拔剑破空！',
      1,
      'draft',
    )
    expect(normal.available).toBe(true)
    expect(normal.tensionPoints?.length).toBeGreaterThanOrEqual(2)
    expect(normal.tensionScore).toBeGreaterThan(0)
  })
})

describe('移动端闭环 2 · 技能胶囊 recipe 契约映射 (decoratePromptWithSkills)', () => {
  it('正确映射移动端三技能胶囊（增加冲突、精简叙述、回收伏笔）', () => {
    const rawPrompt = '主角来到城门前。'

    const decoratedConflict = decoratePromptWithSkills(rawPrompt, ['conflict'])
    expect(decoratedConflict).toContain('【增加冲突】')
    expect(decoratedConflict).toContain('主角来到城门前。')

    const decoratedConcise = decoratePromptWithSkills(rawPrompt, ['trim-narrative'])
    expect(decoratedConcise).toContain('【精简叙述】')

    const decoratedForeshadow = decoratePromptWithSkills(rawPrompt, ['回收伏笔'])
    expect(decoratedForeshadow).toContain('【回收伏笔】')

    const decoratedMulti = decoratePromptWithSkills(rawPrompt, ['conflict', 'concise', 'foreshadow'])
    expect(decoratedMulti).toContain('【增加冲突】')
    expect(decoratedMulti).toContain('【精简叙述】')
    expect(decoratedMulti).toContain('【回收伏笔】')
    expect(decoratedMulti).toContain('主角来到城门前。')
  })
})

describe('移动端闭环 3 · 版本时光机 Sidecar、段落 Diff 与回滚创建新版本', () => {
  it('保存多版本正文 → /api/chapter.history 完整读取历史快照', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createTestBook(dataRoot)

    // 保存 r1 (初始新建)
    const r1Save = await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: null, body: '第一版正文草稿。' }),
    })
    const r1 = (await r1Save.json()) as { ok: boolean; revision: number }
    expect(r1.revision).toBe(1)

    // 保存 r2
    const r2Save = await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: 1, body: '第二版正文草稿，增加了细节。' }),
    })
    const r2 = (await r2Save.json()) as { ok: boolean; revision: number }
    expect(r2.revision).toBe(2)

    // 读取历史
    const histRes = await fetch(base + '/api/chapter.history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    expect(histRes.status).toBe(200)
    const histJson = (await histRes.json()) as {
      ok: boolean
      currentRevision: number
      revisions: { revision: number; wordCount: number }[]
    }
    expect(histJson.ok).toBe(true)
    expect(histJson.currentRevision).toBe(2)
    expect(histJson.revisions.length).toBeGreaterThanOrEqual(2)
    expect(histJson.revisions[0]?.revision).toBe(2)
    expect(histJson.revisions[1]?.revision).toBe(1)
  })

  it('段落级 LCS Diff 计算：准确标识 added、removed 与 unchanged', () => {
    const textA = '第一段背景描写。\n\n旧第二段将被删除。\n\n第三段保持不变。'
    const textB = '第一段背景描写。\n\n第三段保持不变。\n\n新增第四段精彩高潮。'

    const diffs = computeParagraphDiff(textA, textB)
    expect(diffs).toEqual([
      { kind: 'unchanged', text: '第一段背景描写。', index: 0 },
      { kind: 'removed', text: '旧第二段将被删除。', index: 1 },
      { kind: 'unchanged', text: '第三段保持不变。', index: 2 },
      { kind: 'added', text: '新增第四段精彩高潮。', index: 3 },
    ])
  })

  it('/api/chapter.history.diff 端点：返回真实段落级差异', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createTestBook(dataRoot)

    // r1
    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: null, body: '开篇\n\n旧段落' }),
    })
    // r2
    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: 1, body: '开篇\n\n新段落' }),
    })

    const diffRes = await fetch(base + '/api/chapter.history.diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, fromRevision: 1, toRevision: 2 }),
    })
    expect(diffRes.status).toBe(200)
    const diffJson = (await diffRes.json()) as {
      ok: boolean
      fromRevision: number
      toRevision: number
      diffs: { kind: string; text: string }[]
    }
    expect(diffJson.ok).toBe(true)
    expect(diffJson.diffs).toEqual([
      { kind: 'unchanged', text: '开篇', index: 0 },
      { kind: 'removed', text: '旧段落', index: 1 },
      { kind: 'added', text: '新段落', index: 2 },
    ])
  })

  it('恢复时创建新版本：恢复 r1 时在 r2 基础上递增为 r3（body=r1），且 r1、r2 历史永久保留', async () => {
    const dataRoot = makeDataRoot()
    const { base, root } = await createTestBook(dataRoot)

    const textR1 = '第1版本文：少年初入江湖。'
    const textR2 = '第2版本文：少年在风雪中拔剑斩敌。'

    // r1
    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: null, body: textR1 }),
    })
    // r2
    await fetch(base + '/api/chapter.prose.save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, expectedRevision: 1, body: textR2 }),
    })

    // 执行恢复 r1
    const restoreRes = await fetch(base + '/api/chapter.history.restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1, targetRevision: 1 }),
    })
    expect(restoreRes.status).toBe(200)
    const restoreJson = (await restoreRes.json()) as {
      ok: boolean
      restoredFromRevision: number
      newRevision: number
    }
    expect(restoreJson.ok).toBe(true)
    expect(restoreJson.restoredFromRevision).toBe(1)
    expect(restoreJson.newRevision).toBe(3) // 递增创建为 r3！

    // 读回当前正文验证 body 确已为 r1 内容
    const proseRes = await fetch(base + '/api/chapter.prose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    const proseJson = (await proseRes.json()) as { ok: boolean; revision: number; body: string }
    expect(proseJson.revision).toBe(3)
    expect(proseJson.body.trim()).toBe(textR1.trim())

    // 读取历史列表：验证 r1, r2, r3 历史永久全部保留
    const histRes = await fetch(base + '/api/chapter.history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, chapterIndex: 1 }),
    })
    const histJson = (await histRes.json()) as {
      revisions: { revision: number }[]
    }
    const revIds = histJson.revisions.map((r) => r.revision)
    expect(revIds).toContain(1)
    expect(revIds).toContain(2)
    expect(revIds).toContain(3)
  })
})
