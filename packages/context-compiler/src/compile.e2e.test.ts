/**
 * T10a 端到端集成测试（issue #26 AC① 全链路兑现）：
 *
 *   createBook → 真实目录卡（四档各一，落盘 canon frontmatter）
 *   → 建章草稿 + ChapterCommit 追踪增量（已提交章节）
 *   → scanEntityCards / readNarrativeSnapshot（canon 真源扫描面）
 *   → compile(chapterIndex=2) → 合法 Receipt 一证一文件。
 *
 * 同场验证 Research 区硬隔离（US17）：市场/ 区资料写入书内，
 * 断言其内容零进入 packet 与 Receipt。全部 hermetic：临时目录 +
 * 注入时钟/凭证 id；真源 IO 仅经 @mozhou/data-plane 公共 API。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BookId, ContextReceiptId, EntityRef, FactId } from '@mozhou/kernel'
import {
  commitChapter,
  createBook,
  createChapterDraft,
  createEntityCard,
  openDatabase,
  readManifest,
  readNarrativeSnapshot,
  scanEntityCards,
  type PlaneContext,
} from '@mozhou/data-plane'
import { loadReceipt } from './receipt-file.js'
import { canonicalJson, sha256Hex, type ExactTokenizer } from './assemble.js'
import { compile } from './compile.js'

const charTok: ExactTokenizer = { version: 'fake-char-v1', count: (text) => text.length }

const NOW = '2026-08-24T15:00:00.000Z'
const LIN = 'char:lin-xuan' as EntityRef
const SECT = 'faction:qingyun-sect' as EntityRef
const FORBIDDEN = 'char:mo-jun' as EntityRef
const OFF = 'concept:heart-sutra' as EntityRef
const MARKET_MARKER = 'MARKET_MARKER_Q7X_NEVER_IN_PROMPT'

let roots: string[] = []
function makeBook(): { root: string; bookId: BookId } {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-t10a-e2e-'))
  roots.push(root)
  const { book } = createBook({ dir: root, title: '听雨剑歌' })
  return { root, bookId: book.id }
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true })
  }
  roots = []
})

describe('端到端：真实目录卡 + 已提交章节 → compile → 合法 Receipt', () => {
  it('建书→建卡→提交章→扫描→编译→一证一文件全链路贯通', async () => {
    const { root, bookId } = makeBook()

    // ── 真实目录卡：四档各一张（data-plane canon 落盘 + 投影同步）──
    const db = openDatabase({ path: join(root, '.mozhou', 'runtime.sqlite') })
    try {
      const ctx: PlaneContext = { root, db, manifest: readManifest(root) }
      createEntityCard(ctx, LIN, {
        name: '林枫',
        aiContext: 'detected',
        aliases: [{ text: '枫儿', kind: 'exact' }],
        brief: '青云宗外门弟子佩剑听雨',
      })
      createEntityCard(ctx, SECT, { name: '青云宗', aiContext: 'always', brief: '正道魁首立派三百年' })
      createEntityCard(ctx, FORBIDDEN, { name: '魔君', aiContext: 'never', brief: '魔道之主血洗北境' })
      createEntityCard(ctx, OFF, {
        name: '心经',
        aiContext: 'detectedOff',
        aliases: [{ text: '心经', kind: 'exact' }],
        brief: '上古典籍残卷',
      })

      // Research 区资料入书（canon 未跟踪文件）：编译必须视而不见
      writeFileSync(join(root, '市场', 'e2e-marker.md'), `# 市场简报\n${MARKET_MARKER}\n`)

      // ── 已提交章节：第 1 章 + 两族追踪增量（触发自身事实 + 指向 detectedOff 主体的桥接事实）──
      createChapterDraft(ctx, { chapterIndex: 1, title: '夜行' })
      let factSeq = 0
      const nextFactId = (): FactId => `fact_${String(900 + factSeq++).padStart(26, '0')}` as FactId
      const mkRow = (subject: EntityRef, predicate: string, value: string | number, importance: 'critical' | 'notable') => ({
        id: nextFactId(),
        bookId,
        revision: 0,
        createdAt: NOW,
        updatedAt: NOW,
        subject,
        predicate,
        value,
        validFrom: 1,
        validUntil: null,
        importance,
        riskClass: predicate.startsWith('secret.') ? ('high' as const) : ('low' as const),
        source: { kind: 'chapter' as const, chapterIndex: 1 },
        status: 'confirmed' as const,
        compactedIntoVolumeId: null,
        provenance: { origin: 'author' as const, protectedUserContent: false },
      })
      commitChapter(ctx, {
        chapterIndex: 1,
        summary: '林枫夜行初遇',
        appends: {
          temporalFact: [
            mkRow(LIN, '状态', '安好', 'critical'),
            mkRow(LIN, '参悟', OFF, 'notable'), // 桥接事实：value = EntityRef 引用
          ],
        },
      })
    } finally {
      db.close()
    }

    // ── canon 真源扫描面（真实 EntityCardScan 含 fileRel/aiContext）──
    const cards = scanEntityCards(root)
    expect(cards.map((card) => card.ref).sort()).toEqual(
      [LIN, SECT, FORBIDDEN, OFF].map(String).sort(),
    )
    for (const card of cards) {
      expect(card.fileRel.startsWith('设定/')).toBe(true) // 扫描面天然不含 市场/
    }
    const snapshot = readNarrativeSnapshot(root)
    expect(snapshot.facts.size).toBe(2)

    // ── 编译第 2 章 ──
    const receiptId = `rcpt_${'7'.repeat(26)}` as unknown as ContextReceiptId
    const result = await compile({
      task: { type: 'chapter_writing', chapterIndex: 2 },
      bookRoot: root,
      bookId,
      draftText: '林枫踏入山门，枫儿低唤一声，心经残页微光一闪，魔君之名掠过心头。',
      cards,
      snapshot,
      scope: { chapterIndex: 2, pov: 'protagonist' },
      structural: { sections: [{ section: 'author_intent', content: '写一部修仙长卷' }] },
      storyText: ['第一章正文切片：林枫初入青云宗山门。'],
      modelProfile: { id: 'e2e-model', contextWindow: 4096 },
      tokenizer: charTok,
      receiptId,
      nowIso: NOW,
    })

    // AC①：合法 Receipt 全字段 + 一证一文件
    const { receipt, packet, location } = result
    expect(existsSync(location.receiptPath)).toBe(true)
    expect(location.receiptPath).toBe(join(root, '.mozhou', 'receipts', `${receipt.id}.json`))
    expect(loadReceipt(root, receipt.id)).toEqual(receipt)
    expect(receipt.assembledBy).toBe('server')
    expect(receipt.taskType).toBe('chapter_writing')
    expect(receipt.chapterIndex).toBe(2)
    expect(receipt.totalTokens).toBe(packet.totalTokens)
    expect(receipt.inputsDigest).toBe(sha256Hex(canonicalJson(receipt.replayInputs)))
    expect(receipt.parseFailures).toEqual([])

    // 四档语义在真实扫描面上兑现
    expect(packet.structural.find((piece) => piece.section === `entity:${SECT}`)?.text).toContain('正道魁首')
    const settingsIds = new Set(packet.settings.map((entry) => entry.identifier))
    expect(settingsIds.has(LIN)).toBe(true) // detected：keyword 激活
    expect(settingsIds.has(FORBIDDEN)).toBe(false) // never：提及亦不激活
    expect(settingsIds.has(OFF)).toBe(false) // detectedOff：无 embedding 时卡面不激活
    expect(packet.text).toContain('青云宗外门弟子')
    expect(packet.text).not.toContain('血洗北境')
    expect(packet.text).not.toContain('上古典籍残卷')
    // detectedOff 主体的事实仍可经图通道到达
    expect(
      receipt.entries.some(
        (entry) => entry.included && entry.identifier.startsWith('fact_') && entry.activation?.kind === 'graph_khop',
      ),
    ).toBe(true)

    // US17：Research 区资料零入包、零入证
    expect(packet.text).not.toContain(MARKET_MARKER)
    expect(readFileSync(location.receiptPath, 'utf8')).not.toContain(MARKET_MARKER)

    // EventLedger：ChapterCommitted 之后追加 ContextCompiled 指针（seq 单调共享账本）
    const eventsRaw = readFileSync(join(root, '.mozhou', 'events.jsonl'), 'utf8')
    const lines = eventsRaw.split('\n').filter((line) => line.length > 0)
    expect(lines.some((line) => line.includes('"ChapterCommitted"'))).toBe(true)
    const pointer = JSON.parse(lines.at(-1)!) as Record<string, unknown>
    expect(pointer.type).toBe('ContextCompiled')
    expect(pointer.seq).toBe(lines.length - 1)
    expect(pointer.receiptId).toBe(receipt.id)
  })
})
