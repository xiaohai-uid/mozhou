/**
 * C2 受控采纳（T04）：候选 → 书锁语义 CAS → 正文落盘 → 候选 accepted。
 *
 * 关键纪律（I02/I03/I05）：
 * - base 三重比对：客户端传来的 base、候选创建时的 base、盘上当前 revision+hash
 *   全部一致才允许写；生成期间外部编辑/作者保存 → 409 冲突，候选保留。
 * - 意图日志（<书>/.mozhou/accept-intents/<candidateId>.json）在写入前持久化：
 *   崩溃窗口（正文已写但候选未标记）按 intent.after 恢复，绝不再次追加/涨版本。
 * - 幂等：同 (bookId, idempotencyKey) 重放返回 alreadyApplied；目标已 applied
 *   的候选再 accept 返回同结果；不同 body 复用同一 key → 409。
 * - 正文写入统一走 data-plane saveProseDraft（revision CAS + 写前 hash 守卫 +
 *   定稿保护），本模块不新建旁路。
 * - 模式组合：replace/replace-selection 全文替换；continue 原文+候选增量；
 *   insert 在生成开始时选区位置插入（地址按 base 现场，编辑即冲突）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ChapterPhaseError,
  LocalDataPlane,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
  proseChapterPath,
  renderProseChapter,
} from '@mozhou/data-plane'
import { CandidateError, acceptDraftCandidate as markAccepted, readDraftCandidate, type WriteBase } from './draft-candidate.js'

export interface AcceptDraftRequest {
  readonly bookRoot: string
  readonly candidateId: string
  /** 客户端声称的 base；必须与候选.base、盘上现场三者一致才写。 */
  readonly base: WriteBase
  /** 16–128 ASCII；同 key 同 body 幂等，不同 body 复用 409。 */
  readonly idempotencyKey: string
  readonly bookId?: string | undefined
  readonly chapterIndex?: number | undefined
  readonly allowPartial?: boolean | undefined
  readonly confirmPartial?: boolean | undefined
}

export interface AcceptDraftResult {
  readonly candidateId: string
  readonly chapterIndex: number
  readonly revision: number
  readonly sha256: string
  /** true = 本次请求未重新写入（幂等重放/崩溃恢复命中）。 */
  readonly alreadyApplied: boolean
}

export class AcceptConflictError extends Error {
  override readonly name = 'AcceptConflictError'
  constructor(readonly code: 'BASE_STALE' | 'KEY_REUSED' | 'CANDIDATE_DONE' | 'INVALID_KEY' | 'IDENTITY_MISMATCH', message: string) {
    super(message)
  }
}

const INTENT_DIR = '.mozhou/accept-intents'

interface AcceptIntent {
  readonly schemaVersion: 1
  readonly candidateId: string
  readonly idempotencyKey: string
  readonly bookId: string
  readonly chapterIndex: number
  readonly before: WriteBase
  readonly after: WriteBase
  readonly state: 'intent' | 'done'
}

function intentPath(root: string, candidateId: string): string {
  return join(root, INTENT_DIR, candidateId + '.json')
}

function readIntent(root: string, candidateId: string): AcceptIntent | null {
  const path = intentPath(root, candidateId)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as AcceptIntent
    if (!parsed || parsed.schemaVersion !== 1 || (parsed.state !== 'intent' && parsed.state !== 'done')) {
      throw new Error('corrupted intent schema')
    }
    return parsed
  } catch (err) {
    throw new AcceptConflictError('BASE_STALE', `CORRUPT_INTENT: intent log for candidate ${candidateId} is damaged: ${(err as Error).message}`)
  }
}

function writeIntent(root: string, intent: AcceptIntent): void {
  mkdirSync(join(root, INTENT_DIR), { recursive: true })
  writeFileSync(intentPath(root, intent.candidateId), JSON.stringify(intent, null, 2) + '\n')
}

