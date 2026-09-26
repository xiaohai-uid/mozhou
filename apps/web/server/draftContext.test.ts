// @vitest-environment node
/**
 * D06 依赖钉版产出入口回归（change-impact-engine-spec §2 D06 / ADR-0003 §2.1）。
 *
 * 被测行为：Web 生成链路的唯一上下文入口 buildDraftContext 走正式编译时，必须把
 * 「本次真正入包的版本化实体」暂存落盘（提交路径据此钉 ChapterCommitted 行）；
 * 结构层降级（空召回）不落暂存——降级没消费任何版本化实体，不许造假钉版。
 *
 * 同文件第二组：Prepare 步进生产编译（chapter-pipeline-spec S2 + ADR-0025）——
 * stale 标记与有界质量切片必须真的走到模型输入（packet.structural/text）并留痕
 * Receipt；无标记/无质量文件不得凭空造段（零噪声不变量）。
 *
 * 同文件第三组：风格画像注入（data-flywheel-v1-spec §2.1 [B4]）——文风.md 四场景型
 * 必须真的进 compile 结构层且取盘上现值（学习/手改下一章即生效）；画像缺席/损坏/
 * 超 800 token 预算一律响亮失败，不静默降级成“无文风”。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  chapterOutlinePath,
  commitChapter,
  createBook,
  createChapterDraft,
  createEntityCard,
  emitFrontmatter,
  openDatabase,
  parseFrontmatter,
  propagateStaleMarkers,
  readManifest,
  readStyleProfiles,
  serializeStyleProfiles,
  STYLE_PROFILE_PATH,
  type PlaneContext,
  type StyleProfilesMap,
} from '@mozhou/data-plane'
import { RECEIPTS_DIRNAME } from '@mozhou/context-compiler'
import { updateStyleProfiles, writeStyleProfiles } from '@mozhou/flywheel'
import { newFactId } from '@mozhou/kernel'
import type { BookId, EntityRef, FactId } from '@mozhou/kernel'
import { PublishBus } from '@mozhou/runtime'
import {
  FAILURE_MEMORY_PATH,
  MEMORY_ANCHORS_PATH,
  QUALITY_SECTION,
  READER_EXPERIENCE_PATH,
  STALE_WARNING_SECTION,
  readPendingDependencyManifest,
} from '@mozhou/pipeline'
import { buildDraftContext } from './draftContext.js'

const LIN = 'char:lin-xuan' as EntityRef
const NOW = '2026-08-26T10:00:00.000Z'

let roots: string[] = []
afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
})

function bookIdOf(root: string): BookId {
  return (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: `book_${string}` }).id as BookId
}

/** 冻结行形的事实行（沿 l1 台架 factRow；status=confirmed 才进 G0 可见子图）。 */
function confirmedFactRow(bookId: BookId, id: FactId, chapterIndex: number): Record<string, unknown> {
  return {
    id,
    bookId,
    revision: 0,
    createdAt: '2026-08-24T15:00:00.000Z',
    updatedAt: '2026-08-24T15:00:00.000Z',
    subject: LIN,
    predicate: '境界',
    value: '练气',
    validUntil: null,
    validFrom: chapterIndex,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
}

function makeBook(withCard: boolean): { root: string; factId: FactId } {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-draftctx-'))
  roots.push(root)
  createBook({ dir: root, title: '入口接线之书' })
  const ctx: PlaneContext = { root, db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }), manifest: readManifest(root) }
  const factId = newFactId()
  try {
    if (withCard) {
      createEntityCard(ctx, LIN, {
        name: '林枫',
        aiContext: 'detected',
        aliases: [{ text: '枫儿', kind: 'exact' }],
        brief: '青云宗外门弟子佩剑听雨',
      })
      createChapterDraft(ctx, { chapterIndex: 1, title: '夜行' })
      commitChapter(ctx, {
        chapterIndex: 1,
        summary: '林枫初登场',
        appends: { temporalFact: [confirmedFactRow(bookIdOf(root), factId, 1)] },
      })
    }
    createChapterDraft(ctx, { chapterIndex: 2, title: '山门' })
  } finally {
    ctx.db.close()
  }
  return { root, factId }
}

describe('buildDraftContext · D06 钉版落盘', () => {
  it('正式编译路径：入包实体钉版落暂存，供提交侧按章回读', async () => {
    const { root, factId } = makeBook(true)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })

    expect(result.mode).toBe('compiled_receipt')
    const pending = readPendingDependencyManifest(root, 2)
    expect(pending?.entries).toEqual([{ kind: 'temporalFact', id: factId, revision: 0 }])
  })

  it('结构层降级路径：空召回不落暂存（降级未消费版本化实体，不造假钉版）', async () => {
    const { root } = makeBook(false)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '空白指令' })

    expect(result.mode).toBe('structural_fallback')
    expect(readPendingDependencyManifest(root, 2)).toBeNull()
  })
})

