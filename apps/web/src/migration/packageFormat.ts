/**
 * 迁移包 v1 格式与纯函数校验器（P1-format · Electron 桌面壳迁移合同 §3.1）。
 *
 * 合同边界（不得在此扩张）：
 * - 只描述**数据形状**与**完整性**；SHA-256 摘要证明「内容未被改动」，
 *   **不证明来源认证**（谁导出的、是否可信，本模块不做也不假装做）。
 * - 不读 localStorage、不发请求、不依赖 React —— 导出/探针/导入计划各自负责副作用，
 *   本模块只提供类型、规范化摘要算法与显式拒绝结果。
 *
 * 身份语义：作品身份 = `bookId`（服务端 ULID，优先）+ `root`（路径兜底），
 * 与 `workbenchStorage.chapterDraftKey` 的 `bookId || root` 后缀纪律同源。
 */
import { syncSha256Hex } from '../workbench/lib/sha256'

/** 当前（也是唯一受支持）的迁移包格式版本。 */
export const MIGRATION_FORMAT_VERSION = 1

/** 来源 origin：记录导出发生的页面与时间；用于人工审阅，不参与信任判定。 */
export interface MigrationOrigin {
  readonly origin: string
  readonly userAgent: string
  readonly exportedAt: string
}

/** 作品身份。`bookId` 为空时以 `root` 作为身份后缀（与 chapterDraftKey 一致）。 */
export interface BookIdentity {
  readonly bookId: string
  readonly root: string
  readonly title: string
}

/** AI 候选所基于的服务端正文版本（合同要求原样保留）。 */
export interface CandidateBase {
  readonly revision: number
  readonly sha256: string
}

/** AI 候选写入模式（与 workbenchStorage.CandidateCache 的联合类型同源）。 */
export type CandidateMode = 'replace' | 'continue' | 'insert' | 'replace-selection'

/** AI 候选阶段（与 workbenchStorage.CandidateCache 的联合类型同源）。 */
export type CandidatePhase = 'draft_done' | 'drafting' | 'answered'

/** AI 候选缓存（恢复元数据：base.revision/base.sha256 必须保留）。 */
export interface MigrationCandidate {
  readonly candidateId: string
  readonly base: CandidateBase
  readonly mode: CandidateMode
  readonly draftText: string
  readonly phase: CandidatePhase
  readonly partial: boolean
}

/** 编辑器结构投影（`{savedAt, blocks}`；blocks 形状由编辑器定义，此处只做数组校验）。 */
export interface EditorProjectionRecord {
  readonly savedAt: string
  readonly blocks: readonly unknown[]
}

/** 章草稿 + 保存基线。基线缺失（旧缓存）时为 null —— 保守按未保存文字处理。 */
export interface ChapterDraftRecord {
  readonly text: string
  readonly baselineSha256: string | null
}

/** 一个章条目的全部可恢复内容。 */
export interface MigrationChapterEntry {
  readonly chapterIndex: number
  readonly chapterKey: string
  readonly draft: ChapterDraftRecord | null
  readonly candidate: MigrationCandidate | null
  readonly editorProjection: EditorProjectionRecord | null
}

/** 一个已解析身份的作品条目。 */
export interface MigrationBookEntry {
  readonly identity: BookIdentity
  readonly chapters: readonly MigrationChapterEntry[]
}

/** 待认领区条目的来源类型（白名单键种类）。 */
export type MigrationUnclaimedKind =
  | 'draft'
  | 'baseline'
  | 'candidate'
  | 'projection'
  | 'workbench'
  | 'preference'

/**
 * 待认领条目：身份不明或无法解析的白名单内容。**不分配给任何作品**，
 * 原样保留供人工认领（Author Sovereignty：不猜作品）。
 */
export interface MigrationUnclaimedEntry {
  readonly key: string
  readonly identitySuffix: string | null
  readonly chapterIndex: number | null
  readonly kind: MigrationUnclaimedKind
  readonly reason: string
  readonly raw: string
}

/** 迁移包 v1。`digest` = 对其余字段的规范化 JSON 取 SHA-256。 */
export interface MigrationPackageV1 {
  readonly formatVersion: number
  readonly origin: MigrationOrigin
  readonly books: readonly MigrationBookEntry[]
  readonly unclaimed: readonly MigrationUnclaimedEntry[]
  readonly preferences: Readonly<Record<string, string>>
  readonly digest: string
}

