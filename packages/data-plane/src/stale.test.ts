/**
 * T6（实现票 #22）行为黑盒——全部经 LocalDataPlane 接缝打。
 *
 * 验收① 含保护位的工件在任何自动写入路径下原样（穷举自动化入口断言）；
 * 验收② 上游事实变更 → 下游依赖章节获得带原因/引用/时间的标记，作者文字零丢失；
 * 验收③ rejected 事实的知识状态行级联失效可查询。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DependencyManifestError,
  ProtectedContentViolationError,
  newFactId,
  newKnowledgeStateId,
} from '@mozhou/kernel'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBook } from './create-book.js'
import { RUNTIME_EVENTS_PATH, STYLE_PROFILE_PATH, chapterOutlinePath, isCanonRelPath, proseChapterPath } from './layout.js'
import { listAllFiles } from './manifest.js'
import { LocalDataPlane, rebuildProjectionFromCanon } from './local-data-plane.js'
import { parseFrontmatter } from './yaml-frontmatter.js'
import { readOutlineStaleMarker, readChapterDependencyPins } from './stale.js'

const tmpRoots: string[] = []
let bookRoot = ''
let currentBookId = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t6-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const T0 = '2026-08-24T00:00:00.000Z'
const T1 = '2026-08-24T12:00:00.000Z'
const T2 = '2026-08-25T00:00:00.000Z'

function factRow(options: {
  id?: string
  revision?: number
  status?: string
  predicate?: string
  value?: string | number | boolean
  origin?: 'author' | 'ai' | 'external'
  protectedUserContent?: boolean
}): Record<string, unknown> {
  return {
    id: options.id ?? newFactId(),
    bookId: currentBookId,
    revision: options.revision ?? 0,
    createdAt: T0,
    updatedAt: T0,
    subject: 'char:lin-wan',
    predicate: options.predicate ?? 'located',
    value: '墨舟',
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: options.status ?? 'confirmed',
    compactedIntoVolumeId: null,
    provenance: {
      origin: options.origin ?? 'ai',
      protectedUserContent: options.protectedUserContent ?? false,
    },
  }
}

function knstRow(factId: string, holder: string): Record<string, unknown> {
  return {
    id: newKnowledgeStateId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    factId,
    holder,
    knownSinceChapter: 1,
  }
}

/** 全部 canon 文件的字节快照（运行时区除外）。 */
function canonBytes(root: string): Map<string, string> {
  const bytes = new Map<string, string>()
  for (const rel of listAllFiles(root).filter(isCanonRelPath)) {
    const absolute = join(root, rel)
    if (!existsSync(absolute)) {
      continue
    }
    bytes.set(rel, readFileSync(absolute, 'utf8'))
  }
  return bytes
}

function expectSameBytes(before: Map<string, string>, after: Map<string, string>): void {
  for (const [rel, content] of before) {
    expect(after.get(rel), `canon file changed unexpectedly: ${rel}`).toBe(content)
  }
}

function outlineBody(root: string, chapterIndex: number): string {
  return parseFrontmatter(readFileSync(join(root, chapterOutlinePath(chapterIndex)), 'utf8')).body
}

function outlineFields(root: string, chapterIndex: number): Readonly<Record<string, unknown>> {
  return parseFrontmatter(readFileSync(join(root, chapterOutlinePath(chapterIndex)), 'utf8')).data
}

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: '墨舟测试书' })
  const plane = LocalDataPlane.open(bookRoot)
  currentBookId = plane.book.id
  return plane
}

/* ----------------------------------------------------------------------------
 * 验收① 穷举自动化入口：保护位工件字节原样
 * ------------------------------------------------------------------------- */

