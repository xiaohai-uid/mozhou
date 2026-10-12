/**
 * 导入落地（P1-apply · 迁移合同 §3.1）。
 *
 * 写回既有入口：`saveWorkbenchState / saveDraftCache / saveDraftBaseline /
 * saveCandidateCache / saveEditorProjection`，键纪律沿用 `chapterDraftKey /
 * candidateDraftKey` 的 `bookId || root` 身份。
 *
 * 隔离与安全（合同硬约束）：
 * - `matched` → 写回既有槽位；
 * - `conflict` / `unclaimed` → 写**独立隔离槽**（`mozhou.migration.quarantine.v1.<digest>.*`），
 *   不覆盖任何原有槽位；键含包摘要，不同包的同槽条目互不覆盖（保留双份）；
 * - 每次写入都**回读确认**；只有确认成功才把该章的幂等键记入「已迁移」登记表；
 * - 判为 matched 但**无内容可写**（章条目全空）的条目计入 `noop`，**不计入 written、不登记幂等键**——
 *   报告必须与实际写入一致；
 * - 本模块**从不删除任何键**（源端与目标槽都不删，失败不清空源端），失败条目保留在计划里可重试。
 *
 * 基线保真：`saveDraftBaseline(text)` 会把基线写成 `sha256(text)`。当包内基线与
 * `sha256(draft.text)` 不一致（未保存编辑）时，改走原样写入基线键，避免把「有未保存改动」
 * 误标成「已保存」。
 *
 * E01 补强（合同 §3.1「应用时重查 / 逐项幂等 / 可恢复提交」）：
 * - **应用时重查**：调用方给出 `recheck` 时，每条 matched 在落盘前按**当前**本地与服务端现场
 *   重跑冲突判定；判定为冲突则改落隔离槽（保留双份），**不覆盖**。计划里的旧 verdict 只是
 *   预览结论，不能作为写入许可——作者在预览后继续写作，旧计划不得盖掉新稿。
 * - **逐项幂等**：每个实际写入前重新读一次「已迁移」登记表，而不是只在开头读一次。
 * - **可恢复提交**：写槽之前先落一条恢复日志（各槽原值）。写入成功即删除该日志；任一步失败
 *   则日志保留，报告 `partial` 与 `recoverable`，作者可据此 `restoreFromJournal` 回滚原件。
 *   绝不出现「写入 0、部分数据已经变了」而无恢复指引。
 */
import {
  candidateDraftKey,
  chapterDraftKey,
  loadCandidateCache,
  loadDraftCache,
  loadEditorProjection,
  loadWorkbenchState,
  saveCandidateCache,
  saveDraftBaseline,
  saveDraftCache,
  saveEditorProjection,
  saveWorkbenchState,
} from '../shell/workbenchStorage'
import { syncSha256Hex } from '../workbench/lib/sha256'
import { canonicalStringify } from './packageFormat'
import { decideConflict } from './importPlan'
import type { ImportPlan, ImportPlanItem, LocalChapterSnapshot, ServerChapterSnapshot } from './importPlan'
import type { BookIdentity, MigrationChapterEntry, MigrationUnclaimedEntry } from './packageFormat'
import type { EditorBlock } from '../workbench/editor/customNodes'

/** 已迁移登记表（按包摘要分组，记录已确认写入的幂等键）。 */
export const APPLIED_REGISTRY_KEY = 'mozhou.migration.applied.v1'
/** 隔离槽前缀（冲突与待认领内容；不覆盖任何原槽）。 */
export const QUARANTINE_PREFIX = 'mozhou.migration.quarantine.v1.'
/** 恢复日志前缀（写入前记原值；成功即删，失败保留供回滚）。 */
export const JOURNAL_PREFIX = 'mozhou.migration.journal.v1.'

/**
 * 与 workbenchStorage 的私有常量同源（§1.4 冻结）。回滚必须写**原始值**——例如基线是
 * `sha256(text)`，用 `saveDraftBaseline` 回滚会按当前文本重算，改不回原哈希。故这里按前缀
 * 直接读写；`applyImport.recheck.test.ts` 有前缀漂移检查断言这些常量与访问器写入的键一致。
 */
const DRAFT_CACHE_STORAGE_PREFIX = 'mozhou.draft.cache.'
const DRAFT_BASELINE_STORAGE_PREFIX = 'mozhou.draft.baseline.'
const CANDIDATE_STORAGE_PREFIX = 'mozhou.candidate.cache.'
const EDITOR_PROJECTION_STORAGE_PREFIX = 'mozhou.editor.projection.'