/** 正文 raw 文件 sha256（写后指纹；候选接受结果回给 UI 的 after.sha256 同源）。 */
export function proseFileSha256(root: string, chapterIndex: number): string {
  return createHash('sha256').update(readFileSync(join(root, proseChapterPath(chapterIndex)))).digest('hex')
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function isBoundarySplittingSurrogate(str: string, index: number): boolean {
  if (index <= 0 || index >= str.length) return false
  return isHighSurrogate(str.charCodeAt(index - 1)) && isLowSurrogate(str.charCodeAt(index))
}

/** C2 模式组合：按候选模式把候选文本合成到 base 正文。 */
export function composeBody(
  candidate: {
    mode: 'replace' | 'continue' | 'insert' | 'replace-selection'
    text: string
    selection?: { from: number; to: number; selectedTextHash: string }
  },
  baseBody: string,
): string {
  switch (candidate.mode) {
    case 'replace':
      return candidate.text
    case 'continue':
      return baseBody + candidate.text
    case 'insert': {
      let at = baseBody.length
      if (candidate.selection !== undefined) {
        at = candidate.selection.from
        if (!Number.isInteger(at) || at < 0 || at > baseBody.length) {
          throw new CandidateError('INVALID_SELECTION', `INVALID_SELECTION: insert offset ${at} out of bounds [0, ${baseBody.length}]`)
        }
        if (isBoundarySplittingSurrogate(baseBody, at)) {
          throw new CandidateError('INVALID_SELECTION', 'INVALID_SELECTION: insert offset splits UTF-16 surrogate pair')
        }
      }
      return baseBody.slice(0, at) + candidate.text + baseBody.slice(at)
    }
    case 'replace-selection': {
      if (candidate.selection === undefined) {
        throw new CandidateError('INVALID_SELECTION', 'INVALID_SELECTION: replace-selection requires selection')
      }
      const { from, to, selectedTextHash } = candidate.selection
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > baseBody.length) {
        throw new CandidateError('INVALID_SELECTION', `INVALID_SELECTION: invalid selection range [${from},${to}) for body length ${baseBody.length}`)
      }
      if (isBoundarySplittingSurrogate(baseBody, from) || isBoundarySplittingSurrogate(baseBody, to)) {
        throw new CandidateError('INVALID_SELECTION', 'INVALID_SELECTION: selection offsets split UTF-16 surrogate pair')
      }
      const selected = baseBody.slice(from, to)
      const actualHash = createHash('sha256').update(selected).digest('hex')
      if (actualHash !== selectedTextHash) {
        throw new CandidateError('INVALID_SELECTION', `INVALID_SELECTION: selectedTextHash mismatch: expected ${selectedTextHash}, got ${actualHash}`)
      }
      return baseBody.slice(0, from) + candidate.text + baseBody.slice(to)
    }
  }
}

/** 同 (bookId, idempotencyKey) 索引：不同候选复用同 key → 409（I03）。 */
export function findIntentByKey(root: string, bookId: string, idempotencyKey: string): AcceptIntent | null {
  const dirPath = join(root, INTENT_DIR)
  if (!existsSync(dirPath)) return null
  for (const name of readdirSync(dirPath)) {
    if (!name.endsWith('.json')) continue
    try {
      const intent = JSON.parse(readFileSync(join(dirPath, name), 'utf8')) as AcceptIntent
      if (intent.bookId === bookId && intent.idempotencyKey === idempotencyKey) return intent
    } catch {
      continue
    }
  }
  return null
}

/**
 * 受控采纳。不变量：
 * - 未写正文前持久化 intent（含 predicated after）——崩溃恢复按 after 比对，不二次写入；
 * - 全程单 LocalDataPlane 句柄，saveProseDraft 内部完成 revision 比对 + 写前 hash 守卫，
 *   外部改盘（revision 未变但 hash 变）→ PreWriteHashMismatchError，候选保留；
 * - 只有上抛前已完成正文落盘才写 done；done 重放返回 alreadyApplied=true。
 */
