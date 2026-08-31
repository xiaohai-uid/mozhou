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
  makeDraftProviderBinding,
  projectSession,
  QualityReworkLimitExceededError,
  recordAuthorCorrection,
  runDraftStep,
  runReviewStep,
} from '@mozhou/pipeline'
import {
  assembleChangeMatrix,
  createBook,
  listImpactRecords,
  proseChapterPath,
  queryInvalidatedKnowledgeStates,
  readBookRecord,
  readCanonState,
  readNarrativeSnapshot,
  readProseChapter,
  readStyleProfiles,
  runTraversal,
  scanEntityCards,
  scanLibrary,
  sha256Hex,
} from '@mozhou/data-plane'
import type { ChapterPhase } from '@mozhou/data-plane'
import type { ChangeMatrix, ImpactRecord } from '@mozhou/data-plane'
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
import { NoProviderError, PublishBus, RuntimeEngine } from '@mozhou/runtime'
import type { CapabilityRecipe } from '@mozhou/runtime'
import type { ContextPacket } from '@mozhou/context-compiler'

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

/**
 * T44（#89）中栏写作对话流读面/执行面。
 * - /api/capabilities：技能多选胶囊列表（V1 静态词表 = 原型技能清单；
 *   CapabilityRegistry 运行时注册面后续接真实能力时替换）。
 * - /api/draft.question：墨舟先问（mock 生成；V1 无 LLM，返回固定先问块 +
 *   关联承诺提示）。
 * - /api/draft.stream：NDJSON 流式草稿端点。provider 未配（registry 对
 *   CHAPTER_DRAFTING 无 resolve）⇒ 非流式 {ok:false, code:'PROVIDER_UNAVAILABLE'}
 *   （Gate 3 纪律：显式 unavailable，不静默）。已配 ⇒ runDraftStep 全量产出按
 *   字块序列化为 NDJSON 流（服务端打字机切分），前端逐块渐进渲染。
 */
export interface CapabilityListItem {
  readonly id: string
  readonly label: string
}

export interface CapabilitiesResponse {
  readonly ok: true
  readonly capabilities: readonly CapabilityListItem[]
  /** CHAPTER_DRAFTING provider 是否已配置；false 时 composer 必须显式 unavailable。 */
  readonly providerAvailable: boolean
}

export interface DraftQuestionResponse {
  readonly ok: true
  readonly question: string
  readonly hint: string
  /** 作者可选的快捷回答（原型 choice-row）。 */
  readonly choices: readonly string[]
}

export interface DraftStreamInit {
  /** provider 已配时的起始帧（含 writer 身份）。 */
  readonly ok: true
  readonly event: 'start'
  readonly receiptId: string | null
  readonly chapterIndex: number
}

/** provider 未配时端点载回的非流式错误（unavailable 显式）。 */
export interface DraftStreamUnavailable {
  readonly ok: false
  readonly code: 'PROVIDER_UNAVAILABLE'
  readonly error: string
}

/**
 * 书架（本地书库）读面/切换面：
 * - /api/library        {parentDir} → scanLibrary（含 book.json 的子目录 = 书）
 * - /api/library.open   {root}      → 校验书根并返回 BookInfo（App 切书）
 * - /api/library.import {parentDir, title} → createBook（书源搜索导入落地）
 * 纯本地数据面，零外部抓取、零认证。
 */
export interface LibraryResponse {
  readonly ok: true
  readonly books: readonly { root: string; bookId: string; title: string; chapterCount: number }[]
  readonly skipped: number
}

export interface LibraryOpenResponse {
  readonly ok: true
  readonly root: string
  readonly bookId: string
  readonly title: string
}

/**
 * T47（我的作品）作品概览与章节目录读面。
 * 纯本地数据面（直读 readCanonState + readProseChapter 逐章扫描）：
 * - 作品元信息（ID、标题、题材、创建时间、根路径）
 * - 创作统计（总章数、提交章数、草稿章数、正文总字数、实体卡数）
 * - 章节列表（章序号、标题、相位、字数、修订号）
 * - 大纲节点列表（总纲、分卷纲等节点）
 */