export interface AppliedPackageRecord {
  readonly appliedAt: string
  readonly keys: readonly string[]
}

export type AppliedRegistry = Readonly<Record<string, AppliedPackageRecord>>

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // 删除失败不影响本次结果（最坏是留一条可回滚的日志）
  }
}

/** 读取已迁移登记表（损坏/缺失 → 空表，不抛异常）。 */
export function readAppliedRegistry(): AppliedRegistry {
  const raw = safeGet(APPLIED_REGISTRY_KEY)
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const registry: Record<string, AppliedPackageRecord> = {}
    for (const [digest, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const { appliedAt, keys } = value as { appliedAt?: unknown; keys?: unknown }
      if (typeof appliedAt !== 'string' || !Array.isArray(keys)) continue
      registry[digest] = { appliedAt, keys: keys.filter((k): k is string => typeof k === 'string') }
    }
    return registry
  } catch {
    return {}
  }
}

/** 扁平化已应用的幂等键（供 buildImportPlan 的 appliedKeys）。 */
export function readAppliedKeys(): string[] {
  return Object.values(readAppliedRegistry()).flatMap((record) => record.keys)
}

function persistRegistry(digest: string, record: AppliedPackageRecord): boolean {
  const registry = readAppliedRegistry()
  const next: Record<string, AppliedPackageRecord> = { ...registry, [digest]: record }
  if (!safeSet(APPLIED_REGISTRY_KEY, JSON.stringify(next))) return false
  const back = readAppliedRegistry()[digest]
  return back !== undefined && back.keys.length === record.keys.length
}

/** 逐项幂等：在**每个**实际写入前重新读登记表，而不是只信开头那一次快照。 */
function isKeyApplied(digest: string, idempotencyKey: string): boolean {
  const record = readAppliedRegistry()[digest]
  return record !== undefined && record.keys.includes(idempotencyKey)
}

export interface ApplyFailure {
  readonly idempotencyKey: string
  readonly error: string
}

/** 单条条目的实际归宿（报告必须与实际副作用一致，故逐条留痕）。 */
export type ApplyAction = 'written' | 'quarantined' | 'recheck-quarantined' | 'skipped' | 'noop' | 'failed'

export interface ApplyOutcome {
  readonly idempotencyKey: string
  readonly slotTag: string
  readonly action: ApplyAction
  readonly reason: string
}

/** 恢复日志条目：写入前各槽原值。失败保留，供 `restoreFromJournal` 回滚。 */
export interface ApplyJournalEntry {
  readonly digest: string
  readonly slotTag: string
  readonly idempotencyKey: string
  readonly identity: BookIdentity
  readonly chapterIndex: number
  readonly chapterKey: string
  readonly candidateKey: string
  /** 键 → 写入前原值（null = 原本不存在）。 */
  readonly prior: Readonly<Record<string, string | null>>
  readonly at: string
}

export interface ApplyResult {
  readonly ok: boolean
  /** 写回既有槽位并确认成功的章幂等键。 */
  readonly written: readonly string[]
  /** 写入隔离槽并确认成功的幂等键（冲突 / 待认领 / 应用时重查拦下）。 */
  readonly quarantined: readonly string[]
  /** 重复导入被幂等跳过的幂等键。 */
  readonly skipped: readonly string[]
  /** 判为 matched 但**无内容可写**（章条目全为空）的幂等键——未产生任何写入，不计入 written。 */
  readonly noop: readonly string[]
  readonly failed: readonly ApplyFailure[]
  /** 全部条目均已确认（无失败）时为 true。 */
  readonly markedMigrated: boolean
  /** 逐条归宿（含被应用时重查拦下的条目），供界面解释「到底发生了什么」。 */
  readonly outcomes: readonly ApplyOutcome[]
  /** 有写入失败且已有槽位被改动——报告不得只说「失败」。 */
  readonly partial: boolean
  /** 失败条目留下的恢复日志；作者可据此回滚到写入前状态。 */
  readonly recoverable: readonly ApplyJournalEntry[]
}

/** 应用时重查所需的现场读取器（本地槽位 + 服务端现状）。两者都必须给出，缺一不可判定。 */
export interface ApplyRecheck {
  readonly local: (identity: BookIdentity, chapterIndex: number) => LocalChapterSnapshot | null
  readonly server: (identity: BookIdentity, chapterIndex: number) => ServerChapterSnapshot | null
}

