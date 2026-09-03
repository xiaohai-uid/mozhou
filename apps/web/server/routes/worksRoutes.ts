/**
 * apps/web · 作品详情、章节目录、装配凭据、变更矩阵与书架路由控制器。
 */
import type { RouteHandler } from '../router.js'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  LocalDataPlane,
  createBook,
  listImpactRecords,
  proseChapterPath,
  readBookRecord,
  readCanonState,
  readProseChapter,
  renderProseChapter,
  runTraversal,
  scanLibrary,
} from '@mozhou/data-plane'
import { canonicalJson, listReceiptIds, loadReceipt } from '@mozhou/context-compiler'
import {
  buildRevisionBriefsForMatrix,
  loadReceiptForResume,
  projectSession,
  readPipelineLedger,
} from '@mozhou/pipeline'
import type { ContextReceipt, ContextReceiptId } from '@mozhou/kernel'
import { sha256Hex } from '@mozhou/data-plane'

function receiptDigestMatch(receipt: ContextReceipt): boolean {
  const digest = sha256Hex(canonicalJson(receipt.replayInputs))
  return digest === receipt.inputsDigest
}

function sanitizeDirName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : '未命名之书'
}

export const worksRoutes: RouteHandler = (req, res, { path, body, json }) => {
  if (req.method !== 'POST') return false

  /* ---- 装配看板 Receipt 读面 ---- */
  if (path === '/api/receipts') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const items = []
    for (const receiptId of listReceiptIds(root)) {
      const receipt = loadReceipt(root, receiptId)
      items.push({
        receiptId,
        chapterIndex: receipt.chapterIndex ?? null,
        totalTokens: receipt.totalTokens,
        hashMatch: receiptDigestMatch(receipt),
      })
    }
    json(200, { ok: true, receipts: items })
    return true
  }

  if (path === '/api/receipt') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const receiptId = typeof body['receiptId'] === 'string' ? body['receiptId'] : null
    if (root === null || receiptId === null) {
      json(400, { ok: false, error: 'root and receiptId required' })
      return true
    }
    const receipt = loadReceiptForResume(root, receiptId as ContextReceiptId)
    const chapterIndex = receipt.chapterIndex ?? null
    const projection = chapterIndex === null ? null : projectSession(readPipelineLedger(root), chapterIndex)
    json(200, {
      ok: true,
      receiptId,
      chapterIndex,
      totalTokens: receipt.totalTokens,
      hashMatch: receiptDigestMatch(receipt),
      receipt,
      resume: {
        sessionOpen: projection?.sessionOpen ?? false,
        currentStep: projection?.currentStep ?? null,
        committed: projection?.committed ?? false,
        finished: projection?.finished ?? false,
        lastReceiptId: projection?.lastReceiptId ?? null,
      },
    })
    return true
  }

  /* ---- 变更矩阵与 Traversal 影响审计 ---- */
  if (path === '/api/change-matrix') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    const plane = LocalDataPlane.open(root)
    const matrix = plane.getChangeMatrix()
    const revisionBriefs = buildRevisionBriefsForMatrix(matrix.columns, listImpactRecords(root))
    json(200, { ok: true, matrix, revisionBriefs })
    return true
  }

  if (path === '/api/change-matrix.rerun') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    const traversalId = typeof body['traversalId'] === 'string' ? body['traversalId'] : null
    if (root === null || traversalId === null) {
      json(400, { ok: false, error: 'root and traversalId required' })
      return true
    }
    const record = listImpactRecords(root).find((r) => r.traversalId === traversalId)
    if (record === undefined) {
      json(404, { ok: false, error: 'no impact record for traversalId: ' + traversalId })
      return true
    }
    runTraversal({
      root,
      taskRef: record.taskRef,
      traversalId: record.traversalId,
      trigger: record.trigger,
      upstreamChanges: record.upstreamChanges,
      recordedAt: new Date().toISOString(),
    })
    json(200, {
      ok: true,
      matrix: LocalDataPlane.open(root).getChangeMatrix(),
      rerunCount: 1,
    })
    return true
  }

  /* ---- 作品概览与全景目录 ---- */
  if (path === '/api/works') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    const plane = LocalDataPlane.open(root)
    const overview = plane.getWorksOverview()
    const canon = readCanonState(root)

    json(200, {
      ok: true,
      book: {
        id: overview.book.id,
        title: overview.book.title,
        root,
        genres: [],
        createdAt: overview.book.createdAt,
      },
      stats: {
        totalChapters: overview.chapters.length,
        committedChapters: overview.committedCount,
        draftChapters: overview.draftCount,
        totalWords: overview.totalWordCount,
        entityCount: canon.entityCards.length,
      },
      chapters: overview.chapters,
      outlineNodes: canon.outlineNodes.map((n) => ({
        id: n.id,
        nodeType: n.nodeType,
        title: n.title,
        status: n.status,
      })),
    })
    return true
  }

  /* ---- 任务中心账本流水 ---- */
  if (path === '/api/tasks') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }

    const ledger = readPipelineLedger(root)
    const traversals = listImpactRecords(root)

    const events = ledger.map((row) => {
      if (row.kind === 'task') {
        const ev = row.event
        const evType = ev.type
        let cat: 'pipeline' | 'traversal' | 'review' | 'canon' = 'pipeline'
        if (evType.startsWith('Traversal')) cat = 'traversal'
        else if (evType.startsWith('Quality')) cat = 'review'
        else if (evType.startsWith('Chapter') || evType.startsWith('Canon')) cat = 'pipeline'

        return {
          position: row.position,
          type: evType,
          timestamp: (ev as { timestamp?: string }).timestamp,
          summary: `${evType} (taskRef: ${(ev as { taskRef?: string }).taskRef ?? '—'})`,
          category: cat,
        }
      } else {
        const r = row.row
        const rowType = typeof r['type'] === 'string' ? r['type'] : 'DomainEvent'
        let cat: 'pipeline' | 'traversal' | 'review' | 'canon' = 'pipeline'
        if (rowType.includes('Traversal')) cat = 'traversal'
        else if (rowType.includes('Quality')) cat = 'review'

        const seq = r['seq']
        const seqText = typeof seq === 'number' || typeof seq === 'string' ? String(seq) : '—'
        return {
          position: row.position,
          type: rowType,
          timestamp: typeof r['at'] === 'string' ? r['at'] : undefined,
          summary: `${rowType} (seq: ${seqText})`,
          category: cat,
        }
      }
    }).reverse()

    json(200, {
      ok: true,
      totalEvents: ledger.length,
      totalTraversals: traversals.length,
      events,
      traversals: [...traversals].reverse(),
    })
    return true
  }

  if (path === '/api/ledger') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    json(200, { ok: true, events: readPipelineLedger(root) })
    return true
  }

  /* ---- 本地书架扫描与导入 ---- */
  if (path === '/api/library') {
    const parentDir = typeof body['parentDir'] === 'string' ? body['parentDir'] : null
    if (parentDir === null) {
      json(400, { ok: false, error: 'parentDir required' })
      return true
    }
    const scan = scanLibrary(parentDir)
    json(200, {
      ok: true,
      books: scan.books.map((entry) => ({
        root: entry.root,
        bookId: entry.book.id,
        title: entry.book.title,
        chapterCount: entry.chapterCount,
      })),
      skipped: scan.skipped,
    })
    return true
  }

  if (path === '/api/library.open') {
    const root = typeof body['root'] === 'string' ? body['root'] : null
    if (root === null) {
      json(400, { ok: false, error: 'root required' })
      return true
    }
    try {
      const book = readBookRecord(root)
      json(200, { ok: true, root, bookId: book.id, title: book.title })
    } catch (error) {
      json(404, { ok: false, error: 'not a valid book root: ' + (error as Error).message })
    }
    return true
  }

  if (path === '/api/library.import') {
    const parentDir = typeof body['parentDir'] === 'string' ? body['parentDir'] : null
    const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
    const initialBody = typeof body['initialBody'] === 'string' ? body['initialBody'].trim() : undefined
    if (parentDir === null || title.length === 0) {
      json(400, { ok: false, error: 'parentDir and non-empty title required' })
      return true
    }
    try {
      const result = createBook({ dir: join(parentDir, sanitizeDirName(title)), title })
      if (initialBody !== undefined && initialBody.length > 0) {
        try {
          const plane = LocalDataPlane.open(result.root)
          try {
            plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
            const scan = readProseChapter(result.root, proseChapterPath(1))
            const updatedContent = renderProseChapter({
              mozhouId: scan.mozhouId,
              revision: scan.revision,
              chapterIndex: 1,
              phase: 'draft',
              body: `# 第一章\n\n${initialBody}\n`,
            })
            const absPath = join(result.root, proseChapterPath(1))
            writeFileSync(absPath, updatedContent, 'utf8')
          } finally {
            plane.close()
          }
        } catch {
          // 容错处理
        }
      }
      json(200, {
        ok: true,
        root: result.root,
        bookId: result.book.id,
        title: result.book.title,
      })
    } catch (error) {
      json(409, { ok: false, error: (error as Error).message })
    }
    return true
  }

  return false
}
