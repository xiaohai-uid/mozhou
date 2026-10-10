import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  newFactId,
  queryActiveFacts,
  type FactId,
  type VolumeNodeId,
} from '@mozhou/kernel'
import { createBook } from './create-book.js'
import { LocalDataPlane } from './local-data-plane.js'
import {
  findVolumeOutline,
  VolumeNotCompletedError,
  VolumeNotFoundError,
} from './compaction.js'
import { RUNTIME_EVENTS_PATH, VOLUME_ONE_OUTLINE_PATH } from './layout.js'
import { readNarrativeSnapshot } from './narrative-state.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-compaction-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
})

function setupBookWithFacts(): {
  plane: LocalDataPlane
  volumeId: VolumeNodeId
  factExpiredId: FactId
  factActiveId: FactId
  factProtectedId: FactId
} {
  createBook({ dir: bookRoot, title: '凡人修仙传' })
  const plane = LocalDataPlane.open(bookRoot)

  const canon = plane.getCanonState()
  const volumeNode = canon.outlineNodes.find((n) => n.nodeType === 'volume')!
  const volumeId = volumeNode.id as VolumeNodeId

  const now = new Date().toISOString()
  const factExpiredId = newFactId()
  const factActiveId = newFactId()
  const factProtectedId = newFactId()

  const factExpired = {
    id: factExpiredId,
    bookId: plane.book.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    subject: 'char:lin-xuan',
    predicate: 'clothing',
    value: '青色布袍',
    validFrom: 1,
    validUntil: 5,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }

  const factActive = {
    id: factActiveId,
    bookId: plane.book.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    subject: 'char:lin-xuan',
    predicate: 'weapon',
    value: '青竹蜂云剑',
    validFrom: 3,
    validUntil: null, // 无界事实
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 3 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }

  const factProtected = {
    id: factProtectedId,
    bookId: plane.book.id,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    subject: 'char:lin-xuan',
    predicate: 'origin_secret',
    value: '天灵根转世',
    validFrom: 1,
    validUntil: 5,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'author', protectedUserContent: true }, // 受保护
  }

  const factStreamPath = join(bookRoot, '追踪/事实.jsonl')
  const payload = [factExpired, factActive, factProtected].map((f) => `${JSON.stringify(f)}\n`).join('')
  appendFileSync(factStreamPath, payload, 'utf8')
  plane.absorbAppWrite(['追踪/事实.jsonl'])

  return {
    plane,
    volumeId,
    factExpiredId,
    factActiveId,
    factProtectedId,
  }
}