export interface ApplyOptions {
  /**
   * 应用时重查现场。给出时，每条 matched 在写入前用**当前**现场重跑冲突判定；
   * 判定为冲突即改落隔离槽。省略则只按计划里的 verdict 落地（调用方自担旧计划风险）。
   */
  readonly recheck?: ApplyRecheck
  /** 当前时间（可注入，便于断言）。 */
  readonly now?: () => string
}

function equalJson(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b)
}

interface WriteOutcome {
  readonly ok: true
  /** 是否真的写了至少一个键。全空章条目 → false（报告不得声称已写入）。 */
  readonly wrote: boolean
}

/** 写回单章既有槽位并回读确认。 */
function writeChapter(entry: MigrationChapterEntry, identity: ImportPlanItem['identity']): WriteOutcome | { ok: false; error: string } {
  const chKey = chapterDraftKey(identity, entry.chapterIndex)
  const candKey = candidateDraftKey(identity, entry.chapterIndex)
  if (chKey === null || candKey === null) {
    return { ok: false, error: '目标身份为空，拒绝写入无归属槽位' }
  }

  let wrote = false

  if (entry.draft !== null) {
    // 空草稿文本（包内只有基线、无草稿）：不写也**不删**——`saveDraftCache('')` 会
    // removeItem 目标槽，等于删掉壳内既有草稿（合同「不覆盖」）。基线另行保真写入。
    if (entry.draft.text !== '') {
      saveDraftCache(entry.draft.text, chKey)
      if (loadDraftCache(chKey) !== entry.draft.text) {
        return { ok: false, error: '草稿写入未确认（回读不一致）' }
      }
      wrote = true
    }
    const baseline = entry.draft.baselineSha256
    if (baseline !== null) {
      if (baseline === syncSha256Hex(entry.draft.text)) {
        saveDraftBaseline(entry.draft.text, chKey)
      } else {
        // 未保存编辑：基线原样保留，不得重算成 sha256(文本)。
        if (!safeSet(`${DRAFT_BASELINE_STORAGE_PREFIX}${chKey}`, baseline)) {
          return { ok: false, error: '基线写入失败' }
        }
      }
      if (safeGet(`${DRAFT_BASELINE_STORAGE_PREFIX}${chKey}`) !== baseline) {
        return { ok: false, error: '基线写入未确认（回读不一致）' }
      }
      wrote = true
    }
  }

  if (entry.candidate !== null) {
    saveCandidateCache(entry.candidate, candKey)
    const back = loadCandidateCache(candKey)
    if (back === null || !equalJson(back, entry.candidate)) {
      return { ok: false, error: '候选写入未确认（回读不一致）' }
    }
    wrote = true
  }

  if (entry.editorProjection !== null) {
    saveEditorProjection(entry.editorProjection.blocks as readonly EditorBlock[], chKey)
    const back = loadEditorProjection(chKey)
    // 既有写入口会重盖 savedAt（`saveEditorProjection` 用当前时间），故只校验 blocks 保真。
    if (back === null || !equalJson(back.blocks, entry.editorProjection.blocks)) {
      return { ok: false, error: '编辑器投影写入未确认（回读不一致）' }
    }
    wrote = true
  }

  return { ok: true, wrote }
}

/** 隔离槽键：**必须含包摘要与唯一 slotTag**。 */
function quarantineKeyFor(item: ImportPlanItem, digest: string): string {
  return `${QUARANTINE_PREFIX}${digest}.${item.slotTag}`
}

/** 把冲突 / 待认领条目写入隔离槽（不覆盖原槽）并回读确认。 */
function writeQuarantine(item: ImportPlanItem, digest: string): { ok: true } | { ok: false; error: string } {
  const key = quarantineKeyFor(item, digest)
  const record = {
    verdict: item.verdict,
    reason: item.reason,
    idempotencyKey: item.idempotencyKey,
    sourceDigest: digest,
    identity: item.identity,
    chapterIndex: item.chapterIndex,
    chapterKey: item.chapterKey,
    entry: item.entry,
    quarantinedAt: new Date().toISOString(),
  }
  if (!safeSet(key, JSON.stringify(record))) {
    return { ok: false, error: '隔离槽写入失败（localStorage 不可用或已满）' }
  }
  const back = safeGet(key)
  if (back === null) return { ok: false, error: '隔离槽写入未确认（回读为空）' }
  try {
    const parsed = JSON.parse(back) as { idempotencyKey?: unknown }
    if (parsed.idempotencyKey !== item.idempotencyKey) {
      return { ok: false, error: '隔离槽写入未确认（回读不一致）' }
    }
  } catch {
    return { ok: false, error: '隔离槽写入未确认（回读无法解析）' }
  }
  return { ok: true }
}

