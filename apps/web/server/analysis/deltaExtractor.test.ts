// @vitest-environment node
/**
 * 五族增量提取器测试。
 *
 * 重点不是"模型能不能抽对"，而是**代码盖的结构是否必然合法**：
 * 引用完整性、M2 时间线单调、Q7 秘密同现律、伏笔行能被 prepare 侧严格校验通过。
 * 模型输出是不可信输入，任何一行无法归一都必须被丢弃并记原因，而不是猜。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from '@mozhou/data-plane'
import {
  extractChapterDelta,
  normalizeDelta,
  type DeltaExtractorDeps,
} from './deltaExtractor.js'
import type { GenerationTargetUnavailable } from '../llm/generationTarget.js'

const tmpRoots: string[] = []
let bookRoot = ''
let bookId = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-delta-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
  bookId = createBook({ dir: bookRoot, title: '增量提取测试书' }).book.id
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const ctx = () => ({ bookId, chapterIndex: 3, liveMaxOrder: 0 })

/** 造一个异步生成器形态的假模型流。 */
function fakeStream(text: string): NonNullable<DeltaExtractorDeps['streamChat']> {
  return async function* () {
    await Promise.resolve()
    yield { delta: text }
  }
}

/**
 * 工单06：deps 的端点缝由 `resolveEndpoint`（裸端点/null）换成统一解析缝
 * `resolveTarget`（GenerationTargetResolution）。这里注入的是**成功的解析结果**，
 * 传输仍由 streamChat 桩接管——解析层与传输层各自独立可断言。
 */
const targetStub = (): NonNullable<DeltaExtractorDeps['resolveTarget']> =>
  () => ({
    available: true,
    taskType: 'FINAL_EXTRACT',
    endpoint: { baseUrl: 'https://example.com', apiKey: 'k', model: 'm' },
    providerId: 'deepseek',
    model: 'm',
    source: 'byok',
    registryRoute: null,
  })

/** Unavailable 侧的注入桩：显式给出 reason/detail，不靠「返回 null」表达失败。 */
const unavailableStub = (
  reason: GenerationTargetUnavailable['reason'],
  detail: string,
): NonNullable<DeltaExtractorDeps['resolveTarget']> =>
  () => ({ available: false, taskType: 'FINAL_EXTRACT', reason, detail })

describe('normalizeDelta · 模型只出语义，代码盖结构', () => {
  it('完整载荷归一为五族合法行，计数正确', () => {
    const result = normalizeDelta(
      {
        facts: [
          { subject: 'char:liu-bei', predicate: '身份', value: '汉室宗亲', importance: 'notable', riskClass: 'low' },
          { subject: 'char:guan-yu', predicate: '武器', value: '青龙偃月刀', importance: 'trivial', riskClass: 'low' },
        ],
        knowledge: [{ factIndex: 0, holder: 'protagonist', level: 'knows' }],
        relationships: [
          { entityA: 'char:liu-bei', entityB: 'char:guan-yu', relationshipType: '结义兄弟', affinityScore: 80 },
        ],
        promises: [{ type: 'foreshadowing', description: '断剑的来历', targetChapter: null }],
        timeline: [
          { worldTimeLabel: '中平元年', summary: '黄巾起事', participants: ['char:liu-bei'], impactFactIndexes: [0] },
        ],
      },
      ctx(),
    )

    expect(result.extractor).toBe('llm')
    expect(result.counts).toEqual({
      temporalFact: 2,
      knowledgeState: 1,
      relationshipState: 1,
      narrativePromise: 1,
      timelineEvent: 1,
    })
    expect(result.dropped).toEqual([])

    // 结构字段由代码盖章
    const fact = (result.appends['temporalFact'] as Record<string, unknown>[])[0]!
    expect(String(fact['id'])).toMatch(/^fact_/)
    expect(fact['bookId']).toBe(bookId)
    expect(fact['status']).toBe('candidate')
    expect(fact['validFrom']).toBe(3)
    expect(fact['compactedIntoVolumeId']).toBeNull()
    expect(fact['provenance']).toEqual({ origin: 'ai', protectedUserContent: false })

    // 伏笔行必须能被 prepare 侧的严格校验接受：prom_ 前缀 + 全字段
    const promise = (result.appends['narrativePromise'] as Record<string, unknown>[])[0]!
    expect(String(promise['id'])).toMatch(/^prom_/)
    expect(promise['introducedChapter']).toBe(3)
    expect(promise['status']).toBe('introduced')
    expect(promise['payoffNotes']).toBeNull()
  })

  it('secret.* 谓词强制 riskClass=high（Q7 同现律）', () => {
    const result = normalizeDelta(
      { facts: [{ subject: 'char:a', predicate: 'secret.true-name', value: '真名', importance: 'critical', riskClass: 'low' }] },
      ctx(),
    )
    const fact = (result.appends['temporalFact'] as Record<string, unknown>[])[0]!
    expect(fact['riskClass']).toBe('high')
    expect(result.dropped).toEqual([])
  })

  it('引用越界与非法实体引用的行被丢弃并记原因，不猜', () => {
    const result = normalizeDelta(
      {
        facts: [{ subject: '不是实体引用', predicate: '身份', value: 'x' }],
        knowledge: [{ factIndex: 9, holder: 'protagonist', level: 'knows' }],
        relationships: [{ entityA: 'char:a', entityB: 'char:b', relationshipType: 'r', affinityScore: 5 }],
      },
      ctx(),
    )
    // 非法事实被丢 → 认知的 factIndex 无本批事实可指 → 也丢
    expect(result.counts['temporalFact']).toBe(0)
    expect(result.counts['knowledgeState']).toBe(0)
    expect(result.counts['relationshipState']).toBe(1)
    expect(result.dropped.map((d) => d.family)).toEqual(['temporalFact', 'knowledgeState'])
  })

  it('时间线序数从存量最大值之后严格递增（M2 单调）', () => {
    const result = normalizeDelta(
      {
        timeline: [
          { worldTimeLabel: '甲', summary: '一', participants: [], impactFactIndexes: [] },
          { worldTimeLabel: '乙', summary: '二', participants: [], impactFactIndexes: [] },
        ],
      },
      { bookId, chapterIndex: 3, liveMaxOrder: 7 },
    )
    const rows = result.appends['timelineEvent'] as Record<string, unknown>[]
    expect(rows.map((r) => r['worldTimeOrder'])).toEqual([8, 9])
  })

  it('空载荷返回空批而非报错', () => {
    const result = normalizeDelta({}, ctx())
    expect(result.appends).toEqual({})
    expect(result.counts).toEqual({
      temporalFact: 0,
      knowledgeState: 0,
      relationshipState: 0,
      narrativePromise: 0,
      timelineEvent: 0,
    })
  })
})