/* ---------------------------------------------------------------------------
 * Prepare 步进生产编译：stale 警告 + quality_memory 段
 * ------------------------------------------------------------------------- */

function structuralOf(packet: { structural: readonly { section: string; text: string }[] }, section: string): string | undefined {
  return packet.structural.find((piece) => piece.section === section)?.text
}

/** 章 1 经真实传播链被标 stale（钉版总纲 → 总纲 revision 漂移 → propagate）。 */
function makeBookWithStaleChapter(): string {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-web-draftctx-'))
  roots.push(root)
  createBook({ dir: root, title: '上游变更之书' })
  const ctx: PlaneContext = {
    root,
    db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }),
    manifest: readManifest(root),
  }
  try {
    createEntityCard(ctx, LIN, {
      name: '林枫',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }],
      brief: '青云宗外门弟子佩剑听雨',
    })
    createChapterDraft(ctx, { chapterIndex: 1, title: '夜行' })
    const zonggangId = parseFrontmatter(readFileSync(join(root, '大纲', '总纲.md'), 'utf8')).data['mozhouId'] as string
    commitChapter(ctx, {
      chapterIndex: 1,
      summary: '林枫夜行初遇',
      dependencyManifest: { entries: [{ kind: 'outlineNode', id: zonggangId, revision: 0 }] },
    })
    const propagation = propagateStaleMarkers(ctx, {
      reason: 'upstream_outline_changed',
      upstreamChanges: [{ kind: 'outlineNode', id: zonggangId, revision: 1 }],
      markedAt: NOW,
    })
    expect(propagation.markedChapters).toEqual([1])
  } finally {
    ctx.db.close()
  }
  return root
}

/** 质量/ 三文件（近窗诊断 + 活跃失败模式 + 锚点）。 */
function writeQualityFiles(root: string): void {
  mkdirSync(join(root, '质量'), { recursive: true })
  writeFileSync(
    join(root, ...READER_EXPERIENCE_PATH),
    JSON.stringify({ chapterIndex: 1, pressureDelta: 1, expectationDelta: 2, tangibleGain: 'resource', payoff: 'advanced', solutionPattern: 'borrow_knife' }) + '\n',
    'utf8',
  )
  writeFileSync(
    join(root, ...MEMORY_ANCHORS_PATH),
    JSON.stringify({ anchorId: 'anc_xiu', type: 'object', description: '那柄断了的绣春刀', plantedChapter: 1, lastEchoChapter: null, status: 'planted' }) + '\n',
    'utf8',
  )
  writeFileSync(
    join(root, ...FAILURE_MEMORY_PATH),
    JSON.stringify({ code: 'outline_expansion', firstSeenChapter: 1, lastSeenChapter: 1, occurrences: 1, active: true, authorNote: '别把大纲当正文' }) + '\n' +
      JSON.stringify({ code: 'style_drift', firstSeenChapter: 1, lastSeenChapter: 2, occurrences: 2, active: false }) + '\n',
    'utf8',
  )
}