/** 目标作品尚未在 workbench 记录时登记之；已有作品选择不覆盖。 */
function ensureWorkbenchBook(plan: ImportPlan): void {
  if (plan.targetIdentity === null) return
  const state = loadWorkbenchState()
  if (state.book !== null) return
  saveWorkbenchState({
    book: { root: plan.targetIdentity.root, bookId: plan.targetIdentity.bookId, title: plan.targetIdentity.title },
    view: state.view,
  })
}

/** 包级待认领条目的幂等键（与章条目的键空间分离）。 */
export function unclaimedIdempotencyKey(digest: string, key: string): string {
  return `${digest}::unclaimed::${key}`
}

/**
 * 把包级待认领条目（导出时身份不明的白名单内容）写入隔离槽。
 * 不覆盖任何作品槽位；内容原样保留供人工认领。
 */
function writeUnclaimedQuarantine(
  entry: MigrationUnclaimedEntry,
  digest: string,
): { ok: true } | { ok: false; error: string } {
  const suffix = entry.identitySuffix ?? 'no-identity'
  const chapter = entry.chapterIndex === null ? 'na' : String(entry.chapterIndex)
  // 与章条目隔离槽同理：键含包摘要，避免跨包同槽覆盖。
  const key = `${QUARANTINE_PREFIX}${digest}.unclaimed.${suffix}.${chapter}.${entry.kind}`
  const record = {
    verdict: 'unclaimed',
    reason: entry.reason,
    idempotencyKey: unclaimedIdempotencyKey(digest, entry.key),
    sourceDigest: digest,
    identitySuffix: entry.identitySuffix,
    chapterIndex: entry.chapterIndex,
    kind: entry.kind,
    sourceKey: entry.key,
    raw: entry.raw,
    quarantinedAt: new Date().toISOString(),
  }
  if (!safeSet(key, JSON.stringify(record))) {
    return { ok: false, error: '待认领隔离槽写入失败（localStorage 不可用或已满）' }
  }
  const back = safeGet(key)
  if (back === null) return { ok: false, error: '待认领隔离槽写入未确认（回读为空）' }
  try {
    const parsed = JSON.parse(back) as { sourceKey?: unknown }
    if (parsed.sourceKey !== entry.key) {
      return { ok: false, error: '待认领隔离槽写入未确认（回读不一致）' }
    }
  } catch {
    return { ok: false, error: '待认领隔离槽写入未确认（回读无法解析）' }
  }
  return { ok: true }
}

/** 恢复日志键（与隔离槽同域，按包摘要 + slotTag 唯一）。 */
function journalKeyFor(digest: string, slotTag: string): string {
  return `${JOURNAL_PREFIX}${digest}.${slotTag}`
}

/** 写入前各槽的原值快照（保护原件；失败时据此回滚）。 */
function capturePrior(chapterKey: string, candidateKey: string): Record<string, string | null> {
  const draftKey = `${DRAFT_CACHE_STORAGE_PREFIX}${chapterKey}`
  const baselineKey = `${DRAFT_BASELINE_STORAGE_PREFIX}${chapterKey}`
  const candKey = `${CANDIDATE_STORAGE_PREFIX}${candidateKey}`
  const projectionKey = `${EDITOR_PROJECTION_STORAGE_PREFIX}${chapterKey}`
  return {
    [draftKey]: safeGet(draftKey),
    [baselineKey]: safeGet(baselineKey),
    [candKey]: safeGet(candKey),
    [projectionKey]: safeGet(projectionKey),
  }
}

/**
 * 失败的章节是否**已经改动了槽位**。`written` 只记「全部确认成功」的章，所以
 * 「部分槽位已改、后续步骤失败」的章不会进 `written`——那正是必须单独标 `partial`
 * 的情形，否则报告会变成「写入 0」而数据其实变了。
 */
function slotsModified(prior: Readonly<Record<string, string | null>>): boolean {
  for (const [key, value] of Object.entries(prior)) {
    if (safeGet(key) !== value) return true
  }
  return false
}

