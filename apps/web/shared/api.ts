/**
 * apps/web/shared/api.ts · 应用共享 DTO 契约 (Plan §6.6)。
 *
 * 供 UI (apps/web/src/) 与服务端 (apps/web/server/) 共享消费，保持 100% browser-safe。
 * 严禁依赖任何 Node.js 原生模块或服务端内部存储。
 */
import type { ChapterPhase, ChangeMatrix, ImpactRecord } from '@mozhou/data-plane'
import type { ContextReceipt, EntityRef, KnowledgePerspectiveEntry, KnowledgeState, TemporalFact } from '@mozhou/kernel'
import type { CommittedTruthAnchor, PipelineStep, RevisionTaskBrief } from '@mozhou/pipeline'
import type { StyleMetrics } from '@mozhou/quality-engine'
import type { StoryboardDocument, SourceSnapshot } from './storyboard.js'

export type { StyleMetrics } from '@mozhou/quality-engine'

/* ============================================================================
 * 1. 爬虫与榜单 DTO
 * ========================================================================== */

export interface RankingItem {
  readonly rank: number
  readonly title: string
  readonly author: string
  readonly category: string
  readonly hotScore: string
  readonly tags: readonly string[]
  readonly goldenFinger: string
  readonly oneLineHook: string
}

export interface RankBoard {
  readonly id: string
  readonly name: string
  readonly platform: 'fanqie' | 'qidian' | 'jjwxc'
  readonly updatedAt: string
  readonly items: readonly RankingItem[]
}

export interface CrawledBook {
  readonly platform: 'qidian' | 'qimao' | 'fanqie'
  readonly platformName: string
  readonly bookId: string
  readonly title: string
  readonly author: string
  readonly category: string | null
  readonly status: string | null
  readonly intro?: string | undefined
  readonly url: string
}

/* ============================================================================
 * 2. 备忘录 DTO
 * ========================================================================== */