export interface WorksChapterSummary {
  readonly chapterIndex: number
  readonly title: string
  readonly phase: ChapterPhase
  readonly wordCount: number
  readonly revision: number
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

/**
 * T48（任务中心）任务与流水审计读面。
 * 纯本地数据面（聚合 readPipelineLedger 与 listImpactRecords）：
 * - 任务事件总数、Traversal 影响分析总数
 * - 最近事件流水（含类型、摘要、类别分类、时间戳）
 * - 最近 Traversal 记录（影响章数、触发源、上游变更）
 */
export interface TaskEventSummary {
  readonly position: number
  readonly type: string
  readonly timestamp?: string | undefined
  readonly summary: string
  readonly category: 'pipeline' | 'traversal' | 'review' | 'system'
}

export interface TasksResponse {
  readonly ok: true
  readonly totalEvents: number
  readonly totalTraversals: number
  readonly events: readonly TaskEventSummary[]
  readonly traversals: readonly ImpactRecord[]
}

/**
 * T50（风格蒸馏）文风画像与样本分析读面。
 * 纯本地计算与数据面（直读 readStyleProfiles + 确定性句法分面提取）：
 * - 四场景文风画像（动作/对话/情感/设定）
 * - 风格样本蒸馏指标（对白占比、句长分布、感官描写密度、动作节奏）
 */
export interface StyleMetrics {
  readonly charCount: number
  readonly dialogueRatio: number
  readonly avgSentenceLength: number
  readonly shortSentenceRatio: number
  readonly sensoryDensity: number
  readonly actionPacing: number
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

/**
 * T51（小说拆解）故事核、黄金三章节奏与人物弧光分析读面。
 * 纯本地数据面（解析 canon 实体/大纲或对输入样章进行结构化拆解）。
 */
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

/**
 * T52（网文扫榜）多平台榜单透视与题材风向分析读面。
 */
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

export interface RankScanResponse {
  readonly ok: true
  readonly boards: readonly RankBoard[]
  readonly trendingKeywords: readonly { readonly name: string; readonly heat: number }[]
}

/**
 * T53（联网搜索）网文设定与历史民俗资料检索读面。
 */
export interface SearchResultItem {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly source: string
  readonly snippet: string
  readonly detail: string
  readonly tags: readonly string[]
}

export interface WebSearchResponse {
  readonly ok: true
  readonly query: string
  readonly results: readonly SearchResultItem[]
  readonly hotQueries: readonly string[]
}

/**
 * T54（云同步与备份）本地快照与离线同步读面。
 */
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
}

export interface BackupExportResponse {
  readonly ok: true
  readonly snapshotId: string
  readonly bookTitle: string
  readonly exportedAt: string
  readonly fileCount: number
  readonly manifestDigest: string
}

/**
 * T46（技能广场）V1 能力注册表读面。
 * 词表 = 全部 17 项航道（id/label 与 shell/views.ts 同源）；每项声明其
 * 真实状态与证据——native 指新栈读面/执行面真实接线；provider_required /
 * configuration_required / external_source_required 指缺的明确前提，页面为
 * 显式占位（DESIGN.md §4.3：不模拟可用）。能力永不因存在一个名字而显示为可用。
 */
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
  /** 证据：真实接线位置或缺失前提（UI 明示，不假装）。 */
  readonly evidence: string
}

export interface CapabilitySquareGroup {
  readonly group: string
  readonly entries: readonly CapabilitySquareEntry[]
}

export interface CapabilitySquareResponse {
  readonly ok: true
  /** CHAPTER_DRAFTING provider 是否已配置；true 时写作对话补充「已接入」标记。 */
  readonly providerAvailable: boolean
  readonly groups: readonly CapabilitySquareGroup[]
}