/** 读某包的恢复日志（失败条目会留在这里，供界面提示与回滚）。 */
export function readApplyJournal(digest: string): ApplyJournalEntry[] {
  const entries: ApplyJournalEntry[] = []
  let length = 0
  try {
    length = window.localStorage.length
  } catch {
    return entries
  }
  const prefix = `${JOURNAL_PREFIX}${digest}.`
  for (let i = 0; i < length; i += 1) {
    let key: string | null = null
    try {
      key = window.localStorage.key(i)
    } catch {
      continue
    }
    if (key === null || !key.startsWith(prefix)) continue
    const raw = safeGet(key)
    if (raw === null) continue
    try {
      const parsed = JSON.parse(raw) as ApplyJournalEntry
      if (typeof parsed?.slotTag === 'string' && typeof parsed?.prior === 'object' && parsed.prior !== null) {
        entries.push(parsed)
      }
    } catch {
      // 损坏日志忽略（不阻止导入）
    }
  }
  return entries
}

/** 按恢复日志把各槽写回写入前状态，并删除该日志。返回是否全部成功。 */
export function restoreFromJournal(entry: ApplyJournalEntry): boolean {
  let ok = true
  for (const [key, value] of Object.entries(entry.prior)) {
    if (value === null) {
      safeRemove(key)
      continue
    }
    if (!safeSet(key, value)) ok = false
  }
  if (ok) safeRemove(journalKeyFor(entry.digest, entry.slotTag))
  return ok
}