describe('验收① 自动化入口穷举保护断言', () => {
  it('rebuildProjectionFromCanon：零 canon 触碰（含保护位种子文件逐字节原样）', () => {
    const plane = newBook()
    const before = canonBytes(bookRoot)
    rebuildProjectionFromCanon(bookRoot)
    expectSameBytes(before, canonBytes(bookRoot))
    // 重建后基线逐字节相同（幂等硬断言的 T6 面投影）
    expect(plane.verifyBaseline().reconcileSurface).toEqual([])
  })

  it('createChapterDraft：只新增文件，既有保护位工件原样', () => {
    const plane = newBook()
    const before = canonBytes(bookRoot)
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    const after = canonBytes(bookRoot)
    expectSameBytes(before, after)
    expect(after.size).toBeGreaterThan(before.size)
  })

  it('commitChapter 拒绝 ai 来源取代保护位事实行——门禁在动第一字节前抛出，零盘上副作用', () => {
    const plane = newBook()
    plane.createChapterDraft({ chapterIndex: 1, title: '一' })
    const protectedFactId = newFactId()
    plane.commitChapter({
      chapterIndex: 1,
      summary: '作者亲笔断言',
      appends: {
        temporalFact: [factRow({ id: protectedFactId, origin: 'author', protectedUserContent: true })],
      },
    })
    plane.createChapterDraft({ chapterIndex: 2, title: '二' })

    const before = canonBytes(bookRoot)
    expect(() =>
      plane.commitChapter({
        chapterIndex: 2,
        summary: 'AI 提取试图取代作者断言',
        appends: {
          temporalFact: [factRow({ id: protectedFactId, revision: 1 })],
        },
      }),
    ).toThrow(ProtectedContentViolationError)

    // 宁败不脏：门禁先于 pending-commit 日志，全部 canon 字节原样
    expectSameBytes(before, canonBytes(bookRoot))
    expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
  })

  it('作者修订自己的保护位断言（author→author 同 id 取代）合法', () => {
    const plane = newBook()
    plane.createChapterDraft({ chapterIndex: 1, title: '一' })
    const protectedFactId = newFactId()
    plane.commitChapter({
      chapterIndex: 1,
      summary: '初版断言',
      appends: {
        temporalFact: [factRow({ id: protectedFactId, origin: 'author', protectedUserContent: true })],
      },
    })
    plane.reopenChapter(1)
    const result = plane.commitChapter({
      chapterIndex: 1,
      summary: '作者修订自己的断言',
      appends: {
        temporalFact: [
          factRow({ id: protectedFactId, revision: 1, value: '墨舟港', origin: 'author', protectedUserContent: true }),
        ],
      },
    })
    expect(result.appendedCounts['temporalFact']).toBe(1)
  })

  it('reopenChapter：相位翻转属应用壳人工操作链路，正文区逐字节保留', () => {
    const plane = newBook()
    plane.createChapterDraft({ chapterIndex: 1, title: '一' })
    const bodyBefore = parseFrontmatter(readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')).body
    plane.commitChapter({ chapterIndex: 1, summary: '提交' })
    plane.reopenChapter(1)
    expect(parseFrontmatter(readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')).body).toBe(bodyBefore)
  })

  it('对账应用（decideItems）：canon 永不回写，吸收只发生在基线与投影', () => {
    const plane = newBook()
    const externalEdit = `${readFileSync(join(bookRoot, STYLE_PROFILE_PATH), 'utf8')}\n<!-- 作者外部补注 -->\n`
    writeFileSync(join(bookRoot, STYLE_PROFILE_PATH), externalEdit)

    const proposal = plane.reconciliation().scanExternalModifications('startupScan').proposed[0]
    expect(proposal?.state).toBe('awaiting_author')

    const resolved = plane.reconciliation().decideItems(proposal!.proposalId, ['whole'])
    expect(resolved.resolution).toBe('applied')
    // 服务零回写：盘上仍是作者的外部版本
    expect(readFileSync(join(bookRoot, STYLE_PROFILE_PATH), 'utf8')).toBe(externalEdit)
    // 基线吸收后启动必检归零
    expect(plane.verifyBaseline().reconcileSurface).toEqual([])
  })

  it('保护位章大纲节点被 stale 标记时：仅 stale* 字段与 revision 变化，其余 frontmatter 与正文区逐字节原样', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    const fieldsBefore = outlineFields(bookRoot, 1)
    const bodyBefore = outlineBody(bookRoot, 1)

    plane.propagateStaleMarkers({
      reason: 'upstream_canon_changed',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })

    const fieldsAfter = outlineFields(bookRoot, 1)
    expect(outlineBody(bookRoot, 1)).toBe(bodyBefore)
    for (const [key, value] of Object.entries(fieldsBefore)) {
      if (key === 'revision') continue
      expect(fieldsAfter[key], `field ${key} must be untouched`).toEqual(value)
    }
    expect(fieldsAfter['protected']).toBe(true) // 保护位原样保留——stale 是唯一合法自动触点
  })
})

/* ----------------------------------------------------------------------------
 * 验收② 上游事实变更 → 下游依赖章节获得带原因/引用/时间的标记
 * ------------------------------------------------------------------------- */

let pinnedFactId = ''

/** 两章 + 各自依赖钉版：ch1 依赖事实 F@0，ch2 无关清单。 */
function seedTwoChaptersWithPins(plane: LocalDataPlane): void {
  pinnedFactId = newFactId()
  const otherFactId = newFactId()
  plane.createChapterDraft({ chapterIndex: 1, title: '一' })
  plane.createChapterDraft({ chapterIndex: 2, title: '二' })
  plane.commitChapter({
    chapterIndex: 1,
    summary: '一章提交',
    dependencyManifest: { entries: [{ kind: 'temporalFact', id: pinnedFactId, revision: 0 }] },
    appends: { temporalFact: [factRow({ id: pinnedFactId })], knowledgeState: [knstRow(pinnedFactId, 'protagonist')] },
  })
  plane.commitChapter({
    chapterIndex: 2,
    summary: '二章提交',
    dependencyManifest: { entries: [{ kind: 'temporalFact', id: otherFactId, revision: 0 }] },
    appends: { temporalFact: [factRow({ id: otherFactId, predicate: 'mood' })] },
  })
}

describe('验收② stale 传播', () => {
  it('上游事实变更 → 依赖章节获得带原因/引用/时间的标记；无关章节不动；正文零丢失', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)

    const proseBefore = readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')
    const bodyBefore = outlineBody(bookRoot, 1)

    const result = plane.propagateStaleMarkers({
      reason: 'upstream_canon_changed',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })

    expect(result.markedChapters).toEqual([1])
    expect(result.untouchedChapters).toEqual([2])

    // 带原因 / 引用 / 时间三要素齐备
    const marker = readOutlineStaleMarker(outlineFields(bookRoot, 1) as never)
    expect(marker).toEqual({
      reason: 'upstream_canon_changed',
      upstreamRefs: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })
    // 作者文字零丢失：正文文件一个字节都没动
    expect(readFileSync(join(bookRoot, proseChapterPath(1)), 'utf8')).toBe(proseBefore)
    expect(outlineBody(bookRoot, 1)).toBe(bodyBefore)
    // 自己的写入自己吸收：启动必检不把自己的标记当外部修改
    expect(plane.verifyBaseline().reconcileSurface).toEqual([])
  })

  it('同章重提交不带清单 ⇒ 旧钉版作废，传播不再命中该章', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    plane.reopenChapter(1)
    plane.commitChapter({ chapterIndex: 1, summary: '重提不带钉版' })

    expect(readChapterDependencyPins(bookRoot).has(1)).toBe(false)

    const result = plane.propagateStaleMarkers({
      reason: 'upstream_canon_changed',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })
    expect(result.markedChapters).toEqual([])
    expect(result.untouchedChapters).toEqual([2])
  })

  it('重复传播刷新标记：markedAt 前进、引用更新为最新上游版本', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    plane.propagateStaleMarkers({
      reason: 'upstream_canon_changed',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })
    plane.propagateStaleMarkers({
      reason: 'dependency_manifest_mismatch',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 7 }],
      markedAt: T2,
    })
    expect(readOutlineStaleMarker(outlineFields(bookRoot, 1) as never)).toEqual({
      reason: 'dependency_manifest_mismatch',
      upstreamRefs: [{ kind: 'temporalFact', id: pinnedFactId, revision: 7 }],
      markedAt: T2,
    })
  })

  it('标记后基线吸收与对账视角零提案；盘上 revision 原地 +1', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    const revisionBefore = outlineFields(bookRoot, 1)['revision'] as number

    plane.propagateStaleMarkers({
      reason: 'upstream_canon_changed',
      upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
      markedAt: T1,
    })

    expect(outlineFields(bookRoot, 1)['revision']).toBe(revisionBefore + 1)
    // 对账扫描视角：无任何提案（无外部修改、无结构漂移）
    // 注：章大纲节点的投影行归 canon-read 扩张票（现只灌总纲/卷两层），
    // stale 写路径的 outline_nodes UPDATE 在行出现后即为前向同步。
    expect(plane.reconciliation().scanExternalModifications('startupScan').proposed).toEqual([])
    expect(plane.verifyBaseline().reconcileSurface).toEqual([])
  })

  it('外部编辑中的章大纲拒绝叠加标记（S3 写前校验转介对账）', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    const external = `${readFileSync(join(bookRoot, chapterOutlinePath(1)), 'utf8')}\n<!-- 外部批注 -->\n`
    writeFileSync(join(bookRoot, chapterOutlinePath(1)), external)

    expect(() =>
      plane.propagateStaleMarkers({
        reason: 'upstream_canon_changed',
        upstreamChanges: [{ kind: 'temporalFact', id: pinnedFactId, revision: 1 }],
        markedAt: T1,
      }),
    ).toThrow(/pre-write hash check failed/)

    // 宁败不脏：外部编辑原样保留，未被静默叠加或覆盖
    expect(readFileSync(join(bookRoot, chapterOutlinePath(1)), 'utf8')).toBe(external)
  })
})

