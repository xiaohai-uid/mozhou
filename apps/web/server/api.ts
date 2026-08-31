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
import { canonicalJson, listReceiptIds, loadReceipt } from '@mozhou/context-compiler'
import {
  ChapterProductionSession,
  loadReceiptForResume,
  projectSession,
  QualityReworkLimitExceededError,
  recordAuthorCorrection,
  runReviewStep,
} from '@mozhou/pipeline'
import {
  assembleChangeMatrix,
  createBook,
  listImpactRecords,
  proseChapterPath,
  queryInvalidatedKnowledgeStates,
  readCanonState,
  readNarrativeSnapshot,
  readProseChapter,
  runTraversal,
  scanEntityCards,
  sha256Hex,
} from '@mozhou/data-plane'
import type { ChapterPhase } from '@mozhou/data-plane'
import type { ChangeMatrix } from '@mozhou/data-plane'
import type { ContextReceipt, ContextReceiptId } from '@mozhou/kernel'
import {
  queryActiveFacts as queryVisibleFactsInSnapshot,
  queryKnowledgePerspective,
} from '@mozhou/kernel'
import type {
  EntityRef,
  KnowledgePerspectiveEntry,
  KnowledgeState,
  TemporalFact,
} from '@mozhou/kernel'
import { readPipelineLedger } from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

/**
 * T41（#86）Story Brain 事实区响应（认知三级通道，ADR-0026）：
 * - canon：queryActiveFacts @（当前章，POV 主角）——knows 授权的秘密含在内；
 * - perspective：suspects/believes 安全通道（kernel queryKnowledgePerspective
 *   逐持有者投影）——秘密正典值零泄漏，只出限定语义文本；
 * - invalidated：queryInvalidatedKnowledgeStates——引用 rejected 事实的认知行；
 * - subject 为实体点击过滤的联接元数据（不承载通道内容）。
 */
export interface StoryBrainFactsResponse {
  readonly ok: true
  /** 事实查询锚点章（最新草稿章；无草稿取最新章；无章 = 1）。 */
  readonly chapter: number
  /** 当前章（最新草稿优先）；无正文章为 null（大纲树不高亮）。 */
  readonly currentChapterIndex: number | null
  /** 正文章扫描（章一体两面 readProseChapter，探测序）。 */
  readonly chapters: readonly { chapterIndex: number; phase: ChapterPhase }[]
  readonly canon: readonly TemporalFact[]
  readonly perspective: readonly (KnowledgePerspectiveEntry & { subject: EntityRef | null })[]
  readonly invalidated: readonly (KnowledgeState & { subject: EntityRef | null })[]
}

/**
 * T42（#87）装配看板（Context Receipt）读面。
 * 纯只读：列表 = receipts 目录扫描（one-file-one-receipt），
 * 详情 = loadReceipt / loadReceiptForResume 直出（INV-R1/R2：指针存在即凭证在盘，
 * 不重编译）。零新增后端能力——续跑语义由会话投影显式呈现（可恢复/已收卷/无会话）。
 *
 * 「hash match」徽标为真实校验：inputsDigest 恒 = sha256(canonicalJson(replayInputs))
 * （INV-R6），服务端重算比对，漂移即 mismatch——绝不静默降级。
 */
export interface ReceiptListItem {
  readonly receiptId: string
  readonly chapterIndex: number | null
  readonly totalTokens: number
  /** INV-R6 重算校验：hashMatch=false 即盘上凭证与其重放输入面不一致。 */
  readonly hashMatch: boolean
}

export interface ReceiptListResponse {
  readonly ok: true
  readonly receipts: readonly ReceiptListItem[]
}

export interface ReceiptResumeView {
  /** 当前章生产会话投影（无会话 = null）：可恢复性唯一事实源。 */
  readonly sessionOpen: boolean
  readonly currentStep: string | null
  readonly committed: boolean
  readonly finished: boolean
  /** Compile 后崩溃恢复凭据：本窗口最近一张 CHAPTER_DRAFTING 凭证。 */
  readonly lastReceiptId: string | null
}