/** 落地一个导入计划；返回可审阅结果。失败条目保留，可重试。 */
export function applyImport(plan: ImportPlan, options: ApplyOptions = {}): ApplyResult {
  const { recheck } = options
  const now = options.now ?? (() => new Date().toISOString())
  const registry = readAppliedRegistry()
  const existing = registry[plan.digest]
  const appliedAt = existing?.appliedAt ?? now()
  const keys = new Set(existing?.keys ?? [])

  // 只有在本次确实要写入时才登记作品状态：全部 duplicate（重复导入）不得产生副作用。
  const willWrite =
    plan.items.some((item) => item.verdict !== 'duplicate') ||
    plan.unclaimed.some((entry) => !keys.has(unclaimedIdempotencyKey(plan.digest, entry.key)))
  if (willWrite) ensureWorkbenchBook(plan)

  const written: string[] = []
  const quarantined: string[] = []
  const skipped: string[] = []
  const noop: string[] = []
  const failed: ApplyFailure[] = []
  const outcomes: ApplyOutcome[] = []
  const recoverable: ApplyJournalEntry[] = []
  let modifiedSlots = false

  for (const item of plan.items) {
    if (item.verdict === 'duplicate') {
      skipped.push(item.idempotencyKey)
      outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'skipped', reason: item.reason })
      continue
    }
    // 逐项幂等：写之前重新读登记表（并发的第二次应用可能刚登记过同一个键）。
    if (isKeyApplied(plan.digest, item.idempotencyKey)) {
      skipped.push(item.idempotencyKey)
      outcomes.push({
        idempotencyKey: item.idempotencyKey,
        slotTag: item.slotTag,
        action: 'skipped',
        reason: 'already-applied-at-write（写入前重读登记表：该键已迁移）',
      })
      continue
    }
    if (item.verdict === 'conflict' || item.verdict === 'unclaimed') {
      const result = writeQuarantine(item, plan.digest)
      if (result.ok) {
        quarantined.push(item.idempotencyKey)
        keys.add(item.idempotencyKey)
        outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'quarantined', reason: item.reason })
      } else {
        failed.push({ idempotencyKey: item.idempotencyKey, error: result.error })
        outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'failed', reason: result.error })
      }
      continue
    }

    // 应用时重查（E01 合同）：旧计划不是写入许可。现场已变 → 改落隔离槽，保留双份。
    if (recheck !== undefined) {
      const conflict = decideConflict(
        item.entry,
        recheck.server(item.identity, item.chapterIndex),
        recheck.local(item.identity, item.chapterIndex),
      )
      if (conflict !== null) {
        const reason = `apply-time-recheck（应用时现场已变，改落隔离槽）：${conflict}`
        const result = writeQuarantine({ ...item, reason }, plan.digest)
        if (result.ok) {
          quarantined.push(item.idempotencyKey)
          keys.add(item.idempotencyKey)
          outcomes.push({
            idempotencyKey: item.idempotencyKey,
            slotTag: item.slotTag,
            action: 'recheck-quarantined',
            reason,
          })
        } else {
          failed.push({ idempotencyKey: item.idempotencyKey, error: result.error })
          outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'failed', reason: result.error })
        }
        continue
      }
    }

    const chKey = chapterDraftKey(item.identity, item.chapterIndex)
    const candKey = candidateDraftKey(item.identity, item.chapterIndex)
    if (chKey === null || candKey === null) {
      const error = '目标身份为空，拒绝写入无归属槽位'
      failed.push({ idempotencyKey: item.idempotencyKey, error })
      outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'failed', reason: error })
      continue
    }

    // 恢复日志先行：记不下原件就不动槽位（宁可不动，也不留下无指引的半成品）。
    const journal: ApplyJournalEntry = {
      digest: plan.digest,
      slotTag: item.slotTag,
      idempotencyKey: item.idempotencyKey,
      identity: item.identity,
      chapterIndex: item.chapterIndex,
      chapterKey: chKey,
      candidateKey: candKey,
      prior: capturePrior(chKey, candKey),
      at: now(),
    }
    if (!safeSet(journalKeyFor(plan.digest, item.slotTag), JSON.stringify(journal))) {
      const error = '恢复日志写入失败：已跳过该章写入（未改动任何槽位）'
      failed.push({ idempotencyKey: item.idempotencyKey, error })
      outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'failed', reason: error })
      continue
    }

    const result = writeChapter(item.entry, item.identity)
    if (!result.ok) {
      failed.push({ idempotencyKey: item.idempotencyKey, error: result.error })
      recoverable.push(journal)
      if (slotsModified(journal.prior)) modifiedSlots = true
      outcomes.push({
        idempotencyKey: item.idempotencyKey,
        slotTag: item.slotTag,
        action: 'failed',
        reason: `${result.error}（已留恢复日志，可回滚）`,
      })
      continue
    }
    // 成功即收口：删掉恢复日志（无失败则不需要回滚记录）。
    safeRemove(journalKeyFor(plan.digest, item.slotTag))
    if (result.wrote) {
      written.push(item.idempotencyKey)
      keys.add(item.idempotencyKey)
      outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'written', reason: '已写回既有槽位并回读确认' })
    } else {
      // matched 但无内容可写：不得声称已写入，也不登记幂等键（未应用任何东西）。
      noop.push(item.idempotencyKey)
      outcomes.push({ idempotencyKey: item.idempotencyKey, slotTag: item.slotTag, action: 'noop', reason: 'matched 但无内容可写（未产生写入）' })
    }
  }

  // 包级待认领条目：写入隔离槽（不分配给任何作品），同样幂等。
  for (const entry of plan.unclaimed) {
    const idempotencyKey = unclaimedIdempotencyKey(plan.digest, entry.key)
    if (keys.has(idempotencyKey)) {
      skipped.push(idempotencyKey)
      outcomes.push({ idempotencyKey, slotTag: `unclaimed.${entry.key}`, action: 'skipped', reason: 'already-applied（该待认领条目已迁移）' })
      continue
    }
    const result = writeUnclaimedQuarantine(entry, plan.digest)
    if (result.ok) {
      quarantined.push(idempotencyKey)
      keys.add(idempotencyKey)
      outcomes.push({ idempotencyKey, slotTag: `unclaimed.${entry.key}`, action: 'quarantined', reason: entry.reason })
    } else {
      failed.push({ idempotencyKey, error: result.error })
      outcomes.push({ idempotencyKey, slotTag: `unclaimed.${entry.key}`, action: 'failed', reason: result.error })
    }
  }

  const changed = written.length + quarantined.length > 0
  const registryConfirmed = changed ? persistRegistry(plan.digest, { appliedAt, keys: [...keys] }) : true

  return {
    ok: failed.length === 0 && registryConfirmed,
    written,
    quarantined,
    skipped,
    noop,
    failed,
    markedMigrated: failed.length === 0 && registryConfirmed,
    outcomes,
    // 「部分写入」= 有失败且槽位确实被改过。只看 written/quarantined 会漏掉
    // 「草稿已改、候选步骤失败」这种 written 为 0 但数据已变的情形。
    partial: failed.length > 0 && (modifiedSlots || changed),
    recoverable,
  }
}