describe('buildDraftContext · Prepare 步（stale + 质量切片）', () => {
  it('stale 标记进 packet 与 Receipt：警告继续、留痕不阻塞', async () => {
    const root = makeBookWithStaleChapter()

    const result = await buildDraftContext({ root, chapterIndex: 1, authorPrompt: '枫儿踏入山门' })

    expect(result.mode).toBe('compiled_receipt')
    // 警告继续：编译成功；段文本到达模型输入（packet.text 即送模型的 prompt）
    const warning = structuralOf(result.packet, STALE_WARNING_SECTION)
    expect(warning).toContain('reason=upstream_outline_changed')
    expect(warning).toContain('markedAt=' + NOW)
    expect(result.packet.text).toContain('reason=upstream_outline_changed')

    // 留痕落盘：一证一文件里的 structural 条目
    const receiptDir = join(root, ...RECEIPTS_DIRNAME.split('/'))
    const receiptFiles = readdirSync(receiptDir).filter((name) => name.endsWith('.json'))
    expect(receiptFiles).toHaveLength(1)
    const receipt = JSON.parse(readFileSync(join(receiptDir, receiptFiles[0]!), 'utf8')) as {
      entries: readonly { identifier: string; included: boolean; stage: string }[]
    }
    const entry = receipt.entries.find((candidate) => candidate.identifier === STALE_WARNING_SECTION)
    expect(entry?.included).toBe(true)
    expect(entry?.stage).toBe('structural')
  })

  it('质量切片进 packet：近窗诊断/活跃失败模式/锚点都到模型输入', async () => {
    const { root } = makeBook(true)
    writeQualityFiles(root)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })

    expect(result.mode).toBe('compiled_receipt')
    const quality = structuralOf(result.packet, QUALITY_SECTION)
    expect(quality).toContain('delta ch1')
    expect(quality).toContain('failure outline_expansion')
    expect(quality).toContain('anchor anc_xiu')
    // 失效模式（active=false）不入上下文
    expect(quality).not.toContain('style_drift')
    expect(result.packet.text).toContain('anchor anc_xiu')
  })

  it('不变量：无 stale 标记、无质量文件 ⇒ 两段都不凭空出现（零噪声）', async () => {
    const { root } = makeBook(true)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })

    expect(result.mode).toBe('compiled_receipt')
    expect(structuralOf(result.packet, QUALITY_SECTION)).toBeUndefined()
    expect(structuralOf(result.packet, STALE_WARNING_SECTION)).toBeUndefined()
  })

  it('失败路径：章大纲缺席即显式失败，不落钉版冒充成功', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mozhou-web-draftctx-'))
    roots.push(root)
    createBook({ dir: root, title: '缺章之书' })
    const ctx: PlaneContext = {
      root,
      db: openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') }),
      manifest: readManifest(root),
    }
    try {
      createChapterDraft(ctx, { chapterIndex: 1, title: '第一章' })
    } finally {
      ctx.db.close()
    }

    await expect(buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })).rejects.toThrow()
    expect(readPendingDependencyManifest(root, 2)).toBeNull()
  })

  it('失败路径：stale 标记三平铺字段非法即报错，不静默丢弃标记继续生成', async () => {
    const { root } = makeBook(false)
    const outlineRel = chapterOutlinePath(2)
    const document = parseFrontmatter(readFileSync(join(root, outlineRel), 'utf8'))
    writeFileSync(
      join(root, outlineRel),
      `${emitFrontmatter({
        ...document.data,
        staleReason: 'not_a_real_reason',
        staleMarkedAt: NOW,
        staleUpstreamRefs: [],
      })}${document.body}`,
      'utf8',
    )

    await expect(buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })).rejects.toThrow(
      /malformed stale marker fields/,
    )
  })
})

/* ---------------------------------------------------------------------------
 * 风格画像进生产编译：四场景型全注入（data-flywheel-v1-spec §2.1 [B4]）
 * ------------------------------------------------------------------------- */

function styleSectionOf(packet: { structural: readonly { section: string; text: string }[] }, scenarioType: string): string | undefined {
  return structuralOf(packet, 'style_profile:' + scenarioType)
}

/** 走生产写口（StyleProfileStore 单口）落一份学习结果，供下一章生成消费。 */
function applyLearning(root: string, next: StyleProfilesMap): void {
  writeStyleProfiles({
    bus: new PublishBus(),
    bookRoot: root,
    taskRef: 'tsk_style_wiring',
    chapterIndex: 2,
    next,
  })
}