describe('卷边界状态压缩事务系统 (executeVolumeCompaction)', () => {
  it('门 1：未完结卷（status != completed）拒绝执行压缩', async () => {
    const { plane, volumeId } = setupBookWithFacts()

    await expect(
      plane.compactVolume({
        volumeNodeId: volumeId,
        volumeEndChapter: 10,
        llm: () => Promise.resolve('summary'),
      }),
    ).rejects.toThrow(VolumeNotCompletedError)

    plane.close()
  })

  it('门 2：不存在的 volumeNodeId 抛出 VolumeNotFoundError', async () => {
    const { plane } = setupBookWithFacts()

    await expect(
      plane.compactVolume({
        volumeNodeId: 'vol_nonexistent' as VolumeNodeId,
        volumeEndChapter: 10,
        llm: () => Promise.resolve('summary'),
      }),
    ).rejects.toThrow(VolumeNotFoundError)

    plane.close()
  })

  it('失败回滚保证：LLM 失败或摘要校验失败时，零事实被标 compacted，零盘上副作用', async () => {
    const { plane, volumeId, factExpiredId } = setupBookWithFacts()
    plane.markVolumeCompleted(volumeId)

    const factsBefore = readFileSync(join(bookRoot, '追踪/事实.jsonl'), 'utf8')
    const eventsBefore = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')
    const outlineBefore = readFileSync(join(bookRoot, VOLUME_ONE_OUTLINE_PATH), 'utf8')

    // 1. 模拟 LLM 抛出异常
    await expect(
      plane.compactVolume({
        volumeNodeId: volumeId,
        volumeEndChapter: 10,
        llm: () => Promise.reject(new Error('LLM connection timed out')),
      }),
    ).rejects.toThrow('LLM connection timed out')

    // 验证盘面未动
    expect(readFileSync(join(bookRoot, '追踪/事实.jsonl'), 'utf8')).toBe(factsBefore)
    expect(readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')).toBe(eventsBefore)
    expect(readFileSync(join(bookRoot, VOLUME_ONE_OUTLINE_PATH), 'utf8')).toBe(outlineBefore)

    // 2. 模拟 LLM 输出未覆盖 subject 导致机检失败
    await expect(
      plane.compactVolume({
        volumeNodeId: volumeId,
        volumeEndChapter: 10,
        llm: () => Promise.resolve('本卷摘要没有提到任何必需的实体。'),
      }),
    ).rejects.toThrow('volume summary validation failed')

    // 验证盘面仍然完全干净
    expect(readFileSync(join(bookRoot, '追踪/事实.jsonl'), 'utf8')).toBe(factsBefore)
    expect(readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')).toBe(eventsBefore)
    expect(readFileSync(join(bookRoot, VOLUME_ONE_OUTLINE_PATH), 'utf8')).toBe(outlineBefore)

    // 验证 snapshot 中该事实依然是活跃且未折叠状态
    const snap = readNarrativeSnapshot(bookRoot)
    const fact = snap.facts.get(factExpiredId)!
    expect(fact.compactedIntoVolumeId).toBeNull()

    plane.close()
  })

  it('原子落盘：成功压缩后大纲写入摘要、事实流回写标记、Event Ledger 记账且投影重建', async () => {
    const { plane, volumeId, factExpiredId, factActiveId, factProtectedId } = setupBookWithFacts()
    plane.markVolumeCompleted(volumeId)

    const eventsCountBefore = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')
      .split('\n')
      .filter(Boolean).length

    const res = await plane.compactVolume({
      volumeNodeId: volumeId,
      volumeEndChapter: 10,
      llm: (prompt) => {
        expect(prompt).toContain('char:lin-xuan')
        return Promise.resolve('在第一卷中，char:lin-xuan 结束了早期的练气阶段，旧布袍等微状态失效。')
      },
    })

    expect(res.idempotentReplay).toBe(false)
    expect(res.compactedFactIds).toEqual([factExpiredId])
    expect(res.summary).toContain('char:lin-xuan')

    // 检查卷大纲节点文件
    const outlineInfo = findVolumeOutline(bookRoot, volumeId)
    expect(outlineInfo.data['volumeSummary']).toBe(res.summary)
    expect(outlineInfo.body).toContain('## 卷状态摘要')
    expect(outlineInfo.body).toContain(res.summary)

    // 检查事实流已追加新 revision 标记行
    const snapAfter = readNarrativeSnapshot(bookRoot)
    const expiredFact = snapAfter.facts.get(factExpiredId)!
    expect(expiredFact.compactedIntoVolumeId).toBe(volumeId)
    expect(expiredFact.revision).toBe(1)

    // 检查其他事实未受影响
    expect(snapAfter.facts.get(factActiveId)!.compactedIntoVolumeId).toBeNull()
    expect(snapAfter.facts.get(factProtectedId)!.compactedIntoVolumeId).toBeNull()

    // 检查 Event Ledger 追加了一条 VOLUME_COMPACTED 事件
    const eventLines = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')
      .split('\n')
      .filter(Boolean)
    expect(eventLines.length).toBe(eventsCountBefore + 1)
    const lastEvent = JSON.parse(eventLines.at(-1)!) as Record<string, unknown>
    expect(lastEvent['type']).toBe('VOLUME_COMPACTED')
    expect(lastEvent['volumeNodeId']).toBe(volumeId)
    expect(lastEvent['factIds']).toEqual([factExpiredId])

    plane.close()
  })

  it('幂等性：同一卷重跑两次不重复摘要、不重复标记、不污染 Event Ledger', async () => {
    const { plane, volumeId } = setupBookWithFacts()
    plane.markVolumeCompleted(volumeId)

    let llmCallCount = 0
    const mockLlm = () => {
      llmCallCount += 1
      return Promise.resolve('第一卷中，char:lin-xuan 破境入道，旧状态终结。')
    }

    // 第一次运行
    const res1 = await plane.compactVolume({
      volumeNodeId: volumeId,
      volumeEndChapter: 10,
      llm: mockLlm,
    })
    expect(res1.idempotentReplay).toBe(false)
    expect(llmCallCount).toBe(1)

    const factsContentAfterFirst = readFileSync(join(bookRoot, '追踪/事实.jsonl'), 'utf8')
    const eventsContentAfterFirst = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')
    const outlineContentAfterFirst = readFileSync(join(bookRoot, VOLUME_ONE_OUTLINE_PATH), 'utf8')

    // 第二次重跑同一卷
    const res2 = await plane.compactVolume({
      volumeNodeId: volumeId,
      volumeEndChapter: 10,
      llm: mockLlm,
    })

    // 断言幂等回放
    expect(res2.idempotentReplay).toBe(true)
    expect(res2.summary).toBe(res1.summary)
    expect(res2.compactedFactIds).toHaveLength(0)

    // 核心验收断言：同一卷重跑两次不重复调用 LLM、不重复标记、不污染 Event Ledger
    expect(llmCallCount).toBe(1)
    expect(readFileSync(join(bookRoot, '追踪/事实.jsonl'), 'utf8')).toBe(factsContentAfterFirst)
    expect(readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')).toBe(eventsContentAfterFirst)
    expect(readFileSync(join(bookRoot, VOLUME_ONE_OUTLINE_PATH), 'utf8')).toBe(outlineContentAfterFirst)

    plane.close()
  })

  it('集成断言：卷压缩完成后，queryActiveFacts 不再召回被压缩微事实', async () => {
    const { plane, volumeId, factExpiredId, factActiveId } = setupBookWithFacts()

    // 压缩前：在有效章节（第 3 章）查询，过期微事实尚未压缩，作为活跃事实被返回
    const snapBefore = readNarrativeSnapshot(bookRoot)
    const activeBefore = queryActiveFacts(snapBefore, { chapter: 3, pov: 'protagonist' })
    expect(activeBefore.some((f) => f.id === factExpiredId)).toBe(true)
    expect(activeBefore.some((f) => f.id === factActiveId)).toBe(true)

    // 执行卷压缩
    plane.markVolumeCompleted(volumeId)
    await plane.compactVolume({
      volumeNodeId: volumeId,
      volumeEndChapter: 10,
      llm: () => Promise.resolve('第一卷结卷：char:lin-xuan 进阶，旧装备与凡胎状态失效。'),
    })

    // 压缩后：再次查询第 3 章的活跃事实
    const snapAfter = readNarrativeSnapshot(bookRoot)
    const activeAfter = queryActiveFacts(snapAfter, { chapter: 3, pov: 'protagonist' })

    // 核心断言：被压缩的微事实不再被召回！
    expect(activeAfter.some((f) => f.id === factExpiredId)).toBe(false)
    // 未被压缩的正常活跃事实依然正常召回
    expect(activeAfter.some((f) => f.id === factActiveId)).toBe(true)

    plane.close()
  })
})