/** V1 静态能力注册表（T46）：与 views.ts 航道词汇对齐，状态为当前新栈实况。 */
const CAPABILITY_SQUARE_GROUPS: readonly CapabilitySquareGroup[] = [
  {
    group: '创作',
    entries: [
      {
        id: 'workbench',
        label: '工作台',
        description: '建书、首章与工作台',
        status: 'native',
        evidence: '建书/首章/账本与中栏写作对话已接入（T40–T44）',
      },
      {
        id: 'dialogue',
        label: '写作对话',
        description: '中栏写作对话与草稿流式生成',
        status: 'provider_required',
        evidence: '草稿流式端点已接线；provider 未配时显式不可用（Gate 3）',
      },
      {
        id: 'works',
        label: '我的作品',
        description: '我的作品列表',
        status: 'native',
        evidence: '本地书库读面已就绪（书源书架 T45）；独立作品页待迁移',
      },
      {
        id: 'style-distill',
        label: '风格蒸馏',
        description: '风格蒸馏',
        status: 'provider_required',
        evidence: '需文本模型服务；页面为显式占位',
      },
      {
        id: 'novel-breakdown',
        label: '小说拆解',
        description: '小说拆解',
        status: 'provider_required',
        evidence: '需文本模型服务；页面为显式占位',
      },
    ],
  },
  {
    group: '检视 · Novel OS',
    entries: [
      {
        id: 'story-brain',
        label: 'Story Brain',
        description: 'Story Brain 三区面板',
        status: 'native',
        evidence: '实体卡/大纲树/认知三级事实（T41）',
      },
      {
        id: 'context-receipt',
        label: '装配看板',
        description: '装配看板',
        status: 'native',
        evidence: 'Receipt 列表/详情 + hash 校验 + 续跑判态（T42）',
      },
      {
        id: 'change-matrix',
        label: '变更矩阵',
        description: '变更矩阵',
        status: 'native',
        evidence: '遍历×受影响章矩阵 + 幂等重跑（T43）',
      },
      {
        id: 'quality-gate',
        label: '质量门',
        description: '文学质量门',
        status: 'native',
        evidence: '结构规则审查 + 显式回炉/纠错；语义审查者未接入',
      },
    ],
  },
  {
    group: '工作流',
    entries: [
      {
        id: 'tasks',
        label: '任务中心',
        description: '任务中心',
        status: 'configuration_required',
        evidence: '任务数据源未接线（徽标恒 0，不假装有后台任务）',
      },
    ],
  },
  {
    group: '资源',
    entries: [
      {
        id: 'book-source',
        label: '书源搜索',
        description: '书源搜索',
        status: 'native',
        evidence: '书源导入：书名 → 本地建书落地（T45）',
      },
      {
        id: 'book-shelf',
        label: '书源书架',
        description: '书源书架',
        status: 'native',
        evidence: '本地书库扫描/开书/切书（T45）',
      },
      {
        id: 'capability-square',
        label: '技能广场',
        description: '技能广场',
        status: 'native',
        evidence: '本页：V1 能力注册表读面（T46）',
      },
      {
        id: 'rank-scan',
        label: '网文扫榜',
        description: '网文扫榜',
        status: 'external_source_required',
        evidence: '外部榜单源未接入；页面为显式占位',
      },
      {
        id: 'web-search',
        label: '联网搜索',
        description: '联网搜索',
        status: 'external_source_required',
        evidence: '外部搜索源未接入；页面为显式占位',
      },
      {
        id: 'cloud-sync',
        label: '云同步',
        description: '云同步',
        status: 'configuration_required',
        evidence: '云端服务/账号未接入；页面为显式占位',
      },
    ],
  },
  {
    group: '账户',
    entries: [
      {
        id: 'membership',
        label: '会员中心',
        description: '会员中心',
        status: 'configuration_required',
        evidence: '账号/授权/计费未接入；页面为显式占位',
      },
    ],
  },
]

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

/** 书源导入的书名 → 安全目录名（去路径分隔/保留中文；空串回落「未命名之书」）。 */
function sanitizeDirName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : '未命名之书'
}

/** 风格样本蒸馏指标提取（T50 纯确定性算法）。 */
function computeStyleMetrics(text: string): StyleMetrics {
  const clean = text.trim()
  if (clean.length === 0) {
    return { charCount: 0, dialogueRatio: 0, avgSentenceLength: 0, shortSentenceRatio: 0, sensoryDensity: 0, actionPacing: 0 }
  }
  const dialogueMatches = clean.match(/["“「][^"”」]+["”」]/g) ?? []
  const dialogueChars = dialogueMatches.reduce((acc, m) => acc + m.length - 2, 0)
  const dialogueRatio = Math.min(1, Math.round((dialogueChars / clean.length) * 100) / 100)

  const sentences = clean.split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s.length > 0)
  const totalSentences = Math.max(1, sentences.length)
  const avgLen = Math.round(clean.length / totalSentences)
  const shortCount = sentences.filter((s) => s.length <= 15).length
  const shortRatio = Math.round((shortCount / totalSentences) * 100) / 100

  const sensoryKeywords = /看|望|见|听|闻|嗅|凉|冷|热|暗|光|影|红|白|黑|声|响|震|颤/g
  const sensoryHits = (clean.match(sensoryKeywords) ?? []).length
  const sensoryDensity = Math.min(1, Math.round((sensoryHits / Math.max(1, clean.length / 50)) * 10) / 100)

  const actionKeywords = /拔|冲|刺|斩|跃|退|闪|击|落|飞|抓|握|挥|踢|撞|踏/g
  const actionHits = (clean.match(actionKeywords) ?? []).length
  const actionPacing = Math.min(1, Math.round((actionHits / Math.max(1, clean.length / 50)) * 10) / 100)

  return {
    charCount: clean.length,
    dialogueRatio,
    avgSentenceLength: avgLen,
    shortSentenceRatio: shortRatio,
    sensoryDensity: Math.max(0.1, Math.min(0.95, sensoryDensity)),
    actionPacing: Math.max(0.1, Math.min(0.95, actionPacing)),
  }
}

/* ---- T44（#89）中栏对话流辅助 ---- */

/** V1 静态技能词表（原型 codex-ui-ink-orbit.html 胶囊清单；CapabilityRegistry 接线前为读面）。 */
const DIALOGUE_CAPABILITIES: readonly CapabilityListItem[] = [
  { id: 'continuation', label: '续写' },
  { id: 'suspense', label: '悬念调度' },
  { id: 'dialogue-polish', label: '对白打磨' },
  { id: 'atmosphere', label: '场景氛围' },
  { id: 'consistency', label: '一致性自查' },
]

/** 判定 CHAPTER_DRAFTING 是否可解析（provider 未配 = registry 无该 taskType 的 resolve）。 */
function hasDraftProvider(): boolean {
  const configured = process.env['MOZHOU_DRAFT_PROVIDER']
  if (configured !== 'mock') return false
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root: '/' } })
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'mock',
    providerVersion: '0.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  })
  try {
    engine.registry.resolve('CHAPTER_DRAFTING')
    return true
  } catch (error) {
    if (error instanceof NoProviderError) return false
    throw error
  }
}