export interface MemoNote {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MemoListResponse {
  readonly ok: true
  readonly notes: readonly MemoNote[]
}

export interface MemoMutationResponse {
  readonly ok: true
  readonly note?: MemoNote
  readonly deleted?: true
}

export interface MemoErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

export type MemoResponse = MemoListResponse | MemoMutationResponse | MemoErrorResponse

/* ============================================================================
 * 3. AI 起名 DTO
 * ========================================================================== */

export const NAMING_CATEGORIES = ['character', 'sect', 'item', 'place', 'technique'] as const
export type NamingCategory = (typeof NAMING_CATEGORIES)[number]

export interface NamingSuggestion {
  readonly name: string
  readonly meaning?: string | undefined
}

export interface NamingSuccessResponse {
  readonly ok: true
  readonly mode: 'ai'
  readonly names: readonly NamingSuggestion[]
}

export interface NamingErrorResponse {
  readonly ok: false
  readonly code: string
  readonly error: string
}

/* ============================================================================
 * 4. 提案 DTO (Canon Proposals)
 * ========================================================================== */

export interface CanonProposalItemView {
  readonly itemId: string
  readonly family: string
  readonly riskClass: 'low' | 'medium' | 'high'
  readonly state: 'pending' | 'confirmed' | 'rejected' | 'edit_accepted'
  readonly routingBasis: string
  readonly row: Readonly<Record<string, unknown>>
}

export interface CanonProposalRoutedCounts {
  readonly low: number
  readonly medium: number
  readonly high: number
}

export interface CanonProposalView {
  readonly proposalId: string
  readonly taskRef: string
  readonly chapterIndex: number
  readonly createdAt: string
  readonly state: 'open' | 'consumed'
  readonly consumedAt?: string
  readonly routed: CanonProposalRoutedCounts
  readonly pendingCount: number
  readonly items: readonly CanonProposalItemView[]
}

export interface ProposalListResponse {
  readonly ok: true
  readonly proposals: readonly CanonProposalView[]
}

export interface ProposalDecideResponse {
  readonly ok: true
  readonly action: 'confirmed' | 'rejected' | 'edit_accepted'
  readonly itemId: string
  readonly pendingItems: number
  readonly finalized: boolean
  readonly proposal: CanonProposalView | null
}

export interface ProposalDiscardResponse {
  readonly ok: true
  readonly discarded: true
  readonly proposal: CanonProposalView | null
}

export interface ChapterCommitProposalField {
  readonly proposal: CanonProposalView
  readonly pendingItems: readonly CanonProposalItemView[]
}

/* ============================================================================
 * 5. 核心业务与响应契约定义
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
  readonly providerUnavailableReason?:
    | 'hosted_no_principal'
    | 'no_provider_configured'
    | 'provider_config_invalid'
    | 'provider_endpoint_blocked'
    | null
    | undefined
  readonly providerDetail?: string | undefined
  readonly providerBlockedHost?: string | null | undefined
}

export interface DraftQuestionResponse {
  readonly ok: true
  readonly question: string
  readonly hint: string
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

export interface ChapterProseResponse {
  readonly ok: true
  readonly exists: boolean
  readonly chapterIndex: number
  readonly revision?: number
  readonly phase?: ChapterPhase
  readonly commitId?: string | undefined
  readonly body?: string
}

export interface ChapterProseSaveAuthorEditSignal {
  readonly published: boolean
  readonly blocks: number
  readonly errorDetail: string | null
}

export interface ChapterProseSaveResponse {
  readonly ok: true
  readonly chapterIndex: number
  readonly revision: number
  readonly phase: 'draft'
  readonly created: boolean
  readonly authorEditSignal: ChapterProseSaveAuthorEditSignal
}

export interface ChapterResubmitSessionView {
  readonly taskRef: string
  readonly currentStep: PipelineStep
}

export interface ChapterReopenResponse {
  readonly ok: true
  readonly chapterIndex: number
  readonly reopenedFromCommitId: string
  readonly proseRelPath: string
}

export interface ChapterResubmitResponse {
  readonly ok: true
  readonly chapterIndex: number
  readonly reopenedFromCommitId: string
  readonly proseRelPath: string
  readonly truthAnchor: CommittedTruthAnchor
  readonly resubmitSession: ChapterResubmitSessionView
}

export interface StoryboardSourceResponse {
  readonly ok: true
  readonly source: SourceSnapshot
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
  readonly document: StoryboardDocument
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
    readonly taskCount?: number
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
  readonly taskCount?: number
  readonly events: readonly TaskEventSummary[]
  readonly traversals: readonly ImpactRecord[]
  readonly taskRecords?: readonly unknown[]
}

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
  readonly origin?: string
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

export interface NovelBreakdownRequest {
  readonly root?: string | undefined
  readonly sampleText?: string | undefined
  readonly allowHeuristic?: boolean | undefined
}

export interface NovelBreakdownResponse {
  readonly ok: true
  readonly result: NovelBreakdownResult | null
}

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
  readonly amountFen?: number | undefined
  readonly currency?: 'CNY' | undefined
  readonly catalogVersion?: string | undefined
  readonly sellable?: boolean | undefined
}

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

/** 作者偏好展示 DTO：累积字段保留兼容，展示字段由服务端公有推理函数投影。 */
export interface PreferenceDimensionData {
  readonly S: number
  readonly W: number
  readonly M: number
  readonly emVar: number
  readonly kappaEff: number
  readonly driftStreak: number
  /** 后验均值，不是短窗均值 M。 */
  readonly mean: number
  /** 兼容展示字段名：值为 emVar，语义是短窗方差，不是后验方差。 */
  readonly variance: number
  /** 兼容展示字段名：值为累计观测权 W，不含冷启动伪计数。 */
  readonly nEffective: number
  readonly streak: number
}

export interface PreferenceProfileData {
  readonly version: 1
  readonly cursor: number
  readonly obsCount: number
  readonly degradedWindows: number
  readonly dims: Readonly<Record<string, PreferenceDimensionData>>
  readonly driftLog: readonly {
    readonly dim: string
    readonly sourcePosition: number
    readonly shortMean: number
    readonly mean: number
    readonly sigma: number
  }[]
}

export interface PreferenceResponse {
  readonly ok: boolean
  readonly materialized: boolean
  readonly profile: PreferenceProfileData
  readonly observationCount: number
  readonly error?: string
}

export interface PreferenceRebuildResponse {
  readonly ok: boolean
  readonly observationCount: number
  readonly profile: PreferenceProfileData
  readonly error?: string
}

/** 智能体工具定义与分发 DTO（与 apps/web/server/routes/agentRoutes.ts 同口径，改动必须同步）。 */
export interface ToolDefinitionDto {
  readonly name: string
  readonly description: string
  readonly parameters: {
    readonly type: 'object'
    readonly properties: Readonly<Record<string, unknown>>
    readonly required?: readonly string[]
  }
}

export interface ToolsListDtoResponse {
  readonly ok: true
  readonly tools: readonly ToolDefinitionDto[]
}

export interface ToolResultDto {
  readonly ok: boolean
  readonly content: string
  readonly meta?: Readonly<Record<string, unknown>>
}

/** 技能系统 DTO（与 apps/web/server/routes/skillRoutes.ts 同口径，改动必须同步）。 */
export interface SkillSummaryDto {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  readonly license: string
  readonly resources: Readonly<Record<'scripts' | 'references' | 'assets', number>>
}

export interface SkillRecordDto extends SkillSummaryDto {
  readonly body: string
  readonly dir: string
}

export interface SkillsListDtoResponse {
  readonly ok: true
  readonly skills: readonly SkillSummaryDto[]
}

export interface SkillsReadDtoResponse {
  readonly ok: true
  readonly skill: SkillRecordDto
}

export interface SkillsSaveDtoResponse {
  readonly ok: true
  readonly skill: SkillRecordDto
}

export interface SkillsDeleteDtoResponse {
  readonly ok: true
  readonly deleted: boolean
}

/** 回收站 DTO（与 apps/web/server/routes/recycleRoutes.ts 同口径，改动必须同步）。 */
export interface TrashEntryDto {
  readonly id: string
  readonly originalPath: string
  readonly name: string
  readonly deletedAt: string
  readonly isDirectory: boolean
}

export interface RecycleListDtoResponse {
  readonly ok: true
  readonly entries: readonly TrashEntryDto[]
}

export interface RecycleRestoreDtoResponse {
  readonly ok: true
  readonly restoredTo: string
}

export interface RecyclePurgeDtoResponse {
  readonly ok: true
  readonly purged: boolean
}