/** 迁移包去掉摘要后的可摘要载荷。 */
export type MigrationPackagePayload = Omit<MigrationPackageV1, 'digest'>

/** 拒绝码：对格式版本 / 身份缺字段 / 摘要不匹配给出显式、可分支的拒绝。 */
export type MigrationValidationCode =
  | 'NOT_OBJECT'
  | 'FORMAT_VERSION_UNSUPPORTED'
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'DIGEST_MISMATCH'

export interface MigrationValidationFailure {
  readonly ok: false
  readonly code: MigrationValidationCode
  readonly message: string
  /** 出问题的字段路径（如 `books[0].identity.bookId`）；无路径时为空串。 */
  readonly path: string
}

export interface MigrationValidationSuccess {
  readonly ok: true
  readonly value: MigrationPackageV1
}

export type MigrationValidationResult =
  | MigrationValidationSuccess
  | MigrationValidationFailure

/**
 * 规范化 JSON 序列化：对象键递归排序，保证同一逻辑内容得到同一字符串
 * （摘要跨实现可复算——浏览器控制台片段、本模块、Electron 导入侧三处一致）。
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']'
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts = keys.map((key) => JSON.stringify(key) + ':' + canonicalStringify(record[key]))
  return '{' + parts.join(',') + '}'
}

/** 计算包级内容摘要（对除 `digest` 外的全部字段）。 */
export function computePackageDigest(payload: MigrationPackagePayload): string {
  return syncSha256Hex(canonicalStringify(payload))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const CANDIDATE_MODES: readonly CandidateMode[] = ['replace', 'continue', 'insert', 'replace-selection']
const CANDIDATE_PHASES: readonly CandidatePhase[] = ['draft_done', 'drafting', 'answered']

function fail(
  code: MigrationValidationCode,
  path: string,
  message: string,
): MigrationValidationFailure {
  return { ok: false, code, message, path }
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): { ok: true; value: string } | MigrationValidationFailure {
  const raw = source[key]
  if (raw === undefined || raw === null) {
    return fail('MISSING_FIELD', path, `缺少字段 ${path}`)
  }
  if (typeof raw !== 'string') {
    return fail('INVALID_FIELD', path, `字段 ${path} 必须是字符串`)
  }
  return { ok: true, value: raw }
}

function requireInteger(
  source: Record<string, unknown>,
  key: string,
  path: string,
  min: number,
): { ok: true; value: number } | MigrationValidationFailure {
  const raw = source[key]
  if (raw === undefined || raw === null) {
    return fail('MISSING_FIELD', path, `缺少字段 ${path}`)
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min) {
    return fail('INVALID_FIELD', path, `字段 ${path} 必须是 ≥ ${min} 的整数`)
  }
  return { ok: true, value: raw }
}

function normalizeDraft(
  raw: unknown,
  path: string,
): { ok: true; value: ChapterDraftRecord | null } | MigrationValidationFailure {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象或 null`)
  const text = requireString(raw, 'text', `${path}.text`)
  if ('ok' in text && text.ok === false) return text
  const baselineRaw = raw['baselineSha256']
  let baselineSha256: string | null = null
  if (baselineRaw !== null && baselineRaw !== undefined) {
    if (typeof baselineRaw !== 'string') {
      return fail('INVALID_FIELD', `${path}.baselineSha256`, `${path}.baselineSha256 必须是字符串或 null`)
    }
    baselineSha256 = baselineRaw
  }
  return { ok: true, value: { text: (text as { value: string }).value, baselineSha256 } }
}

function normalizeCandidate(
  raw: unknown,
  path: string,
): { ok: true; value: MigrationCandidate | null } | MigrationValidationFailure {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象或 null`)
  const candidateId = requireString(raw, 'candidateId', `${path}.candidateId`)
  if ('ok' in candidateId && candidateId.ok === false) return candidateId
  const mode = requireString(raw, 'mode', `${path}.mode`)
  if ('ok' in mode && mode.ok === false) return mode
  const modeValue = (mode as { value: string }).value
  if (!CANDIDATE_MODES.includes(modeValue as CandidateMode)) {
    return fail('INVALID_FIELD', `${path}.mode`, `${path}.mode 不是已知候选写入模式`)
  }
  const draftText = requireString(raw, 'draftText', `${path}.draftText`)
  if ('ok' in draftText && draftText.ok === false) return draftText
  const phase = requireString(raw, 'phase', `${path}.phase`)
  if ('ok' in phase && phase.ok === false) return phase
  const phaseValue = (phase as { value: string }).value
  if (!CANDIDATE_PHASES.includes(phaseValue as CandidatePhase)) {
    return fail('INVALID_FIELD', `${path}.phase`, `${path}.phase 不是已知候选阶段`)
  }
  const baseRaw = raw['base']
  if (baseRaw === undefined || baseRaw === null) {
    return fail('MISSING_FIELD', `${path}.base`, `缺少字段 ${path}.base`)
  }
  if (!isRecord(baseRaw)) return fail('INVALID_FIELD', `${path}.base`, `${path}.base 必须是对象`)
  const revision = requireInteger(baseRaw, 'revision', `${path}.base.revision`, 0)
  if ('ok' in revision && revision.ok === false) return revision
  const sha256 = requireString(baseRaw, 'sha256', `${path}.base.sha256`)
  if ('ok' in sha256 && sha256.ok === false) return sha256
  const partialRaw = raw['partial']
  if (partialRaw !== undefined && partialRaw !== null && typeof partialRaw !== 'boolean') {
    return fail('INVALID_FIELD', `${path}.partial`, `${path}.partial 必须是布尔`)
  }
  return {
    ok: true,
    value: {
      candidateId: (candidateId as { value: string }).value,
      base: {
        revision: (revision as { value: number }).value,
        sha256: (sha256 as { value: string }).value,
      },
      mode: (mode as { value: CandidateMode }).value,
      draftText: (draftText as { value: string }).value,
      phase: (phase as { value: CandidatePhase }).value,
      partial: partialRaw === true,
    },
  }
}