/* ----------------------------------------------------------------------------
 * 验收③ rejected 事实的知识状态行级联失效可查询
 * ------------------------------------------------------------------------- */

describe('验收③ KnowledgeState 级联失效查询', () => {
  it('事实 rejected 后其认知行进入失效面，健康事实的认知行不受牵连', () => {
    const plane = newBook()
    plane.createChapterDraft({ chapterIndex: 1, title: '一' })
    const healthyId = newFactId()
    const doomedId = newFactId()
    plane.commitChapter({
      chapterIndex: 1,
      summary: '初版事实与认知',
      appends: {
        temporalFact: [
          factRow({ id: healthyId, status: 'confirmed' }),
          factRow({ id: doomedId, status: 'candidate', predicate: 'weapon' }),
        ],
        knowledgeState: [
          knstRow(healthyId, 'protagonist'),
          knstRow(doomedId, 'reader'),
          knstRow(doomedId, 'char:xiao-he'),
        ],
      },
    })
    expect(plane.queryInvalidatedKnowledgeStates()).toEqual([])

    // 事实被否决（updated 行末行胜出）
    plane.createChapterDraft({ chapterIndex: 2, title: '二' })
    plane.commitChapter({
      chapterIndex: 2,
      summary: '作者否决候选事实',
      appends: { temporalFact: [factRow({ id: doomedId, revision: 1, status: 'rejected', predicate: 'weapon' })] },
    })

    const invalidated = plane.queryInvalidatedKnowledgeStates().map((ks) => ks.factId)
    expect(new Set(invalidated)).toEqual(new Set([doomedId]))
    // 失效可查询的同时，活跃事实读路径同步出局（I3 查询侧投影）
    expect(
      plane.queryActiveFacts({ chapter: 5, pov: 'protagonist' }).map((fact) => fact.id),
    ).toEqual([healthyId])
  })
})