describe('buildDraftContext · 风格画像注入（t51:B4）', () => {
  it('四场景型全注入：section 键冻结、内容到达模型输入', async () => {
    const { root } = makeBook(true)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })

    expect(result.mode).toBe('compiled_receipt')
    const styleKeys = result.packet.structural
      .map((piece) => piece.section)
      .filter((section) => section.startsWith('style_profile:'))
    // 四型全注入（否决 top-2），序 = SCENARIO_TYPES 冻结序
    expect(styleKeys).toEqual([
      'style_profile:action',
      'style_profile:dialogue',
      'style_profile:romance_emotion',
      'style_profile:exposition_worldbuilding',
    ])
    // packet.text 即送模型的 prompt：画像必须真的在里面，不能只留在结构层
    expect(result.packet.text).toContain('# action StyleProfile v0')
    expect(result.packet.text).toContain('dialogueRatio: 0.300')
  })

  it('取盘上现值：学习后的 revision/分面下一章即进编译（不是播种常量）', async () => {
    const { root } = makeBook(true)
    const seed = readStyleProfiles(root)
    const { next } = updateStyleProfiles(
      seed,
      Array.from({ length: 10 }, () => ({
        scenarioType: 'action' as const,
        chapterIndex: 2,
        polarity: 'positive' as const,
        dialogueRatio: 0.9,
        sentenceLengths: [40],
      })),
    )
    applyLearning(root, next)
    const onDisk = readStyleProfiles(root)
    expect(onDisk.action.revision).toBe(seed.action.revision + 1) // 前置：学习确实落盘
    expect(onDisk.action.dialogueRatio).not.toBe(seed.action.dialogueRatio)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })

    const action = styleSectionOf(result.packet, 'action')
    expect(action).toContain('revision: ' + onDisk.action.revision)
    expect(action).toContain('dialogueRatio: ' + onDisk.action.dialogueRatio.toFixed(3))
    // 反证：若读的是播种值，action 段仍是 0.300
    expect(action).not.toContain('dialogueRatio: ' + seed.action.dialogueRatio.toFixed(3))
  })

  it('失败路径：文风.md 缺席即显式失败，不静默无文风继续、不落钉版', async () => {
    const { root } = makeBook(true)
    rmSync(join(root, STYLE_PROFILE_PATH))

    await expect(buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })).rejects.toThrow(
      /文风\.md/,
    )
    expect(readPendingDependencyManifest(root, 2)).toBeNull()
  })

  it('失败路径：文风.md 围栏损坏即报错，不吞成“无画像”', async () => {
    const { root } = makeBook(true)
    const raw = readFileSync(join(root, STYLE_PROFILE_PATH), 'utf8')
    const document = parseFrontmatter(raw)
    // 保留 frontmatter，删掉 fenced-YAML 块（模拟手改损坏的旧格式文件）
    writeFileSync(join(root, STYLE_PROFILE_PATH), `${emitFrontmatter(document.data)}# 文风画像\n\n> 手改损坏：围栏块被删\n`, 'utf8')

    await expect(buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })).rejects.toThrow(/围栏/)
    expect(readPendingDependencyManifest(root, 2)).toBeNull()
  })

  it('失败路径：画像合计超 800 token 预算即抛错（硬断言接线，不是死代码）', async () => {
    const { root } = makeBook(true)
    const raw = readFileSync(join(root, STYLE_PROFILE_PATH), 'utf8')
    const profiles = readStyleProfiles(root)
    // 作者手改 文风.md 是权威通道（store 文档：手改走 EXTERNAL_MODIFIED 且永远赢）：
    // 400 个句长桶即可把单段推到 800 token 预算之上。此处证明超限在生成入口响亮失败，
    // 而不是被静默截断/丢段后照常出稿。
    writeFileSync(
      join(root, STYLE_PROFILE_PATH),
      serializeStyleProfiles(raw, {
        ...profiles,
        action: {
          ...profiles.action,
          sentenceLengthDistribution: Array.from({ length: 400 }, (_, index) => ({
            maxLengthChars: index + 1,
            share: 0.0025,
          })),
        },
      }),
      'utf8',
    )

    await expect(buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })).rejects.toThrow(
      /exceed token budget/,
    )
    expect(readPendingDependencyManifest(root, 2)).toBeNull()
  })
})

describe('buildDraftContext · 预算路径用精确 tokenizer（token-budget-assembly-spec §3）', () => {
  it('落盘 receipt 记录的计量器是随仓 WordPiece 词表，不是码点估算器', async () => {
    const { root } = makeBook(true)

    const result = await buildDraftContext({ root, chapterIndex: 2, authorPrompt: '枫儿踏入山门' })
    expect(result.mode).toBe('compiled_receipt')

    // 规格明令估算器严禁进入预算核算路径；receipt 的 replayInputs 是「这次装配到底用了
    // 哪个计量器」的权威记录，也是复算校验的依据（receipt-replay 会逐字比对版本）。
    const receiptDir = join(root, ...RECEIPTS_DIRNAME.split('/'))
    const receiptFiles = readdirSync(receiptDir).filter((name) => name.endsWith('.json'))
    expect(receiptFiles.length).toBeGreaterThan(0)
    const receipt = JSON.parse(readFileSync(join(receiptDir, receiptFiles[0]!), 'utf8')) as {
      replayInputs: { tokenizerVersion: string; modelProfileId: string }
    }
    expect(receipt.replayInputs.tokenizerVersion).toBe('mozhou-bert-wordpiece-bge-small-zh-v1.5-v1')
    expect(receipt.replayInputs.tokenizerVersion).not.toBe('mozhou-preview-codepoint-budget-v1')
    expect(receipt.replayInputs.modelProfileId).toBe('mozhou-preview-wordpiece-budget-v1')
  })
})
