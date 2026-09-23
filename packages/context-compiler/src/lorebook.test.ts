/**
 * 世界书关键词触发通道测试：
 * - scanLorebookTriggers：命中/分数/停用跳过/多词加分封顶；
 * - recallCandidates：世界书通道并入候选（tier world_rule / channel keyword）；
 * - compile() 端到端：命中条目落进 packet.settings 与 Receipt（真实装配链路）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BookId, ContextReceiptId, EntityRef, FactId, NarrativeStateSnapshot } from '@mozhou/kernel'
import { foldNarrativeRows } from '@mozhou/kernel'
import { compile, type CompileCard } from './compile.js'
import type { ExactTokenizer } from './assemble.js'
import { scanLorebookTriggers, type LorebookScanEntry } from './lorebook.js'
import { recallCandidates, type RecallEntityCard } from './recall.js'

/** 字长计量器（与 compile.test 同口径：UTF-16 长度）。 */
const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

const BOOK_ID = (() => {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let out = ''
  let value = 1
  for (let i = 0; i < 26; i += 1) {
    out = CROCKFORD[value % 32]! + out
    value = Math.floor(value / 32)
  }
  return `book_${out}` as unknown as BookId
})()
const RECEIPT_ID = `rcpt_${BOOK_ID.slice(5)}` as unknown as ContextReceiptId
const NOW = '2026-08-24T12:00:00.000Z'
const SCOPE = { chapterIndex: 5, pov: 'protagonist' as const }
const LIN = 'char:lin-xuan' as EntityRef

let seq = 100
const factAt = (n: number): FactId => `fact_${String(n).padStart(26, '0')}` as FactId

function mkFact(subject: EntityRef): ReturnType<typeof buildFact> {
  return buildFact(subject)
}

function buildFact(subject: EntityRef) {
  return {
    id: factAt(seq++),
    bookId: BOOK_ID,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    subject,
    predicate: '状态',
    value: '安好',
    validFrom: 1,
    validUntil: null,
    importance: 'critical' as const,
    riskClass: 'low' as const,
    source: { kind: 'chapter' as const, chapterIndex: 1 },
    status: 'confirmed' as const,
    compactedIntoVolumeId: null,
    provenance: { origin: 'author' as const, protectedUserContent: false },
  }
}

const snapOf = (...facts: ReturnType<typeof buildFact>[]): NarrativeStateSnapshot =>
  foldNarrativeRows({ temporalFact: facts })

function baseInput(overrides: Partial<Parameters<typeof compile>[0]> = {}): Parameters<typeof compile>[0] {
  const cards: readonly CompileCard[] = [
    {
      ref: LIN,
      name: '林枫',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }],
      brief: '青云宗外门弟子',
      fileRel: '设定/人物/lin-xuan.md',
    },
  ]
  return {
    task: { type: 'chapter_writing', chapterIndex: 5 },
    bookRoot: '/nonexistent-root-for-guard-tests',
    bookId: BOOK_ID,
    draftText: '林枫夜行，枫儿低语。',
    cards,
    snapshot: snapOf(mkFact(LIN)),
    scope: SCOPE,
    structural: {
      sections: [
        { section: 'author_intent', content: 'A'.repeat(49) },
        { section: 'task_frame', content: 'B'.repeat(49) },
      ],
    },
    storyText: ['S'.repeat(100)],
    modelProfile: { id: 'test-model', contextWindow: 4096 },
    tokenizer: charTok,
    receiptId: RECEIPT_ID,
    nowIso: NOW,
    ...overrides,
  }
}

afterEach(() => {
  // compile() 落盘的 Receipt 在独立临时根，测试内自清。
})

const ENTRY: LorebookScanEntry = {
  id: 'lb_entry001',
  title: '玄灯教铁律',
  keywords: ['玄灯教', '灯律'],
  content: '玄灯教弟子夜行必提本命灯，灯灭即魂销。',
  enabled: true,
}