function normalizeProjection(
  raw: unknown,
  path: string,
): { ok: true; value: EditorProjectionRecord | null } | MigrationValidationFailure {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象或 null`)
  const savedAt = requireString(raw, 'savedAt', `${path}.savedAt`)
  if ('ok' in savedAt && savedAt.ok === false) return savedAt
  const blocks = raw['blocks']
  if (blocks === undefined || blocks === null) {
    return fail('MISSING_FIELD', `${path}.blocks`, `缺少字段 ${path}.blocks`)
  }
  if (!Array.isArray(blocks)) return fail('INVALID_FIELD', `${path}.blocks`, `${path}.blocks 必须是数组`)
  return { ok: true, value: { savedAt: (savedAt as { value: string }).value, blocks: blocks as readonly unknown[] } }
}

function normalizeChapter(
  raw: unknown,
  path: string,
): { ok: true; value: MigrationChapterEntry } | MigrationValidationFailure {
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象`)
  const chapterIndex = requireInteger(raw, 'chapterIndex', `${path}.chapterIndex`, 1)
  if ('ok' in chapterIndex && chapterIndex.ok === false) return chapterIndex
  const chapterKey = requireString(raw, 'chapterKey', `${path}.chapterKey`)
  if ('ok' in chapterKey && chapterKey.ok === false) return chapterKey
  const draft = normalizeDraft(raw['draft'], `${path}.draft`)
  if ('ok' in draft && draft.ok === false) return draft
  const candidate = normalizeCandidate(raw['candidate'], `${path}.candidate`)
  if ('ok' in candidate && candidate.ok === false) return candidate
  const projection = normalizeProjection(raw['editorProjection'], `${path}.editorProjection`)
  if ('ok' in projection && projection.ok === false) return projection
  return {
    ok: true,
    value: {
      chapterIndex: (chapterIndex as { value: number }).value,
      chapterKey: (chapterKey as { value: string }).value,
      draft: (draft as { value: ChapterDraftRecord | null }).value,
      candidate: (candidate as { value: MigrationCandidate | null }).value,
      editorProjection: (projection as { value: EditorProjectionRecord | null }).value,
    },
  }
}