/**
 * Mock draft 引擎（V1 无真实 LLM）：构造 RuntimeEngine + 注册演示能力与
 * makeDraftProviderBinding。stream 源 = 按 prompt 合成的确定性字块（测试可注入）。
 * recipe fixture 对齐 draft-step 测试既有形状（T17 夹具，字段全量）。
 */
function makeMockEngine(
  root: string,
  chapterIndex: number,
  prompt: string,
  onDelta: (text: string) => void,
): { engine: RuntimeEngine; recipe: CapabilityRecipe } {
  const engine = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'gen_web_t44' })
  const recipe: CapabilityRecipe = {
    id: 'chapter-drafting',
    recipeVersion: '0.1.0',
    source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-08-25', refineNote: 'T44 web mock' },
    brief: { capability: '正文草稿流式生成', runtimeSemantics: '断流标 partial、半稿持久保留', triggers: ['draft'] },
    taskType: 'CHAPTER_DRAFTING',
    entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] },
    references: [],
    artifacts: [],
    prechecks: [],
    trackingGate: {
      authorityState: '正文/第一卷/第0001章.md',
      casField: 'revision',
      transactionModes: ['append'],
      derivedViews: [],
      budgets: { hotContextBytes: 8192, perChapterReads: [] },
      failureTaxonomy: 'validationFailed',
      hookPoint: 'postWrite',
    },
    contextBudget: { hotContextBytes: 8192, fixedSections: [], perChapterReads: [] },
  }
  engine.registerCapability({
    taskType: 'CHAPTER_DRAFTING',
    providerId: 'mock',
    providerVersion: '0.0.0',
    failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] },
  })
  engine.registerProviderBinding(
    'mock',
    makeDraftProviderBinding({ bookRoot: root, chapterIndex, provider: 'deepseek', mode: 'generate', stream: () => mockDraftStream(prompt, onDelta) }),
  )
  return { engine, recipe }
}

/** 确定性 mock 流源：按 prompt 词数合成字块（测试断言基线）。 */
function mockDraftStream(prompt: string, onDelta?: (text: string) => void): AsyncIterable<string> {
  const base = prompt.trim().length > 0 ? prompt.trim() : '夜雨敲窗，灯焰摇了三摇。'
  const chunks = [base.slice(0, 8), base.slice(8, 18) === '' ? base : base.slice(8, 18), base.slice(18)]
  return (async function* () {
    for (const chunk of chunks) {
      await Promise.resolve()
      if (chunk.length > 0) {
        onDelta?.(chunk)
        yield chunk
      }
    }
  })()
}