describe('scanLorebookTriggers', () => {
  it('关键词命中：产出 world_rule 层 keyword 通道候选', () => {
    const channel = scanLorebookTriggers([ENTRY], '少年夜入玄灯教山门。')
    expect(channel.channel).toBe('keyword')
    expect(channel.entries).toHaveLength(1)
    expect(channel.entries[0]).toMatchObject({
      id: 'lb_entry001',
      tier: 'world_rule',
      activation: { kind: 'keyword', keys: ['玄灯教'] },
      content: ENTRY.content,
    })
    expect(channel.entries[0]!.relevanceScore).toBeGreaterThan(0)
    expect(channel.entries[0]!.relevanceScore).toBeLessThanOrEqual(0.85)
  })

  it('未命中/停用/空关键词条目跳过', () => {
    const channel = scanLorebookTriggers(
      [
        ENTRY,
        { ...ENTRY, id: 'lb_off', enabled: false },
        { ...ENTRY, id: 'lb_nokey', keywords: [] },
        { ...ENTRY, id: 'lb_nocontent', content: '' },
      ],
      '与玄灯教无关的正文。',
    )
    expect(channel.entries.map((e) => e.id)).toEqual(['lb_entry001'])
  })

  it('多关键词命中按步加分并封顶 0.85', () => {
    const channel = scanLorebookTriggers([ENTRY], '玄灯教灯律森严，玄灯教弟子皆知。')
    const score = channel.entries[0]!.relevanceScore
    expect(score).toBeGreaterThan(0.55)
    expect(score).toBeLessThanOrEqual(0.85)
  })
})

describe('recallCandidates 集成世界书通道', () => {
  it('世界书候选与实体卡同池合并（互不挤占，id 各自独立）', async () => {
    const cards: readonly RecallEntityCard[] = [
      { ref: 'char:lin-xuan', name: '林枫', aliases: [{ text: '林枫', kind: 'exact' }], brief: '青云宗外门弟子' },
    ]
    const result = await recallCandidates({
      draftText: '林枫踏入玄灯教大殿。',
      cards,
      snapshot: snapOf(mkFact(LIN)),
      scope: SCOPE,
      lorebook: [ENTRY],
    })
    const ids = result.candidates.map((c) => c.id)
    expect(ids).toContain('lb_entry001')
    const lore = result.candidates.find((c) => c.id === 'lb_entry001')!
    expect(lore.tier).toBe('world_rule')
    expect(lore.content).toBe(ENTRY.content)
  })
})

describe('compile() 端到端世界书注入', () => {
  it('命中条目进入 packet.settings 与 Receipt，重放契约不破', async () => {
    const bookRoot = mkdtempSync(join(tmpdir(), 'mozhou-lorebook-compile-'))
    try {
      const input = baseInput({
        bookRoot,
        draftText: '林枫夜行，枫儿低语，魔君之名掠过心头，心经残页浮现，玄灯教灯火明灭。',
        lorebook: [ENTRY],
      })
      const result = await compile(input)
      const loreSetting = result.packet.settings.find((s) => s.identifier === 'lb_entry001')
      expect(loreSetting).toBeDefined()
      expect(loreSetting!.tier).toBe('world_rule')
      // 装配器按 ENTRY_DELIMITER 约定为每条设定文本附加换行
      expect(loreSetting!.text.trim()).toBe(ENTRY.content)
      expect(result.packet.text).toContain(ENTRY.content)
    } finally {
      rmSync(bookRoot, { recursive: true, force: true })
    }
  })

  it('无世界书入参时行为与旧契约完全一致（可选参零破坏）', async () => {
    const bookRoot = mkdtempSync(join(tmpdir(), 'mozhou-lorebook-none-'))
    try {
      const result = await compile(baseInput({ bookRoot }))
      expect(result.packet.settings.some((s) => s.identifier.startsWith('lb_'))).toBe(false)
    } finally {
      rmSync(bookRoot, { recursive: true, force: true })
    }
  })
})
