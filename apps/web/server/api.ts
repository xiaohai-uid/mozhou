/**
 * apps/web · 同进程 API 门面入口与分发网关 (ApiDispatcher & Middleware)。
 * 架构重构：全面下沉拆解至 routes/ 领域路由控制器，消除 1800 行单体 if/else 级联。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { ApiRouter } from './router.js'
import { storyBrainRoutes } from './routes/storyBrainRoutes.js'
import { pipelineRoutes } from './routes/pipelineRoutes.js'
import { worksRoutes } from './routes/worksRoutes.js'
import { proseRoutes } from './routes/proseRoutes.js'
import { truthfulPreviewRoutes } from './routes/truthfulPreviewRoutes.js'
import { crawlerRoutes } from './routes/crawlerRoutes.js'
import { systemRoutes } from './routes/systemRoutes.js'
import { storyboardRoutes } from './routes/storyboardRoutes.js'
import { accountRoutes } from './routes/accountRoutes.js'

import type { ChapterPhase, ChangeMatrix, ImpactRecord } from '@mozhou/data-plane'
import type { ContextReceipt } from '@mozhou/kernel'
import type {
  EntityRef,
  KnowledgePerspectiveEntry,
  KnowledgeState,
  TemporalFact,
} from '@mozhou/kernel'
import type { RevisionTaskBrief } from '@mozhou/pipeline'
import type { StyleMetrics } from '@mozhou/quality-engine'
import type { RankBoard } from './crawlers/rankings.js'
import type { CrawledBook } from './crawlers/qidian.js'

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

/* ============================================================================
 * 响应契约定义 (API Response Shapes)
 * ========================================================================== */

export interface StoryBrainFactsResponse {
  readonly ok: true
  readonly chapter: number
  readonly currentChapterIndex: number | null
  readonly chapters: readonly { chapterIndex: number; phase: ChapterPhase }[]
  readonly canon: readonly TemporalFact[]
  readonly perspective: readonly (KnowledgePerspectiveEntry & { subject: EntityRef | null })[]
  readonly invalidated: readonly (KnowledgeState & { subject: EntityRef | null })[]
}

export interface ReceiptListItem {
  readonly receiptId: string
  readonly chapterIndex: number | null
  readonly totalTokens: number
  readonly hashMatch: boolean
}

export interface ReceiptListResponse {
  readonly ok: true
  readonly receipts: readonly ReceiptListItem[]
}

export interface ReceiptResumeView {
  readonly sessionOpen: boolean
  readonly currentStep: string | null
  readonly committed: boolean
  readonly finished: boolean
  readonly lastReceiptId: string | null
}

export interface ReceiptDetailResponse {
  readonly ok: true
  readonly receiptId: string
  readonly chapterIndex: number | null
  readonly totalTokens: number
  readonly hashMatch: boolean
  readonly receipt: ContextReceipt
  readonly resume: ReceiptResumeView
}

export interface ChangeMatrixResponse {
  readonly ok: true
  readonly matrix: ChangeMatrix
  readonly rerunCount?: number
  readonly revisionBriefs?: Record<number, RevisionTaskBrief>
}

export interface CapabilityListItem {
  readonly id: string
  readonly label: string
}

export interface CapabilitiesResponse {
  readonly ok: true
  readonly capabilities: readonly CapabilityListItem[]
  readonly providerAvailable: boolean
}

export interface DraftQuestionResponse {
  readonly ok: true
  readonly question: string
  readonly hint: string
  /** 作者可选的快捷回答（原型 choice-row）。 */
  readonly choices: readonly string[]
  readonly prompt?: string | undefined
  readonly questions?: readonly {
    readonly id: string
    readonly title: string
    readonly hint: string
    readonly choices: readonly string[]
  }[] | undefined
}

export interface DraftStreamInit {
  readonly ok: true
  readonly event: 'start' | 'delta' | 'done' | 'error'
  readonly prompt?: string
  readonly text?: string
  readonly outcome?: string
  readonly partial?: boolean
  readonly chars?: number
  readonly error?: string
}

export interface DraftStreamUnavailable {
  readonly ok: true
  readonly event: 'unavailable'
  readonly reason: string
}