export function acceptDraft(request: AcceptDraftRequest): AcceptDraftResult {
  const { bookRoot, candidateId, base, idempotencyKey } = request
  if (!bookRoot || typeof bookRoot !== 'string') {
    throw new CandidateError('INVALID_REQUEST', 'INVALID_REQUEST: valid bookRoot required')
  }
  if (!candidateId || typeof candidateId !== 'string') {
    throw new CandidateError('INVALID_REQUEST', 'INVALID_REQUEST: valid candidateId required')
  }
  if (!base || typeof base !== 'object' || !Number.isInteger(base.revision) || base.revision < 0 || typeof base.sha256 !== 'string') {
    throw new CandidateError('INVALID_REQUEST', 'INVALID_REQUEST: valid base required')
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0 || idempotencyKey.length > 256 || !/^[\x20-\x7E]+$/.test(idempotencyKey)) {
    throw new AcceptConflictError('INVALID_KEY', 'INVALID_KEY: idempotencyKey must be non-empty ASCII characters up to 256')
  }

  const candidate = readDraftCandidate(bookRoot, candidateId)
  if (candidate === null) {
    throw new CandidateError('CANDIDATE_NOT_FOUND', `CANDIDATE_NOT_FOUND: candidate ${candidateId} not found`)
  }
  if (request.bookId !== undefined && request.bookId !== candidate.bookId) {
    throw new CandidateError('IDENTITY_MISMATCH', `IDENTITY_MISMATCH: bookId ${request.bookId} does not match candidate ${candidate.bookId}`)
  }
  if (request.chapterIndex !== undefined && request.chapterIndex !== candidate.chapterIndex) {
    throw new CandidateError('IDENTITY_MISMATCH', `IDENTITY_MISMATCH: chapterIndex ${request.chapterIndex} does not match candidate ${candidate.chapterIndex}`)
  }
  if (candidate.base.revision !== base.revision || candidate.base.sha256 !== base.sha256) {
    throw new AcceptConflictError('BASE_STALE', 'BASE_STALE: client base does not match candidate base')
  }

  const bookJsonPath = join(bookRoot, 'book.json')
  if (existsSync(bookJsonPath)) {
    try {
      const diskBook = JSON.parse(readFileSync(bookJsonPath, 'utf8')) as { id?: string }
      if (diskBook.id && candidate.bookId !== 'book-local' && diskBook.id !== candidate.bookId) {
        throw new CandidateError('IDENTITY_MISMATCH', `IDENTITY_MISMATCH: candidate bookId ${candidate.bookId} does not match book on disk ${diskBook.id}`)
      }
    } catch (e) {
      if (e instanceof CandidateError) throw e
    }
  }

  // 幂等：同 key 已用于其他候选 → 409；本候选 intent done → 直接返回已应用
  const keyHit = findIntentByKey(bookRoot, candidate.bookId, idempotencyKey)
  if (keyHit !== null && keyHit.candidateId !== candidateId) {
    throw new AcceptConflictError('KEY_REUSED', 'KEY_REUSED: idempotencyKey already used for another candidate')
  }
  const existingIntent = readIntent(bookRoot, candidateId)
  if (existingIntent?.state === 'done') {
    markAccepted(bookRoot, candidateId, existingIntent.after.revision, true)
    return {
      candidateId,
      chapterIndex: candidate.chapterIndex,
      revision: existingIntent.after.revision,
      sha256: existingIntent.after.sha256,
      alreadyApplied: true,
    }
  }

  // C2 / R01：落盘前终态与合法性校验，拒绝 streaming/cancelled/failed；partial 必须显式确认
  if (candidate.status === 'streaming' || candidate.status === 'cancelled' || candidate.status === 'failed') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status ${candidate.status} cannot be accepted`)
  }
  const isPartialConfirmed = Boolean(request.allowPartial || request.confirmPartial)
  if (candidate.status === 'partial' && !isPartialConfirmed) {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status partial requires explicit confirmation`)
  }
  if (candidate.status !== 'ready' && candidate.status !== 'partial' && candidate.status !== 'accepted') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status ${String(candidate.status)} cannot be accepted`)
  }

  const plane = LocalDataPlane.openOrRebuild(bookRoot)
  try {
    const scan = plane.getProseChapter(candidate.chapterIndex)
    if (scan.phase !== 'draft') {
      throw new ChapterPhaseError(candidate.chapterIndex, 'accept requires phase=draft, got ' + scan.phase)
    }
    const currentHash = proseFileSha256(bookRoot, candidate.chapterIndex)

    // C2 / R02：真实进程中断恢复（4 故障窗口重放处理）
    if (existingIntent?.state === 'intent') {
      // 窗口 2：正文已写后崩溃（disk 已是 after 状态），补齐 done intent 与 accepted 标记
      if (scan.revision === existingIntent.after.revision && currentHash === existingIntent.after.sha256) {
        writeIntent(bookRoot, { ...existingIntent, state: 'done' })
        markAccepted(bookRoot, candidateId, existingIntent.after.revision, isPartialConfirmed)
        return {
          candidateId,
          chapterIndex: candidate.chapterIndex,
          revision: existingIntent.after.revision,
          sha256: currentHash,
          alreadyApplied: true,
        }
      }
      // 窗口 1：正文写前崩溃（disk 仍是 before 状态），允许安全继续写入
      if (scan.revision === existingIntent.before.revision && currentHash === existingIntent.before.sha256) {
        // 盘面未变，安全继续后续正文写入流程
      } else {
        // 盘面被第三方修改，既非 before 也非 after，拒绝覆盖并报冲突
        throw new AcceptConflictError('BASE_STALE', 'BASE_STALE: disk state conflict during intent recovery')
      }
    }

    if (scan.revision !== candidate.base.revision) {
      throw new ProseRevisionConflictError(candidate.chapterIndex, candidate.base.revision, scan.revision)
    }
    if (currentHash !== candidate.base.sha256) {
      // revision 相同但盘面 hash 已变：外部编辑器改盘——候选保留，拒绝静默覆盖
      throw new PreWriteHashMismatchError(proseChapterPath(candidate.chapterIndex), 'accept base.sha256 mismatch with disk')
    }

    const composedBody = composeBody(candidate, scan.body)
    const normalizedBody = composedBody.endsWith('\n') || composedBody.length === 0 ? composedBody : composedBody + '\n'
    // after 指纹必须包含实际落盘 frontmatter 和规范化（renderProseChapter 统一真源）
    const afterRevision = scan.revision + 1
    const predicatedContent = renderProseChapter({
      mozhouId: scan.mozhouId,
      revision: afterRevision,
      chapterIndex: scan.chapterIndex,
      phase: 'draft',
      body: normalizedBody,
    })
    const afterSha256 = createHash('sha256').update(predicatedContent).digest('hex')

    const intent: AcceptIntent = {
      schemaVersion: 1,
      candidateId,
      idempotencyKey,
      bookId: candidate.bookId,
      chapterIndex: candidate.chapterIndex,
      before: { revision: scan.revision, sha256: candidate.base.sha256 },
      after: { revision: afterRevision, sha256: afterSha256 },
      state: 'intent',
    }
    writeIntent(bookRoot, intent)

    // 正文落盘：revision CAS + 写前 hash 守卫；confirmExternalOverwrite 不传——
    // 受控采纳不做静默外部覆盖，冲突即 409，交由 UI 展示差异。
    plane.saveProseDraft({
      chapterIndex: candidate.chapterIndex,
      body: composedBody,
      expectedRevision: scan.revision,
    })

    // 落盘后以盘面实据刷新 after（防规范化差异）；再标记候选 accepted
    const finalRevision = afterRevision
    const finalSha256 = proseFileSha256(bookRoot, candidate.chapterIndex)
    writeIntent(bookRoot, { ...intent, after: { revision: finalRevision, sha256: finalSha256 }, state: 'done' })
    markAccepted(bookRoot, candidateId, finalRevision, isPartialConfirmed)
    return { candidateId, chapterIndex: candidate.chapterIndex, revision: finalRevision, sha256: finalSha256, alreadyApplied: false }
  } finally {
    plane.close()
  }
}