describe('extractChapterDelta · 生产入口的诚实降级', () => {
  it('未配置 provider 时返回 none + 空批 + 原因，不伪造', async () => {
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: unavailableStub('no_provider_configured', '未配置真实 LLM Key'),
    })
    expect(result.extractor).toBe('none')
    expect(result.appends).toEqual({})
    // 新契约：失败**带原因**，不再是一个裸 null 让调用方自己解释。
    expect(result.reason).toContain('no_provider_configured')
    expect(result.reason).toContain('未配置真实 LLM Key')
  })

  it('注册表配了但解析不出来时如实呈现 provider_config_invalid，不回落 BYOK', async () => {
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: unavailableStub('provider_config_invalid', 'providers.qing.providerId: 未登记'),
    })
    expect(result.extractor).toBe('none')
    expect(result.reason).toContain('provider_config_invalid')
    expect(result.reason).toContain('未登记')
  })

  it('hosted 无主体时如实呈现 hosted_no_principal（凭据隔离拒答）', async () => {
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: unavailableStub('hosted_no_principal', '无 principal'),
    })
    expect(result.extractor).toBe('none')
    expect(result.reason).toContain('hosted_no_principal')
  })

  it('模型输出不可解析时返回 none + 原因', async () => {
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: targetStub(),
      streamChat: fakeStream('这里没有 JSON'),
    })
    expect(result.extractor).toBe('none')
    expect(result.reason).toContain('模型输出不可解析')
  })

  it('模型调用抛错时返回 none + 原因', async () => {
    const throwing: NonNullable<DeltaExtractorDeps['streamChat']> = async function* () {
      await Promise.resolve()
      throw new Error('upstream 429')
    }
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: targetStub(),
      streamChat: throwing,
    })
    expect(result.extractor).toBe('none')
    expect(result.reason).toContain('upstream 429')
  })

  it('合法模型输出（含围栏）被归一为五族增量', async () => {
    const payload = JSON.stringify({
      facts: [{ subject: 'char:a', predicate: '身份', value: '游侠', importance: 'notable', riskClass: 'low' }],
      timeline: [{ worldTimeLabel: '元年', summary: '启程', participants: ['char:a'], impactFactIndexes: [0] }],
    })
    const result = await extractChapterDelta(bookRoot, bookId, 1, '正文', {
      resolveTarget: targetStub(),
      streamChat: fakeStream('```json\n' + payload + '\n```'),
    })
    expect(result.extractor).toBe('llm')
    expect(result.counts['temporalFact']).toBe(1)
    expect(result.counts['timelineEvent']).toBe(1)
  })
})
