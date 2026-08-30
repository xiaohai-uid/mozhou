/**
 * apps/web 同进程 API 中间件（Phase 6 · T31 R1 修订）。
 *
 * 修正理由（t76 R1）：后端库直接 import node:fs/node:crypto，浏览器端打包即炸——
 * 因此不在浏览器直引 workspace 包，改为 Node 侧中间件直调后端读面、JSON 直出；
 * dev = Vite middleware，prod = 薄 server serve dist + 挂载同一中间件。
 *
 * 形态：Connect-style (req, res, next)。全部读面函数在此直调（零契约翻译层）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORRECTION_REASONS, hashProse, isQualityReviewCurrent } from '@mozhou/quality-engine'
import type { QualityPolicy, QualityReviewReport } from '@mozhou/quality-engine'
import {
  ChapterProductionSession,
  projectSession,
  QualityReworkLimitExceededError,
  recordAuthorCorrection,
  runReviewStep,
} from '@mozhou/pipeline'
import { createBook, proseChapterPath, readCanonState, readProseChapter } from '@mozhou/data-plane'
import { readPipelineLedger } from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function bodyOf(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      try { resolve(JSON.parse(raw) as Record<string, unknown>) } catch { resolve({}) }
    })
  })
}

function urlPath(req: IncomingMessage): string {
  const url = req.url ?? '/'
  return url.split('?')[0] ?? '/'
}

/**
 * 中间件：仅处理 /api/* 前缀；非 API 请求交给 next()（Vite 静态或 prod serve）。
 * 端点：
 *   POST /api/book        {title, dir} → createBook
 *   POST /api/book.state  {root}      → readCanonState（Story Brain 基底）
 *   POST /api/ledger      {root}      → readPipelineLedger（Traversal/账本可见）
 *   POST /api/chapter.review      {root, chapterIndex} → runReviewStep + 审查落账
 *   POST /api/chapter.rework      {root, chapterIndex} → 显式质量回炉（上限 2）
 *   POST /api/chapter.corrections {root, chapterIndex, reasons[], note?} → 纠错记录
 *   POST /api/chapter.quality     {root, chapterIndex} → 最新报告 + current/stale
 */
