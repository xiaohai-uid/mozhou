// @vitest-environment node
/**
 * D06 依赖钉版产出入口回归（change-impact-engine-spec §2 D06 / ADR-0003 §2.1）。
 *
 * 被测行为：Web 生成链路的唯一上下文入口 buildDraftContext 走正式编译时，必须把
 * 「本次真正入包的版本化实体」暂存落盘（提交路径据此钉 ChapterCommitted 行）；
 * 结构层降级（空召回）不落暂存——降级没消费任何版本化实体，不许造假钉版。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitChapter,
  createBook,
  createChapterDraft,
  createEntityCard,
  openDatabase,
  readManifest,
  type PlaneContext,
} from '@mozhou/data-plane'
import { newFactId } from '@mozhou/kernel'
import type { BookId, EntityRef, FactId } from '@mozhou/kernel'
import { readPendingDependencyManifest } from '@mozhou/pipeline'
import { buildDraftContext } from './draftContext.js'

const LIN = 'char:lin-xuan' as EntityRef

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