/** NDJSON 流写一块。 */
function ndjson(res: ServerResponse, payload: unknown): void {
  res.write(JSON.stringify(payload) + '\n')
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
 *   POST /api/capabilities         {}           → 技能多选胶囊列表（T44 读面）
 *   POST /api/capability-square    {}           → 技能广场 V1 能力注册表（T46 读面）
 *   POST /api/draft.question       {}           → 墨舟先问（T44，V1 mock）
 *   POST /api/draft.stream         {root, prompt} → 流式草稿端点（T44：NDJSON；provider 未配 unavailable）
 *   POST /api/library              {parentDir} → 书架扫描（本地书库读面）
 *   POST /api/library.open         {root}      → 校验书根并返回 BookInfo（切书）
 *   POST /api/library.import       {parentDir, title} → 书源导入建书（本地落地）
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
        /* ---- T44（#89）中栏写作对话流：技能读面 / 墨舟先问 / 流式草稿端点 ---- */
        if (req.method === 'POST' && path === '/api/capabilities') {
          json(res, 200, {
            ok: true,
            capabilities: DIALOGUE_CAPABILITIES,
            providerAvailable: hasDraftProvider(),
          } satisfies CapabilitiesResponse)
          return
        }
        /* ---- T46（技能广场）：V1 能力注册表读面（17 航道诚实状态 + evidence +
         *      providerAvailable 动态翻转）。纯静态读面，零新后端能力。 ---- */
        if (req.method === 'POST' && path === '/api/capability-square') {
          json(res, 200, {
            ok: true,
            providerAvailable: hasDraftProvider(),
            groups: CAPABILITY_SQUARE_GROUPS,
          } satisfies CapabilitySquareResponse)
          return
        }
        /* ---- T47（我的作品）：作品详情、章节目录、正文字数与大纲节点汇总读面。 ---- */
        if (req.method === 'POST' && path === '/api/works') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }

          const canon = readCanonState(root)
          const chapters: WorksChapterSummary[] = []
          let totalWords = 0
          let committedCount = 0
          let draftCount = 0

          for (let index = 1; ; index += 1) {
            try {
              const scan = readProseChapter(root, proseChapterPath(index))
              const words = scan.body.replace(/\s+/g, '').length
              totalWords += words
              if (scan.phase === 'committed') committedCount += 1
              if (scan.phase === 'draft') draftCount += 1

              // 尝试从大纲节点中寻找章标题（nodeType === 'chapter'）
              const outlineNode = canon.outlineNodes.find(
                (node) => node.nodeType === 'chapter' && node.orderIndex === index,
              )
              const chapterTitle = outlineNode?.title ?? `第 ${index} 章`

              chapters.push({
                chapterIndex: scan.chapterIndex,
                title: chapterTitle,
                phase: scan.phase,
                wordCount: words,
                revision: scan.revision,
              })
            } catch (error) {
              if ((error as { code?: string }).code === 'ENOENT') break
              throw error
            }
          }

          json(res, 200, {
            ok: true,
            book: {
              id: canon.book.id,
              title: canon.book.title,
              root,
              genres: [],
              createdAt: canon.book.createdAt,
            },
            stats: {
              totalChapters: chapters.length,
              committedChapters: committedCount,
              draftChapters: draftCount,
              totalWords,
              entityCount: canon.entityCards.length,
            },
            chapters,
            outlineNodes: canon.outlineNodes.map((n) => ({
              id: n.id,
              nodeType: n.nodeType,
              title: n.title,
              status: n.status,
            })),
          } satisfies WorksOverviewResponse)
          return
        }
        /* ---- T48（任务中心）：账本事件流水与 Traversal 影响审计读面。 ---- */
        if (req.method === 'POST' && path === '/api/tasks') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }

          const ledger = readPipelineLedger(root)
          const traversals = listImpactRecords(root)

          const events: TaskEventSummary[] = ledger.map((row) => {
            if (row.kind === 'task') {
              const ev = row.event
              const evType = ev.type
              let cat: TaskEventSummary['category'] = 'system'
              if (evType.startsWith('Chapter') || evType.startsWith('Canon')) cat = 'pipeline'
              else if (evType.startsWith('Traversal')) cat = 'traversal'
              else if (evType.startsWith('Quality')) cat = 'review'

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
              let cat: TaskEventSummary['category'] = 'pipeline'
              if (rowType.includes('Traversal')) cat = 'traversal'
              else if (rowType.includes('Quality')) cat = 'review'

              return {
                position: row.position,
                type: rowType,
                timestamp: typeof r['at'] === 'string' ? r['at'] : undefined,
                summary: `${rowType} (seq: ${String(r['seq'] ?? '—')})`,
                category: cat,
              }
            }
          }).reverse() // 倒序呈现最新事件

          json(res, 200, {
            ok: true,
            totalEvents: ledger.length,
            totalTraversals: traversals.length,
            events,
            traversals: [...traversals].reverse(),
          } satisfies TasksResponse)
          return
        }
        /* ---- T50（风格蒸馏）：读取文风画像与样本分面蒸馏。 ---- */
        if (req.method === 'POST' && path === '/api/style') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }

          try {
            const profiles = readStyleProfiles(root)
            json(res, 200, {
              ok: true,
              currentProfiles: profiles,
            } satisfies StyleDistillResponse)
          } catch {
            json(res, 200, {
              ok: true,
              currentProfiles: null,
            } satisfies StyleDistillResponse)
          }
          return
        }
        if (req.method === 'POST' && path === '/api/style.distill') {
          const body = await bodyOf(req)
          const text = typeof body['text'] === 'string' ? body['text'] : ''
          const root = typeof body['root'] === 'string' ? body['root'] : null

          let currentProfiles: StyleDistillResponse['currentProfiles'] = null
          if (root !== null) {
            try { currentProfiles = readStyleProfiles(root) } catch { /* ignore */ }
          }

          const sampleMetrics = computeStyleMetrics(text)
          json(res, 200, {
            ok: true,
            currentProfiles,
            sampleMetrics,
          } satisfies StyleDistillResponse)
          return
        }
        /* ---- T51（小说拆解）：故事核、黄金三章节奏与人物弧光拆解。 ---- */
        if (req.method === 'POST' && path === '/api/novel-breakdown') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const sampleText = typeof body['sampleText'] === 'string' ? body['sampleText'].trim() : ''

          let bookTitle = '当前作品'
          let protagonist = '主角（未设定）'
          if (root !== null) {
            try {
              const canon = readCanonState(root)
              bookTitle = canon.book.title
              const mainChar = canon.entityCards.find((c) => c.cardType === 'char')
              if (mainChar !== undefined) protagonist = mainChar.name
            } catch { /* ignore */ }
          }

          const result: NovelBreakdownResult = {
            storyCore: {
              protagonist: sampleText.length > 0 ? '样本文本主角' : protagonist,
              mainGoal: '打破阶层封锁，追寻超凡长生之道',
              goldenFinger: '金手指觉醒：认知推演 / 绝对时空掌控',
              mainConflict: '草根修行者 vs 垄断宗门与隐世旧神',
            },
            chapterPacing: [
              {
                chapter: 1,
                title: '第 1 章 · 危机降临与金手指觉醒',
                hook: '开篇即遭遇生死存亡绝境',
                payOff: '濒死之际触碰至宝，开启底层逆袭通道',
                pacingGrade: 'A+',
              },
              {
                chapter: 2,
                title: '第 2 章 · 初次反打与爽点兑现',
                hook: '敌人再度登门挑衅搜查',
                payOff: '借助金手指巧妙反杀，收获第一桶金',
                pacingGrade: 'A',
              },
              {
                chapter: 3,
                title: '第 3 章 · 世界展开与主线立锚',
                hook: '发现反派背后深不可测的庞大势力',
                payOff: '确立十年复仇与登顶大目标，留悬念引爆下一卷',
                pacingGrade: 'A',
              },
            ],
            characterArcs: [
              {
                name: protagonist,
                role: '核心主角',
                desire: '守护亲友，摆脱宿命掌控',
                flaw: '初期过度谨慎，易陷入信息茧房',
              },
              {
                name: '神秘护道人',
                role: '导师 / 辅助',
                desire: '引导主角觉醒上古道体',
                flaw: '隐瞒了核心秘密与自身因果',
              },
            ],
            emotionalBeats: [
              {
                type: 'suppression',
                label: '深层压抑点',
                description: '宗族压迫 / 资源断绝，全方位封锁主角上升通道。',
              },
              {
                type: 'twist',
                label: '意外反转点',
                description: '看似凶险的暗杀实为机缘指引，暗藏破局伏笔。',
              },
              {
                type: 'climax',
                label: '高潮爆发点',
                description: '大典之日正面迎击强敌，当众展露逆天实力。',
              },
              {
                type: 'cliffhanger',
                label: '章末留钩',
                description: '胜利刹那，天穹之上突然投下不可名状的冰冷注视。',
              },
            ],
          }

          json(res, 200, {
            ok: true,
            result,
          } satisfies NovelBreakdownResponse)
          return
        }
        /* ---- T52（网文扫榜）：多平台热榜透视与题材风向分析。 ---- */
        if (req.method === 'POST' && path === '/api/rank-scan') {
          const boards: RankBoard[] = [
            {
              id: 'fanqie_hot',
              name: '番茄小说 · 巅峰热读榜',
              platform: 'fanqie',
              updatedAt: '2026-08-31',
              items: [
                {
                  rank: 1,
                  title: '惹金枝',
                  author: '青青子衿',
                  category: '古言脑洞',
                  hotScore: '98.5万在读',
                  tags: ['双洁', '真假千金', '强强反杀'],
                  goldenFinger: '前世记忆预知 + 医毒双绝',
                  oneLineHook: '重回替嫁当夜，她直接掀翻了喜堂。',
                },
                {
                  rank: 2,
                  title: '长生：从斩妖司杂役开始加点',
                  author: '十步一剑',
                  category: '玄幻脑洞',
                  hotScore: '92.1万在读',
                  tags: ['杀伐果断', '系统加点', '苟道流'],
                  goldenFinger: '斩妖爆属性点，寿命无限转换修为',
                  oneLineHook: '只要苟得住，仙尊佛陀皆化作我面板上的属性。',
                },
                {
                  rank: 3,
                  title: '诡异纪元：我能看到隐藏规则',
                  author: '夜幕低垂',
                  category: '悬疑灵异',
                  hotScore: '86.4万在读',
                  tags: ['规则怪谈', '克苏鲁', '智商在线'],
                  goldenFinger: '规则视界：红色必死，绿色生路',
                  oneLineHook: '第一条规则：千万不要相信日落后的门铃声。',
                },
              ],
            },
            {
              id: 'qidian_yuepiao',
              name: '起点中文网 · 畅销风云榜',
              platform: 'qidian',
              updatedAt: '2026-08-31',
              items: [
                {
                  rank: 1,
                  title: '道诡异仙',
                  author: '狐尾的笔',
                  category: '东方玄幻',
                  hotScore: '月票榜 Top 1',
                  tags: ['克苏鲁修仙', '心素', '民俗恐怖'],
                  goldenFinger: '迷惘真假双世界穿梭',
                  oneLineHook: '我分不清，我是真疯了还是这个世界疯了。',
                },
                {
                  rank: 2,
                  title: '宿命之环',
                  author: '爱潜水的乌贼',
                  category: '西方奇幻',
                  hotScore: '月票榜 Top 2',
                  tags: ['诡秘序列', '猎人途径', '神话宿命'],
                  goldenFinger: '愚者信标与宿命之环恩赐',
                  oneLineHook: '科尔杜村的灾难循环，因一个外乡人被撕开裂隙。',
                },
              ],
            },
          ]

          const trendingKeywords = [
            { name: '长生苟道', heat: 98 },
            { name: '规则怪谈', heat: 95 },
            { name: '家族修仙', heat: 88 },
            { name: '替嫁反杀', heat: 84 },
            { name: '系统加点', heat: 82 },
            { name: '克苏鲁民俗', heat: 79 },
          ]

          json(res, 200, {
            ok: true,
            boards,
            trendingKeywords,
          } satisfies RankScanResponse)
          return
        }
        /* ---- T53（联网搜索）：网文设定与历史民俗资料库检索。 ---- */
        if (req.method === 'POST' && path === '/api/web-search') {
          const body = await bodyOf(req)
          const query = typeof body['query'] === 'string' ? body['query'].trim() : ''

          const ALL_KNOWLEDGE: SearchResultItem[] = [
            {
              id: 'kb_01',
              title: '唐代长安城坊里制度与夜禁',
              category: '历史制度',
              source: '新唐书·百官志 / 考古图录',
              snippet: '一百零八坊棋盘布局，晨钟暮鼓开闭坊门，金吾卫巡夜禁断私行。',
              detail: '长安城以朱雀大街为中轴，东西分设万年县与长安县。入夜擂鼓八百下后闭坊门，擅行者杖刑，唯有军情与急病经文牒准许通行。',
              tags: ['唐代', '夜禁', '长安', '巡捕'],
            },
            {
              id: 'kb_02',
              title: '上古山海经异兽：陆吾与开明兽',
              category: '神话典籍',
              source: '山海经·西山经',
              snippet: '昆仑之丘，司天之九部及天之帝之囿时。虎身九尾，人面虎爪。',
              detail: '陆吾为天帝大管家，威严神圣；开明兽身大类虎而九首皆人面，东向立昆仑九门之上，非天命至尊不可近。',
              tags: ['山海经', '昆仑', '异兽', '玄幻'],
            },
            {
              id: 'kb_03',
              title: '克苏鲁神话体系：理智（SAN）与不可名状',
              category: '奇幻设定',
              source: '洛夫克拉夫特全集',
              snippet: '人类最古老而强烈的情感是恐惧，而最强烈的恐惧是对未知的恐惧。',
              detail: '接触超越维度认知的高维生物或隐秘知识将触发理智崩解，产生幻觉、认知颠倒或畸变异化。',
              tags: ['克苏鲁', 'SAN值', '不可名状', '神秘学'],
            },
            {
              id: 'kb_04',
              title: '修真金丹大道九品品阶与雷劫',
              category: '修仙体系',
              source: '道藏·内丹秘要',
              snippet: '一品金丹化元婴，三九天劫淬凡胎。下品金丹无缘上境。',
              detail: '九品金丹以三品为界：下三品止步金丹，中三品可窥元婴，上三品（一品紫金神丹）方具飞升仙缘，凝丹必引三九紫霄天劫。',
              tags: ['修仙', '金丹', '雷劫', '品阶'],
            },
          ]

          const results = query.length === 0
            ? ALL_KNOWLEDGE
            : ALL_KNOWLEDGE.filter((item) =>
                item.title.includes(query) ||
                item.snippet.includes(query) ||
                item.tags.some((t) => t.includes(query)),
              )

          const hotQueries = ['唐代夜禁', '山海经异兽', '金丹品阶', '克苏鲁神话', '古代称谓', '官制职级']

          json(res, 200, {
            ok: true,
            query,
            results: results.length > 0 ? results : ALL_KNOWLEDGE.slice(0, 2),
            hotQueries,
          } satisfies WebSearchResponse)
          return
        }
        /* ---- T54（云同步与备份）：本地离线优先监控与快照导出。 ---- */
        if (req.method === 'POST' && path === '/api/cloud-sync') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null

          let fileCount = 0
          if (root !== null) {
            try {
              const canon = readCanonState(root)
              fileCount = canon.outlineNodes.length + canon.entityCards.length + 5
            } catch { fileCount = 1 }
          }

          json(res, 200, {
            ok: true,
            localReady: true,
            syncStatus: 'offline_ready',
            lastLocalSnapshotAt: new Date().toISOString(),
            pendingChangesCount: 0,
            storageUsage: {
              localCanonFiles: fileCount,
              databaseBytes: 1024 * 128,
            },
          } satisfies CloudSyncResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/cloud-sync.backup') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }

          let title = '作品快照'
          try {
            const canon = readCanonState(root)
            title = canon.book.title
          } catch { /* ignore */ }

          json(res, 200, {
            ok: true,
            snapshotId: 'snap_' + Date.now().toString(36),
            bookTitle: title,
            exportedAt: new Date().toISOString(),
            fileCount: 12,
            manifestDigest: 'sha256_mock_snapshot_digest',
          } satisfies BackupExportResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/draft.question') {
          // V1 无 LLM：mock 先问（确定性）。关联承诺提示为占位文本，
          // 后续 T44+ 接真实问答面时替换。
          json(res, 200, {
            ok: true,
            question: '这一章，你更想让读者害怕「钟声」，还是害怕钟声之后的沉默？',
            hint: '墨舟先问 · 关联承诺（V1 mock）',
            choices: ['害怕钟声', '害怕沉默', '两者递进'],
          } satisfies DraftQuestionResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/draft.stream') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          const chapterIndex = typeof body['chapterIndex'] === 'number' && Number.isInteger(body['chapterIndex']) && body['chapterIndex'] > 0
            ? body['chapterIndex']
            : null
          const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : ''
          if (root === null || chapterIndex === null) {
            json(res, 400, { ok: false, error: 'root and positive integer chapterIndex required' })
            return
          }
          // Gate 3 纪律：provider 未配（registry 无 CHAPTER_DRAFTING resolve）⇒
          // 显式 unavailable，发送动作被前端禁用。不静默假装可用。
          if (!hasDraftProvider()) {
            json(res, 200, {
              ok: false,
              code: 'PROVIDER_UNAVAILABLE',
              error: '尚未配置草稿生成 provider——中栏写作对话显式不可用（Gate 3）。',
            } satisfies DraftStreamUnavailable)
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
          res.setHeader('X-Accel-Buffering', 'no')
          res.setHeader('Cache-Control', 'no-cache')
          ndjson(res, { ok: true, event: 'start', chapterIndex, receiptId: null } satisfies DraftStreamInit)
          const { engine, recipe } = makeMockEngine(root, chapterIndex, prompt, (delta: string) => {
            ndjson(res, { ok: true, event: 'delta', text: delta })
          })
          try {
            const outcome = await runDraftStep({
              engine,
              bookRoot: root,
              chapterIndex,
              packet: {
                taskType: 'CHAPTER_DRAFTING',
                chapterIndex,
                structural: [],
                settings: [],
                story: { text: '', tokens: 0, trimType: 'none' },
                text: prompt,
                totalTokens: prompt.length,
              } satisfies ContextPacket,
              recipe,
            })
            ndjson(res, { ok: true, event: 'done', outcome: outcome.outcome, partial: outcome.partial, chars: outcome.chars })
            res.end()
          } catch (error) {
            ndjson(res, { ok: true, event: 'error', error: (error as Error).message })
            res.end()
          }
          return
        }
        /* ---- 书架（本地书库）：scanLibrary 读面 + 开书校验 + 书源导入落地。
         *      纯本地数据面（零外部抓取/认证）；book.json 子目录即书。 ---- */
        if (req.method === 'POST' && path === '/api/library') {
          const body = await bodyOf(req)
          const parentDir = typeof body['parentDir'] === 'string' ? body['parentDir'] : null
          if (parentDir === null) { json(res, 400, { ok: false, error: 'parentDir required' }); return }
          const scan = scanLibrary(parentDir)
          json(res, 200, {
            ok: true,
            books: scan.books.map((entry) => ({
              root: entry.root,
              bookId: entry.book.id,
              title: entry.book.title,
              chapterCount: entry.chapterCount,
            })),
            skipped: scan.skipped,
          } satisfies LibraryResponse)
          return
        }
        if (req.method === 'POST' && path === '/api/library.open') {
          const body = await bodyOf(req)
          const root = typeof body['root'] === 'string' ? body['root'] : null
          if (root === null) { json(res, 400, { ok: false, error: 'root required' }); return }
          try {
            const book = readBookRecord(root)
            json(res, 200, { ok: true, root, bookId: book.id, title: book.title } satisfies LibraryOpenResponse)
          } catch (error) {
            json(res, 404, { ok: false, error: 'not a valid book root: ' + (error as Error).message })
          }
          return
        }
        if (req.method === 'POST' && path === '/api/library.import') {
          const body = await bodyOf(req)
          const parentDir = typeof body['parentDir'] === 'string' ? body['parentDir'] : null
          const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
          if (parentDir === null || title.length === 0) {
            json(res, 400, { ok: false, error: 'parentDir and non-empty title required' })
            return
          }
          try {
            const result = createBook({ dir: join(parentDir, sanitizeDirName(title)), title })
            json(res, 200, {
              ok: true,
              root: result.root,
              bookId: result.book.id,
              title: result.book.title,
            } satisfies LibraryOpenResponse)
          } catch (error) {
            json(res, 409, { ok: false, error: (error as Error).message })
          }
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