export function apiMiddleware(): Middleware {
  return (req, res, next) => {
    const path = urlPath(req)
    if (!path.startsWith('/api/')) { next(); return }
    void (async () => {
      try {
        if (req.method === 'POST' && path === '/api/book') {
          const body = await bodyOf(req)
          const dir = typeof body['dir'] === 'string' ? body['dir'] : '/tmp/mozhou-book-' + Date.now()
          const title = typeof body['title'] === 'string' ? body['title'] : '未命名之书'
          const result = createBook({ dir, title })
          json(res, 200, { ok: true, root: result.root, bookId: result.book.id })
          return
        }
        if (req.method === 'POST' && path === '/api/book.state') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, state: readCanonState(root) })
          return
        }
        if (req.method === 'POST' && path === '/api/ledger') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, events: readPipelineLedger(root) })
          return
        }
        /* ---- ADR-0025（Task 9）：文学质量审查面 ----
         * 作者主权纪律：pass 不自动 commit；blocking_fail 不自动回炉；
         * 回炉只经 /api/chapter.rework 显式触发（session 上限 2 次硬约束）；
         * 响应只含报告身份/裁决/证据，不含任何模型思维链。 */
        if (req.method === 'POST' && path === '/api/chapter.review') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
          if (root === null || chapterIndex === null) { json(res, 400, { ok: false, error: 'root and chapterIndex required' }); return }
          const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
          if (session === null) { json(res, 409, { ok: false, error: 'chapter ' + chapterIndex + ' has no open production session' }); return }
          if (session.currentStep === 'draft') session.advance('review')
          if (session.currentStep !== 'review') {
            json(res, 409, { ok: false, error: 'review requires session at draft|review, got ' + session.currentStep })
            return
          }
          const receiptId = session.project().lastReceiptId ?? 'rcpt_web_' + String(chapterIndex)
          // 调用方可携策略（编排者责任）；缺省 = 平台默认规则集（含语义规则——
          // 无语义提供方时将显式 refused，不静默降级）。
          const rawPolicy = body['policy'] as QualityPolicy | undefined
          const policy =
            rawPolicy !== undefined &&
            rawPolicy.schemaVersion === 1 &&
            rawPolicy.maxAutomaticReworks === 2 &&
            Array.isArray(rawPolicy.rules)
              ? rawPolicy
              : undefined
          const outcome = await runReviewStep({
            bookRoot: root,
            chapterIndex,
            receiptId,
            reviewer: { providerId: 'web', model: 'web-direct', recipeVersion: '0.0.0' },
            ...(policy !== undefined ? { policy } : {}),
          })
          session.recordQualityReview({
            reportId: outcome.report.reportId,
            verdict: outcome.report.verdict,
            reportPath: outcome.reportRelPath,
            draftRevision: outcome.input.revision,
            draftContentHash: outcome.report.anchor.draftContentHash,
            receiptId,
          })
          const projection = session.project()
          const failed = outcome.report.evaluations.filter((e) => e.verdict === 'fail')
          json(res, 200, {
            ok: true,
            verdict: outcome.report.verdict,
            reportId: outcome.report.reportId,
            reportPath: outcome.reportRelPath,
            draftRevision: outcome.input.revision,
            draftContentHash: outcome.report.anchor.draftContentHash,
            reworkCount: projection.qualityReworkCount,
            current: true,
            // 审查轮修订：按评估自带的 severity 分类——advisory fail 不再混入 blocking
            blockingFailures: failed.filter((e) => e.severity === 'blocking'),
            advisories: failed.filter((e) => e.severity === 'advisory'),
            // Gate 3 边界标记：web 直连面未挂语义审查者（结构接线完成 / semantic review unavailable）
            semanticReviewer: 'unavailable',
          })
          return
        }
        if (req.method === 'POST' && path === '/api/chapter.rework') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
          if (root === null || chapterIndex === null) { json(res, 400, { ok: false, error: 'root and chapterIndex required' }); return }
          const session = ChapterProductionSession.resume({ bus: new PublishBus(), root, chapterIndex })
          if (session === null) { json(res, 409, { ok: false, error: 'chapter ' + chapterIndex + ' has no open production session' }); return }
          try {
            session.requestQualityRework()
          } catch (error) {
            if (error instanceof QualityReworkLimitExceededError) {
              json(res, 422, { ok: false, code: 'QualityReworkLimitExceeded', error: error.message })
              return
            }
            throw error
          }
          json(res, 200, {
            ok: true,
            currentStep: session.currentStep,
            reworkCount: session.project().qualityReworkCount,
          })
          return
        }
        if (req.method === 'POST' && path === '/api/chapter.corrections') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
          const rawReasons = Array.isArray(body['reasons']) ? body['reasons'] : []
          const reasons = rawReasons.filter(
            (r): r is (typeof CORRECTION_REASONS)[number] =>
              typeof r === 'string' && (CORRECTION_REASONS as readonly string[]).includes(r),
          )
          if (root === null || chapterIndex === null) { json(res, 400, { ok: false, error: 'root and chapterIndex required' }); return }
          if (reasons.length === 0) { json(res, 400, { ok: false, error: 'reasons must contain at least one known correction reason' }); return }
          const note = typeof body['note'] === 'string' ? body['note'] : undefined
          // 纠错 = 元数据动作：零正文副作用、零 revision 步进（编辑走 user edit）
          recordAuthorCorrection({
            bus: new PublishBus(),
            bookRoot: root,
            taskRef: 'tsk_web_correction_' + String(chapterIndex),
            chapterIndex,
            reasons,
            ...(note !== undefined ? { note } : {}),
          })
          json(res, 200, { ok: true, recorded: reasons.length, noteDigest: note === undefined ? null : hashProse(note) })
          return
        }
        if (req.method === 'POST' && path === '/api/chapter.quality') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const chapterIndex = typeof body['chapterIndex'] === 'number' ? body['chapterIndex'] : null
          if (root === null || chapterIndex === null) { json(res, 400, { ok: false, error: 'root and chapterIndex required' }); return }
          const reportDir = join(root, '.mozhou', 'quality-reviews', 'chapter_' + String(chapterIndex))
          if (!existsSync(reportDir)) { json(res, 200, { ok: true, hasReport: false }); return }
          const files = readdirSync(reportDir).filter((f) => f.startsWith('report_') && f.endsWith('.json')).sort()
          const latest = files[files.length - 1]
          if (latest === undefined) { json(res, 200, { ok: true, hasReport: false }); return }
          const report = JSON.parse(readFileSync(join(reportDir, latest), 'utf8')) as QualityReviewReport
          const scan = readProseChapter(root, proseChapterPath(chapterIndex))
          const draftCurrent = scan.phase === 'draft'
            ? isQualityReviewCurrent(report, { draftRevision: scan.revision, draftContentHash: hashProse(scan.body) })
            : false
          const projection = projectSession(readPipelineLedger(root), chapterIndex)
          const failed = report.evaluations.filter((e) => e.verdict === 'fail')
          json(res, 200, {
            ok: true,
            hasReport: true,
            verdict: report.verdict,
            reportId: report.reportId,
            draftRevision: report.anchor.draftRevision,
            draftContentHash: report.anchor.draftContentHash,
            current: draftCurrent,
            reworkCount: projection.qualityReworkCount,
            blockingFailures: failed.filter((e) => e.severity === 'blocking'),
            advisories: failed.filter((e) => e.severity === 'advisory'),
            semanticReviewer: 'unavailable',
          })
          return
        }
        json(res, 404, { ok: false, error: 'no such api endpoint: ' + path })
      } catch (error) {
        // 失败显式（UVSD §14）：错误 JSON，绝不静默
        json(res, 500, { ok: false, error: (error as Error).message })
      }
    })()
  }
}

/**
 * Vite 插件形态：dev = configureServer 挂中间件；prod = configurePreviewServer
 * 挂同一中间件（vite preview 即『静态 dist + 同进程 API』，零额外进程，t76 R1）。
 */
import type { Plugin } from 'vite'

export function moZhouApi(): Plugin {
  const mw = apiMiddleware()
  return {
    name: 'mozhou-api',
    configureServer(server) {
      server.middlewares.use(mw)
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw)
    },
  }
}