export interface ReceiptDetailResponse {
  readonly ok: true
  readonly receiptId: string
  readonly chapterIndex: number | null
  readonly totalTokens: number
  readonly hashMatch: boolean
  readonly receipt: ContextReceipt
  /** Replay Inputs 已内嵌在 ContextReceipt.replayInputs（原样直出，不重复搬运）。 */
  readonly resume: ReceiptResumeView
}

/** INV-R6 校验：盘上凭证自重的 replayInputs 规范序列摘要 === inputsDigest。 */
function receiptDigestMatch(receipt: ContextReceipt): boolean {
  return sha256Hex(canonicalJson(receipt.replayInputs)) === receipt.inputsDigest
}

/**
 * T43（#88）变更矩阵响应：行=Traversal（上游变更 + stale 计数）、
 * 列=受影响章，单元格三态（红 needs_rework / 绿 resolved / — not_affected）。
 * 数据面唯一新增后端能力 = data-plane 只读投影 assembleChangeMatrix(root)；
 * 重跑 = runTraversal 幂等覆盖（同 traversalId 覆盖原 impact 文件，不产生重复副作用）。
 * 组件 type-only 直引本类型（零 any）。
 */
export interface ChangeMatrixResponse {
  readonly ok: true
  readonly matrix: ChangeMatrix
  /** 重跑后的矩阵（幂等覆盖后重投影）。 */
  readonly rerunCount?: number | undefined
}

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
 *   POST /api/book                 {title, dir} → createBook
 *   POST /api/book.state           {root}       → readCanonState（Story Brain 基底）
 *   POST /api/story-brain.entities {root}       → scanEntityCards（Story Brain 实体网格，PR #82）
 *   POST /api/story-brain.facts    {root, entityIds?} → 认知三级通道（T41：canon /
 *                                      suspects-believes 安全投影 / invalidated + 章节锚点）
 *   POST /api/receipts             {root}       → 装配看板 Receipt 列表（T42：id/章/tok/hash match）
 *   POST /api/receipt              {root, receiptId} → 单张 Receipt 详情 + 会话投影续跑判态（T42）
 *   POST /api/change-matrix        {root}       → 变更矩阵投影（T43：assembleChangeMatrix 只读）
 *   POST /api/change-matrix.rerun  {root, traversalId} → runTraversal 幂等覆盖重跑（T43）
 *   POST /api/ledger               {root}       → readPipelineLedger（Traversal/账本可见）
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
        if (req.method === 'POST' && path === '/api/story-brain.entities') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, cards: scanEntityCards(root) })
          return
        }
        if (req.method === 'POST' && path === '/api/story-brain.facts') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          const rawEntityIds = Array.isArray(body['entityIds']) ? body['entityIds'] : []
          const entityIds = rawEntityIds.filter((r): r is EntityRef => typeof r === 'string' && r.length > 0)

          // 章节锚点：正文章逐章探测（章一体两面），首个缺失即止——章序连续
          // 由 createChapterDraft 纪律保证；缺章即停止，不猜测后续。
          const chapters: { chapterIndex: number; phase: ChapterPhase }[] = []
          for (let index = 1; ; index += 1) {
            try {
              const scan = readProseChapter(root, proseChapterPath(index))
              chapters.push({ chapterIndex: scan.chapterIndex, phase: scan.phase })
            } catch (error) {
              if ((error as { code?: string }).code === 'ENOENT') break
              throw error
            }
          }
          const latestDraft = [...chapters].reverse().find((chapter) => chapter.phase === 'draft')
          const latest = chapters[chapters.length - 1]
          const currentChapterIndex = latestDraft?.chapterIndex ?? latest?.chapterIndex ?? null
          const chapter = currentChapterIndex ?? 1

          // 一次折叠，四读面同源：canon（kernel 纯函数 = data-plane
          // queryActiveFacts 同语义）+ 逐持有者 suspects/believes 通道。
          const snapshot = readNarrativeSnapshot(root)
          const canon = queryVisibleFactsInSnapshot(snapshot, {
            chapter,
            pov: 'protagonist',
            ...(entityIds.length > 0 ? { entityIds } : {}),
          })

          // reader 非可查询视角（零泄漏门禁拒绝全知视角）；knows 不进本通道
          const holders = new Set<Exclude<KnowledgeState['holder'], 'reader'>>()
          for (const ks of snapshot.knowledgeStates.values()) {
            if (ks.holder === 'reader' || ks.level === 'knows' || ks.knownSinceChapter > chapter) continue
            holders.add(ks.holder)
          }
          const perspective = [...holders].sort().flatMap((holder) =>
            queryKnowledgePerspective(snapshot, { chapter, pov: holder }).map((entry) => ({
              ...entry,
              subject: snapshot.facts.get(entry.factId)?.subject ?? null,
            })),
          )
          const invalidated = queryInvalidatedKnowledgeStates(root).map((ks) => ({
            ...ks,
            subject: snapshot.facts.get(ks.factId)?.subject ?? null,
          }))

          const payload: StoryBrainFactsResponse = {
            ok: true,
            chapter,
            currentChapterIndex,
            chapters,
            canon,
            perspective,
            invalidated,
          }
          json(res, 200, payload)
          return
        }
        /* ---- T42（#87）装配看板读面：纯只读（loadReceipt / loadReceiptForResume 既有，
         *      零新增后端能力）+ INV-R6 hash match 真实校验 + 会话投影续跑判态 ---- */
        if (req.method === 'POST' && path === '/api/receipts') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          const items: ReceiptListItem[] = []
          for (const receiptId of listReceiptIds(root)) {
            const receipt = loadReceipt(root, receiptId)
            items.push({
              receiptId,
              chapterIndex: receipt.chapterIndex ?? null,
              totalTokens: receipt.totalTokens,
              hashMatch: receiptDigestMatch(receipt),
            })
          }
          json(res, 200, { ok: true, receipts: items } satisfies ReceiptListResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/receipt') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const receiptId = typeof body['receiptId'] === 'string' ? body['receiptId'] : null
          if (root === null || receiptId === null) { json(res, 400, { ok: false, error: 'root and receiptId required' }); return }
          // loadReceiptForResume = loadReceipt 同一读面（INV-R1/R2：指针在即凭证在，
          // 恢复按 receiptId 取回产物，不重编译）——详见 packages/pipeline/src/compile-step.ts。
          const receipt = loadReceiptForResume(root, receiptId as ContextReceiptId)
          const chapterIndex = receipt.chapterIndex ?? null
          const projection = chapterIndex === null
            ? null
            : projectSession(readPipelineLedger(root), chapterIndex)
          json(res, 200, {
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
            } satisfies ReceiptResumeView,
          } satisfies ReceiptDetailResponse)
          return
        }
        /* ---- T43（#88）变更矩阵：唯一新增后端能力 assembleChangeMatrix 只读投影
         *      + runTraversal 幂等覆盖重跑（同 traversalId 覆盖原影响文件）。 ---- */
        if (req.method === 'POST' && path === '/api/change-matrix') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          json(res, 200, { ok: true, matrix: assembleChangeMatrix(root) } satisfies ChangeMatrixResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/change-matrix.rerun') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const traversalId = typeof body['traversalId'] === 'string' ? body['traversalId'] : null
          if (root === null || traversalId === null) {
            json(res, 400, { ok: false, error: 'root and traversalId required' })
            return
          }
          const record = listImpactRecords(root).find((r) => r.traversalId === traversalId)
          if (record === undefined) {
            json(res, 404, { ok: false, error: 'no impact record for traversalId: ' + traversalId })
            return
          }
          // 幂等重跑：同 traversalId 覆盖原影响文件；TraversalStarted/Finished 追加审计轨迹。
          runTraversal({
            root,
            taskRef: record.taskRef,
            traversalId: record.traversalId,
            trigger: record.trigger,
            upstreamChanges: record.upstreamChanges,
            recordedAt: new Date().toISOString(),
          })
          json(res, 200, {
            ok: true,
            matrix: assembleChangeMatrix(root),
            rerunCount: 1,
          } satisfies ChangeMatrixResponse)
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