/* ----------------------------------------------------------------------------
 * 依赖钉版落事件行的校验与回读
 * ------------------------------------------------------------------------- */

describe('dependencyManifest 落盘纪律', () => {
  it('非法钉版形状在动第一字节前拒绝（宁败不脏）', () => {
    const plane = newBook()
    plane.createChapterDraft({ chapterIndex: 1, title: '一' })
    const before = canonBytes(bookRoot)
    expect(() =>
      plane.commitChapter({
        chapterIndex: 1,
        summary: '坏清单',
        dependencyManifest: { entries: [{ kind: 'bogus', id: 'x', revision: 0 } as never] },
      }),
    ).toThrow(DependencyManifestError)
    expectSameBytes(before, canonBytes(bookRoot))
  })

  it('ChapterCommitted 事件行携带钉版并可回读（后到提交者胜）', () => {
    const plane = newBook()
    seedTwoChaptersWithPins(plane)
    const pins = readChapterDependencyPins(bookRoot)
    expect(pins.get(1)?.manifest.entries).toEqual([{ kind: 'temporalFact', id: pinnedFactId, revision: 0 }])
    expect(pins.get(2)).toBeDefined()
    // 事件账本里确实带着 dependencyManifest 键
    const lines = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8').trim().split('\n')
    const eventLine = JSON.parse(lines[0]!) as { dependencyManifest?: { entries: unknown[] } }
    expect(eventLine.dependencyManifest?.entries).toHaveLength(1)
  })
})