function normalizeIdentity(
  raw: unknown,
  path: string,
): { ok: true; value: BookIdentity } | MigrationValidationFailure {
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象`)
  const bookId = requireString(raw, 'bookId', `${path}.bookId`)
  if ('ok' in bookId && bookId.ok === false) return bookId
  const root = requireString(raw, 'root', `${path}.root`)
  if ('ok' in root && root.ok === false) return root
  const title = requireString(raw, 'title', `${path}.title`)
  if ('ok' in title && title.ok === false) return title
  const identity: BookIdentity = {
    bookId: (bookId as { value: string }).value,
    root: (root as { value: string }).value,
    title: (title as { value: string }).value,
  }
  if (identity.bookId.length === 0 && identity.root.length === 0) {
    return fail('MISSING_FIELD', path, `${path} 的 bookId 与 root 不能同时为空（身份不明）`)
  }
  return { ok: true, value: identity }
}

const UNCLAIMED_KINDS: readonly MigrationUnclaimedKind[] = [
  'draft',
  'baseline',
  'candidate',
  'projection',
  'workbench',
  'preference',
]

function normalizeUnclaimed(
  raw: unknown,
  path: string,
): { ok: true; value: MigrationUnclaimedEntry } | MigrationValidationFailure {
  if (!isRecord(raw)) return fail('INVALID_FIELD', path, `${path} 必须是对象`)
  const key = requireString(raw, 'key', `${path}.key`)
  if ('ok' in key && key.ok === false) return key
  const kindRaw = raw['kind']
  if (typeof kindRaw !== 'string' || !UNCLAIMED_KINDS.includes(kindRaw as MigrationUnclaimedKind)) {
    return fail('INVALID_FIELD', `${path}.kind`, `${path}.kind 不是已知来源类型`)
  }
  const reason = requireString(raw, 'reason', `${path}.reason`)
  if ('ok' in reason && reason.ok === false) return reason
  const rawText = requireString(raw, 'raw', `${path}.raw`)
  if ('ok' in rawText && rawText.ok === false) return rawText
  const identityRaw = raw['identitySuffix']
  let identitySuffix: string | null = null
  if (identityRaw !== null && identityRaw !== undefined) {
    if (typeof identityRaw !== 'string') {
      return fail('INVALID_FIELD', `${path}.identitySuffix`, `${path}.identitySuffix 必须是字符串或 null`)
    }
    identitySuffix = identityRaw
  }
  const chapterRaw = raw['chapterIndex']
  let chapterIndex: number | null = null
  if (chapterRaw !== null && chapterRaw !== undefined) {
    if (typeof chapterRaw !== 'number' || !Number.isInteger(chapterRaw)) {
      return fail('INVALID_FIELD', `${path}.chapterIndex`, `${path}.chapterIndex 必须是整数或 null`)
    }
    chapterIndex = chapterRaw
  }
  return {
    ok: true,
    value: {
      key: (key as { value: string }).value,
      identitySuffix,
      chapterIndex,
      kind: kindRaw as MigrationUnclaimedKind,
      reason: (reason as { value: string }).value,
      raw: (rawText as { value: string }).value,
    },
  }
}

/**
 * 校验一个未知输入是否为合法迁移包 v1。
 *
 * 顺序：形状 → 格式版本 → 字段 → 摘要。摘要最后算：只有结构合法时才可能给出
 * 「摘要不匹配」这一精确诊断，否则报出的会是字段错误（更可操作）。
 */
export function validateMigrationPackage(input: unknown): MigrationValidationResult {
  if (!isRecord(input)) {
    return fail('NOT_OBJECT', '', '迁移包必须是 JSON 对象')
  }

  const formatVersion = input['formatVersion']
  if (formatVersion === undefined || formatVersion === null) {
    return fail('MISSING_FIELD', 'formatVersion', '缺少 formatVersion')
  }
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    return fail('INVALID_FIELD', 'formatVersion', 'formatVersion 必须是整数')
  }
  if (formatVersion !== MIGRATION_FORMAT_VERSION) {
    return fail(
      'FORMAT_VERSION_UNSUPPORTED',
      'formatVersion',
      `不支持的迁移包格式版本 ${formatVersion}（本实现支持 ${MIGRATION_FORMAT_VERSION}）`,
    )
  }

  const originRaw = input['origin']
  if (!isRecord(originRaw)) {
    return fail('MISSING_FIELD', 'origin', '缺少 origin 或 origin 不是对象')
  }
  const originValue = requireString(originRaw, 'origin', 'origin.origin')
  if ('ok' in originValue && originValue.ok === false) return originValue
  const exportedAt = requireString(originRaw, 'exportedAt', 'origin.exportedAt')
  if ('ok' in exportedAt && exportedAt.ok === false) return exportedAt
  const userAgentRaw = originRaw['userAgent']
  if (userAgentRaw !== undefined && userAgentRaw !== null && typeof userAgentRaw !== 'string') {
    return fail('INVALID_FIELD', 'origin.userAgent', 'origin.userAgent 必须是字符串')
  }
  const origin: MigrationOrigin = {
    origin: (originValue as { value: string }).value,
    exportedAt: (exportedAt as { value: string }).value,
    userAgent: typeof userAgentRaw === 'string' ? userAgentRaw : '',
  }

  const booksRaw = input['books']
  if (!Array.isArray(booksRaw)) {
    return fail('MISSING_FIELD', 'books', '缺少 books 数组')
  }
  const booksList = booksRaw as readonly unknown[]
  const books: MigrationBookEntry[] = []
  for (let i = 0; i < booksList.length; i += 1) {
    const bookPath = `books[${i}]`
    const bookRaw = booksList[i]
    if (!isRecord(bookRaw)) return fail('INVALID_FIELD', bookPath, `${bookPath} 必须是对象`)
    const identity = normalizeIdentity(bookRaw['identity'], `${bookPath}.identity`)
    if ('ok' in identity && identity.ok === false) return identity
    const chaptersRaw = bookRaw['chapters']
    if (!Array.isArray(chaptersRaw)) {
      return fail('MISSING_FIELD', `${bookPath}.chapters`, `${bookPath}.chapters 必须是数组`)
    }
    const chaptersList = chaptersRaw as readonly unknown[]
    const chapters: MigrationChapterEntry[] = []
    for (let j = 0; j < chaptersList.length; j += 1) {
      const chapter = normalizeChapter(chaptersList[j], `${bookPath}.chapters[${j}]`)
      if ('ok' in chapter && chapter.ok === false) return chapter
      chapters.push((chapter as { value: MigrationChapterEntry }).value)
    }
    books.push({ identity: (identity as { value: BookIdentity }).value, chapters })
  }

  const unclaimedRaw = input['unclaimed']
  if (!Array.isArray(unclaimedRaw)) {
    return fail('MISSING_FIELD', 'unclaimed', '缺少 unclaimed 数组')
  }
  const unclaimedList = unclaimedRaw as readonly unknown[]
  const unclaimed: MigrationUnclaimedEntry[] = []
  for (let i = 0; i < unclaimedList.length; i += 1) {
    const entry = normalizeUnclaimed(unclaimedList[i], `unclaimed[${i}]`)
    if ('ok' in entry && entry.ok === false) return entry
    unclaimed.push((entry as { value: MigrationUnclaimedEntry }).value)
  }

  const preferencesRaw = input['preferences']
  if (!isRecord(preferencesRaw)) {
    return fail('MISSING_FIELD', 'preferences', '缺少 preferences 对象')
  }
  const preferences: Record<string, string> = {}
  for (const [key, value] of Object.entries(preferencesRaw)) {
    if (typeof value !== 'string') {
      return fail('INVALID_FIELD', `preferences.${key}`, `preferences.${key} 必须是字符串`)
    }
    preferences[key] = value
  }

  const digestRaw = input['digest']
  if (typeof digestRaw !== 'string') {
    return fail('MISSING_FIELD', 'digest', '缺少 digest 字符串')
  }

  // 摘要对「除 digest 外的原始字段」计算：容忍实现方附加的未知字段，
  // 只证明内容未被改动。
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === 'digest') continue
    payload[key] = value
  }
  const expectedDigest = computePackageDigest(payload as MigrationPackagePayload)
  if (expectedDigest !== digestRaw) {
    return fail(
      'DIGEST_MISMATCH',
      'digest',
      `内容摘要不匹配（期望 ${expectedDigest}，实际 ${digestRaw}）：包内容已被改动或损坏`,
    )
  }

  const value: MigrationPackageV1 = {
    formatVersion,
    origin,
    books,
    unclaimed,
    preferences,
    digest: digestRaw,
  }
  return { ok: true, value }
}
