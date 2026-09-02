/**
 * apps/web · 统一类型安全 API 客户端 SDK (MoZhouApiClient)。
 * 终结 UI 组件中字符串字面量 post('/api/...') 调用与重复的 root 参数拼装。
 */
import { post } from '../lib/post'
import type {
  BackupExportResponse,
  BookSourceSearchResponse,
  CapabilitiesResponse,
  CapabilitySquareResponse,
  ChangeMatrixResponse,
  CloudSyncResponse,
  CrawlerExtractResponse,
  DraftQuestionResponse,
  LibraryOpenResponse,
  LibraryResponse,
  MembershipResponse,
  NovelBreakdownResponse,
  RankScanResponse,
  ReceiptDetailResponse,
  ReceiptListResponse,
  StoryBrainFactsResponse,
  StyleDistillResponse,
  TasksResponse,
  WebSearchResponse,
  WorksOverviewResponse,
} from '../../server/api'
import type { QualityPolicy } from '@mozhou/quality-engine'

export interface ApiClientConfig {
  readonly root?: string | null | undefined
}

export class MoZhouApiClient {
  constructor(private readonly _config: ApiClientConfig = {}) {}

  get root(): string | null {
    return this._config.root ?? null
  }

  private requireRoot(): string {
    const r = this.root
    if (!r) throw new Error('ApiClient: root is required for this operation')
    return r
  }

  /* ---- 书目与数据面 ---- */
  createBook(params: { title?: string; dir?: string } = {}): Promise<{ ok: boolean; root: string; bookId: string }> {
    return post('/api/book', params)
  }

  getBookState(): Promise<{ ok: boolean; state: unknown }> {
    return post('/api/book.state', { root: this.requireRoot() })
  }

  getStoryBrainEntities(): Promise<{ ok: boolean; cards: unknown[] }> {
    return post('/api/story-brain.entities', { root: this.requireRoot() })
  }

  getStoryBrainFacts(options: { entityIds?: readonly string[] } = {}): Promise<StoryBrainFactsResponse> {
    return post('/api/story-brain.facts', {
      root: this.requireRoot(),
      ...(options.entityIds ? { entityIds: options.entityIds } : {}),
    })
  }

  getReceipts(): Promise<ReceiptListResponse> {
    return post('/api/receipts', { root: this.requireRoot() })
  }

  getReceipt(receiptId: string): Promise<ReceiptDetailResponse> {
    return post('/api/receipt', { root: this.requireRoot(), receiptId })
  }

  getChangeMatrix(): Promise<ChangeMatrixResponse> {
    return post('/api/change-matrix', { root: this.requireRoot() })
  }

  rerunChangeMatrix(traversalId: string): Promise<ChangeMatrixResponse> {
    return post('/api/change-matrix.rerun', { root: this.requireRoot(), traversalId })
  }

  /* ---- 创作台、技能与审查 ---- */
  getCapabilities(): Promise<CapabilitiesResponse> {
    return post('/api/capabilities', {})
  }

  getCapabilitySquare(): Promise<CapabilitySquareResponse> {
    return post('/api/capability-square', {})
  }

  getDraftQuestion(prompt?: string): Promise<DraftQuestionResponse> {
    return post('/api/draft.question', prompt ? { prompt } : {})
  }

  reviewChapter(chapterIndex: number, policy?: QualityPolicy): Promise<{
    ok: boolean
    verdict: string
    reportId: string
    reportPath: string
    draftRevision: number
    draftContentHash: string
    reworkCount: number
    current: boolean
    blockingFailures: unknown[]
    advisories: unknown[]
    semanticReviewer: string
    mechanicalGate?: unknown
  }> {
    return post('/api/chapter.review', {
      root: this.requireRoot(),
      chapterIndex,
      ...(policy ? { policy } : {}),
    })
  }

  reworkChapter(chapterIndex: number): Promise<{ ok: boolean; currentStep: string; reworkCount: number }> {
    return post('/api/chapter.rework', { root: this.requireRoot(), chapterIndex })
  }

  recordCorrection(chapterIndex: number, reasons: readonly string[], note?: string): Promise<{ ok: boolean; reportId: string; revision: number }> {
    return post('/api/chapter.corrections', {
      root: this.requireRoot(),
      chapterIndex,
      reasons,
      ...(note ? { note } : {}),
    })
  }

  getChapterQuality(chapterIndex: number): Promise<{ ok: boolean; status: string; report: unknown; current: boolean }> {
    return post('/api/chapter.quality', { root: this.requireRoot(), chapterIndex })
  }

  /* ---- 作品、书架与任务 ---- */
  getWorks(): Promise<WorksOverviewResponse> {
    return post('/api/works', { root: this.requireRoot() })
  }

  getTasks(): Promise<TasksResponse> {
    return post('/api/tasks', { root: this.requireRoot() })
  }

  getLibrary(parentDir?: string): Promise<LibraryResponse> {
    return post('/api/library', parentDir ? { parentDir } : {})
  }

  openLibrary(root: string): Promise<LibraryOpenResponse> {
    return post('/api/library.open', { root })
  }

  importLibrary(parentDir: string, title: string): Promise<{ ok: boolean; book: unknown }> {
    return post('/api/library.import', { parentDir, title })
  }

  /* ---- 商业化、资源与系统 ---- */
  getStyle(): Promise<StyleDistillResponse> {
    return post('/api/style', { root: this.requireRoot() })
  }

  distillStyle(text: string): Promise<StyleDistillResponse> {
    return post('/api/style.distill', {
      text,
      ...(this.root ? { root: this.root } : {}),
    })
  }

  getNovelBreakdown(sampleText?: string): Promise<NovelBreakdownResponse> {
    return post('/api/novel-breakdown', {
      ...(this.root ? { root: this.root } : {}),
      ...(sampleText ? { sampleText } : {}),
    })
  }

  getRankScan(): Promise<RankScanResponse> {
    return post('/api/rank-scan', {})
  }

  searchBookSource(query: string): Promise<BookSourceSearchResponse> {
    return post('/api/book-source.search', { query })
  }

  extractCrawler(url: string): Promise<CrawlerExtractResponse> {
    return post('/api/crawler.extract', { url })
  }

  searchWeb(query: string): Promise<WebSearchResponse> {
    return post('/api/web-search', { query })
  }

  getCloudSync(): Promise<CloudSyncResponse> {
    return post('/api/cloud-sync', { root: this.requireRoot() })
  }

  backupCloudSync(): Promise<BackupExportResponse> {
    return post('/api/cloud-sync.backup', { root: this.requireRoot() })
  }

  getMembership(): Promise<MembershipResponse> {
    return post('/api/membership', {})
  }

  activateMembership(licenseKey: string): Promise<MembershipResponse> {
    return post('/api/membership.activate', { licenseKey })
  }
}

/** 统一工厂函数 */
export function createApiClient(root?: string | null | undefined): MoZhouApiClient {
  return new MoZhouApiClient({ root })
}