export interface LibraryResponse {
  readonly ok: true
  readonly books: readonly {
    readonly root: string
    readonly bookId: string
    readonly title: string
    readonly chapterCount: number
  }[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

export interface LibraryOpenResponse {
  readonly ok: true
  readonly root: string
  readonly bookId: string
  readonly title: string
}

export interface WorksChapterSummary {
  readonly chapterIndex: number
  readonly title: string
  readonly phase: ChapterPhase
  readonly wordCount: number
  readonly revision: number
}

/* ---- 章节正文（发布评审 R1/R2：预期版本契约）---- */

/** POST /api/chapter.prose：作者实际读取内容的章快照。 */
export interface ChapterProseResponse {
  readonly ok: true
  readonly exists: boolean
  readonly chapterIndex: number
  readonly revision?: number
  readonly phase?: ChapterPhase
  readonly commitId?: string | undefined
  readonly body?: string
}

/** POST /api/chapter.prose.save 成功响应（phase 恒 draft）。 */
export interface ChapterProseSaveResponse {
  readonly ok: true
  readonly chapterIndex: number
  readonly revision: number
  readonly phase: 'draft'
  readonly created: boolean
}

/** POST /api/chapter.reopen 成功响应。 */
export interface ChapterReopenResponse {
  readonly ok: true
  readonly chapterIndex: number
  readonly reopenedFromCommitId: string
  readonly proseRelPath: string
}

/* ---- 漫剧分镜（T02 契约；领域类型真源在 server/storyboard/contract.ts）---- */

export interface StoryboardSourceResponse {
  readonly ok: true
  readonly source: import('./storyboard/contract.js').SourceSnapshot
  readonly title: string
  readonly characterCount: number
  readonly excerpt: string
}

export interface StoryboardSaveResponse {
  readonly ok: true
  readonly id: string
  readonly revision: number
  readonly sourceStale: boolean
}

export interface StoryboardListItemDto {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly sourceStale: boolean
  readonly updatedAt: string
}

export interface StoryboardListResponse {
  readonly ok: true
  readonly items: readonly StoryboardListItemDto[]
  readonly skippedInvalid: number
}

export interface StoryboardGetResponse {
  readonly ok: true
  readonly document: import('./storyboard/contract.js').StoryboardDocument
  readonly sourceStale: boolean
}

export interface WorksOverviewResponse {
  readonly ok: true
  readonly book: {
    readonly id: string
    readonly title: string
    readonly root: string
    readonly genres: readonly string[]
    readonly createdAt: string
  }
  readonly stats: {
    readonly totalChapters: number
    readonly committedChapters: number
    readonly draftChapters: number
    readonly totalWords: number
    readonly entityCount: number
  }
  readonly chapters: readonly WorksChapterSummary[]
  readonly outlineNodes: readonly {
    readonly id: string
    readonly nodeType: string
    readonly title: string
    readonly status: string
  }[]
}

export interface TaskEventSummary {
  readonly position: number
  readonly type: string
  readonly timestamp?: string | undefined
  readonly summary: string
  readonly category: 'pipeline' | 'traversal' | 'review' | 'canon' | 'system'
}

export interface TasksResponse {
  readonly ok: true
  readonly totalEvents: number
  readonly totalTraversals: number
  readonly events: readonly TaskEventSummary[]
  readonly traversals: readonly ImpactRecord[]
}

export type { StyleMetrics } from '@mozhou/quality-engine'

export interface StyleDistillResponse {
  readonly ok: true
  readonly currentProfiles: Record<string, {
    readonly scenarioType: string
    readonly revision: number
    readonly dialogueRatio: number
    readonly sensoryDensity: number
    readonly actionPacing: number
  }> | null
  readonly sampleMetrics?: StyleMetrics | undefined
}

export interface NovelBreakdownResult {
  readonly storyCore: {
    readonly protagonist: string
    readonly mainGoal: string
    readonly goldenFinger: string
    readonly mainConflict: string
  }
  readonly chapterPacing: readonly {
    readonly chapter: number
    readonly title: string
    readonly hook: string
    readonly payOff: string
    readonly pacingGrade: string
  }[]
  readonly characterArcs: readonly {
    readonly name: string
    readonly role: string
    readonly desire: string
    readonly flaw: string
  }[]
  readonly emotionalBeats: readonly {
    readonly type: 'suppression' | 'twist' | 'climax' | 'cliffhanger'
    readonly label: string
    readonly description: string
  }[]
}

export interface NovelBreakdownResponse {
  readonly ok: true
  readonly result: NovelBreakdownResult
}

export type { RankBoard, RankingItem } from './crawlers/rankings.js'
export type { CrawledBook } from './crawlers/qidian.js'

export interface RankScanResponse {
  readonly ok: true
  readonly boards: readonly RankBoard[]
  readonly trendingKeywords: readonly { readonly name: string; readonly heat: number }[]
  readonly degraded?: boolean | undefined
  readonly note?: string | undefined
}

export interface BookSourceSearchResponse {
  readonly ok: true
  readonly query: string
  readonly total: number
  readonly books: readonly CrawledBook[]
  readonly degraded: boolean
  readonly notes: readonly string[]
}

export interface CrawlerExtractResponse {
  readonly ok: boolean
  readonly title: string
  readonly content: string
  readonly channel: 'crawl4ai' | 'http_fallback'
  readonly error?: string | undefined
}

export interface SearchResultItem {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly source: string
  readonly snippet: string
  readonly detail: string
  readonly tags: readonly string[]
}

export interface ApiUnavailableResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

export interface WebSearchSuccessResponse {
  readonly ok: true
  readonly query: string
  readonly results: readonly SearchResultItem[]
  readonly hotQueries: readonly string[]
}

export type WebSearchResponse = WebSearchSuccessResponse | ApiUnavailableResponse

export interface CloudSyncResponse {
  readonly ok: true
  readonly localReady: boolean
  readonly syncStatus: 'idle' | 'syncing' | 'offline_ready' | 'synced'
  readonly lastLocalSnapshotAt: string
  readonly pendingChangesCount: number
  readonly storageUsage: {
    readonly localCanonFiles: number
    readonly databaseBytes: number
  }
  readonly syncState?: {
    readonly lastSyncedAt: string
    readonly status: 'idle' | 'syncing' | 'error'
    readonly pendingUploads: number
    readonly pendingDownloads: number
    readonly storageUsedBytes: number
  } | undefined
}

export interface BackupExportResponse {
  readonly ok: true
  readonly snapshotId: string
  readonly bookTitle: string
  readonly exportedAt: string
  readonly fileCount: number
  readonly manifestDigest: string
  readonly backupId?: string | undefined
  readonly backupPath?: string | undefined
  readonly sizeBytes?: number | undefined
}

export interface LicensePlan {
  readonly id: string
  readonly name: string
  readonly price: string
  readonly tag?: string | undefined
  readonly features: readonly string[]
  readonly current: boolean
  /** T02 catalog 冻结：付费档固定金额（分）；客户端不可覆盖，只读展示。 */
  readonly amountFen?: number | undefined
  readonly currency?: 'CNY' | undefined
  readonly catalogVersion?: string | undefined
  /** false = 官方调用额度/商品尚不可购买（未实测成本），UI 不得误导为可购。 */
  readonly sellable?: boolean | undefined
}

/** GET /api/billing/catalog：服务端定价唯一真源（T02 冻结；C4 订单金额只取自这里）。 */
export interface BillingCatalogResponse {
  readonly ok: true
  readonly catalog: {
    readonly version: string
    readonly currency: 'CNY'
    readonly basicAlwaysAvailable: readonly string[]
    readonly pro: { readonly planId: 'pro_monthly'; readonly amountFen: 1900; readonly entitlementKeys: readonly string[] }
    readonly max: { readonly planId: 'max_monthly'; readonly amountFen: 3900; readonly entitlementKeys: readonly string[] }
    readonly managed: {
      readonly sellable: boolean
      readonly includedCallsPerMonth: number | null
      readonly worstCasePerCallFen: number | null
    }
  }
}

export interface MembershipResponse {
  readonly ok: true
  /** 未开通支付/激活前为 null（诚实声明：当前仅社区免费版）。 */
  readonly license: {
    readonly planId: string
    readonly planName: string
    readonly licenseKey: string
    readonly activatedAt: string
    readonly expiresAt: string
    readonly status: 'active' | 'expired' | 'revoked'
  } | null
  readonly plans: readonly LicensePlan[]
  readonly catalogVersion?: string | undefined
}

export type CapabilityStatus =
  | 'native'
  | 'provider_required'
  | 'configuration_required'
  | 'external_source_required'

export interface CapabilitySquareEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly status: CapabilityStatus
  readonly evidence: string
}

export interface CapabilitySquareGroup {
  readonly group: string
  readonly entries: readonly CapabilitySquareEntry[]
}

export interface CapabilitySquareResponse {
  readonly ok: true
  readonly providerAvailable: boolean
  readonly groups: readonly CapabilitySquareGroup[]
}

/* ============================================================================
 * 路由分发器与中间件装配 (Router Dispatcher)
 * ========================================================================== */

/**
 * 路由装配工厂：生产服务器（productionServer.ts）与 Vite 中间件各自持有独立实例，
 * 避免跨入口共享可变路由状态。
 */
export function createMoZhouApiRouter(): ApiRouter {
  return new ApiRouter()
    .use(storyBrainRoutes)
    .use(pipelineRoutes)
    .use(worksRoutes)
    .use(proseRoutes)
    .use(truthfulPreviewRoutes)
    .use(crawlerRoutes)
    .use(systemRoutes)
    .use(storyboardRoutes)
    .use(accountRoutes)
}

const apiRouter = createMoZhouApiRouter()

export function apiMiddleware(): Middleware {
  return (req, res, next) => {
    void apiRouter.dispatch(req, res).then((handled) => {
      if (!handled) {
        if ((req.url ?? '/').startsWith('/api/')) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'no such api endpoint: ' + (req.url ?? '/') }))
        } else {
          next()
        }
      }
    })
  }
}

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
