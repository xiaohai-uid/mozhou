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
 * - 正文写入统一走 data-plane saveProseDraft（revision CAS + 写前哈希门 +
 *   定稿保护），本模块不新建旁路。
 * - 模式组合：replace/replace-selection 全文替换；continue 原文+候选增量；
 *   insert 在生成开始时选区位置插入（地址按 base 现场，编辑即冲突）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  ChapterPhaseError,
  OPERATION_RECORD_VERSION,
  PreWriteHashMismatchError,
  ProseRevisionConflictError,
  atomicWriteFileSync,
  findReplayableOperation,
  linkTaskOperation,
  proseChapterPath,
  renderProseChapter,
  sha256Hex,
  withBook,
  writeOperationRecordIfAbsent,
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
  readonly expectedRevision?: number | undefined
  readonly operationId?: string | undefined
  readonly principalId?: string | undefined
  readonly taskId?: string | undefined
}

export interface AcceptDraftResult {
  readonly candidateId: string
  readonly chapterIndex: number
  readonly revision: number
  readonly sha256: string
  /** true = 本次请求未重新写入（幂等重放/崩溃恢复命中）。 */
  readonly alreadyApplied: boolean
  readonly confirmPartial?: boolean | undefined
}

export class AcceptConflictError extends Error {
  override readonly name = 'AcceptConflictError'
  constructor(readonly code: 'BASE_STALE' | 'KEY_REUSED' | 'CANDIDATE_DONE' | 'INVALID_KEY' | 'IDENTITY_MISMATCH', message: string) {
    super(message)
  }
}

const INTENT_DIR = '.mozhou/accept-intents'

/**
 * 采纳 intent 持久格式版本。
 * - v1：无操作身份块（本次加固之前写的记录）；
 * - v2：携带 `operation`（原始操作身份快照），恢复/回放据此补全操作结果。
 * 读取端同时接受 v1/v2；缺 `operation` 一律按「旧记录」处理，**绝不**用重试请求的
 * 身份去补一个旧记录（否则同 ID 换摘要/换主体就能把别人的操作认成自己的）。
 */
const INTENT_SCHEMA_VERSION = 2

/**
 * intent 中保存的**原始操作身份**（写 intent 时从请求快照）。
 *
 * 关键纪律：崩溃恢复与 done 回放补写操作记录时，身份只能取自这里，
 * **不能**取自当前重试请求——否则「done 已写、操作记录未写」的窗口一旦命中，
 * 一个不同主体的新请求就能把自己绑到别人已生效的操作上。
 */
interface AcceptIntentOperation {
  readonly operationId: string
  readonly principalId: string
  readonly requestDigest: string
  readonly taskId?: string | undefined
}

interface AcceptIntent {
  /** 1 = 旧记录（无 operation）；2 = 携带 operation。读取端两者都接受。 */
  readonly schemaVersion: number
  readonly candidateId: string
  readonly idempotencyKey: string
  readonly bookId: string
  readonly chapterIndex: number
  readonly before: WriteBase
  readonly after: WriteBase
  readonly state: 'intent' | 'done'
  readonly confirmPartial?: boolean | undefined
  /** v2+：原始操作身份；v1 记录缺此块（exactOptional：缺省即不存在）。 */
  readonly operation?: AcceptIntentOperation | undefined
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
    // v1 与 v2 都接受：旧记录缺 operation 块，交由调用方按「无原始身份」处理。
    if (
      !parsed ||
      (parsed.schemaVersion !== 1 && parsed.schemaVersion !== INTENT_SCHEMA_VERSION) ||
      (parsed.state !== 'intent' && parsed.state !== 'done')
    ) {
      throw new Error('corrupted intent schema')
    }
    return parsed
  } catch (err) {
    throw new AcceptConflictError('BASE_STALE', `CORRUPT_INTENT: intent log for candidate ${candidateId} is damaged: ${(err as Error).message}`)
  }
}

function writeIntent(root: string, intent: AcceptIntent): void {
  mkdirSync(join(root, INTENT_DIR), { recursive: true })
  // 原子写：该文件是崩溃恢复的唯一凭证，裸 writeFileSync 撕裂后 JSON.parse 会失败，
  // 候选此后每次采纳都误报 BASE_STALE（需手工删文件才能恢复）。与同目录更新路径一致。
  atomicWriteFileSync(intentPath(root, intent.candidateId), JSON.stringify(intent, null, 2) + '\n')
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
 * 操作身份前置校验（F-01 加固）：必须在**任何成功返回分支与盘面副作用之前**完成。
 *
 * 此前 done 回放先于身份检查返回、恢复分支也不补操作结果，等于恢复路径完全绕过身份校验：
 * 同 operationId 换请求摘要或换主体，照样拿到 alreadyApplied。
 *
 * 判定：
 * - 请求不带 operationId（旧客户端/回归脚本）⇒ 不做校验，行为不变；
 * - intent 不存在 ⇒ 无从比对，交由调用方写入带身份的新 intent；
 * - intent 存在且带原始身份 ⇒ 必须与本次请求逐项一致，否则拒绝；
 * - intent 存在但**无**原始身份（v1 旧记录）⇒ 无法证明同源，拒绝把新请求绑上去。
 */
function assertOperationIdentity(
  intent: AcceptIntent | null,
  request: { readonly operationId?: string | undefined; readonly principalId?: string | undefined },
  requestDigest: string,
): void {
  if (intent === null) return
  const op = intent.operation
  if (op === undefined) {
    // 旧记录（v1）或由未带 operationId 的请求所写：无法证明同源 ⇒ 拒绝把**新操作**绑上去；
    // 不带 operationId 的请求按兼容路径继续（v1 历史记录的合法回放）。
    if (request.operationId !== undefined) {
      throw new AcceptConflictError(
        'IDENTITY_MISMATCH',
        'IDENTITY_MISMATCH: accept intent for this candidate carries no original operation identity; refusing to bind a new operation to it',
      )
    }
    return
  }
  // intent 已保存原始身份 ⇒ 请求必须出示同一身份。**省略 operationId 不能免除校验**：
  // 否则另一个主体只要不带该字段，就能经 done 回放拿到别人的已采纳结果（S4）。
  if (request.operationId === undefined) {
    throw new AcceptConflictError(
      'IDENTITY_MISMATCH',
      'IDENTITY_MISMATCH: this accept intent carries an original operation identity; the request must present the same operationId',
    )
  }
  const principalId = request.principalId ?? 'local_user'
  if (op.operationId !== request.operationId || op.principalId !== principalId || op.requestDigest !== requestDigest) {
    throw new AcceptConflictError(
      'IDENTITY_MISMATCH',
      'IDENTITY_MISMATCH: operationId/principal/request digest do not match the original accept intent',
    )
  }
}

/**
 * 结果补全：把「正文已应用」补齐到操作记录与任务关联。
 *
 * 正常完成、done 回放、崩溃恢复三条路径共用同一实现。此前只有正常路径写操作记录，
 * 恢复路径只 markAccepted ——「done 已写、操作记录未写」的窗口一旦命中，操作结果永远查不到。
 * 身份只取自 intent 快照（completeAcceptResult 不接收当前请求），保证补出来的一定是原操作。
 * intent 无 operation 块（v1 旧记录）⇒ 不写记录，避免凭空造身份。
 */
function completeAcceptResult(
  bookRoot: string,
  intent: AcceptIntent,
  applied: { readonly revision: number; readonly sha256: string },
): void {
  const op = intent.operation
  if (op === undefined) return
  writeOperationRecordIfAbsent(bookRoot, {
    recordVersion: OPERATION_RECORD_VERSION,
    operationId: op.operationId,
    operationType: 'draft.accept',
    principalId: op.principalId,
    bookId: intent.bookId,
    requestDigest: op.requestDigest,
    chapterIndex: intent.chapterIndex,
    state: 'succeeded',
    result: { appliedRevision: applied.revision, appliedBodyHash: applied.sha256 },
    recordedAt: new Date().toISOString(),
  })
  if (op.taskId !== undefined) {
    linkTaskOperation(bookRoot, op.taskId, op.operationId)
  }
}

/**
 * 受控采纳。不变量：
 * - 未写正文前持久化 intent（含 predicated after）——崩溃恢复按 after 比对，不二次写入；
 * - 全程单 LocalDataPlane 句柄，saveProseDraft 内部完成 revision 比对 + 写前哈希门，
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
  const isPartialConfirmed = Boolean(request.allowPartial || request.confirmPartial)
  const requestDigest = sha256Hex(`${idempotencyKey}:${candidateId}:${isPartialConfirmed}`)
  const existingIntent = readIntent(bookRoot, candidateId)

  // F-01 加固（顺序不变式）：身份校验必须排在**任何成功返回分支与副作用之前**。
  // done 回放与崩溃恢复分支同样要过这一关——恢复不等于免检。
  assertOperationIdentity(existingIntent, request, requestDigest)

  // 已落账的成功操作（同 ID / 同摘要 / 同作用域）⇒ 零写入回放。
  // 与旧实现等价，但提前到 done 回放之前，使「操作记录已写、候选却未标 accepted」的
  // 反向窗口也能靠 markAccepted 幂等收敛（draft-candidate.ts 对同 revision 重复采纳幂等）。
  if (request.operationId !== undefined) {
    const replayHit = findReplayableOperation(bookRoot, {
      operationType: 'draft.accept',
      operationId: request.operationId,
      principalId: request.principalId ?? 'local_user',
      bookId: candidate.bookId,
      requestDigest,
    })
    if (replayHit !== null) {
      markAccepted(bookRoot, candidateId, replayHit.result.appliedRevision, isPartialConfirmed, { confirmPartial: isPartialConfirmed })
      // 结果补全走共用助手：按 **intent 中保存的原任务** 补关联，不依赖本次请求是否带 taskId。
      // 此前这条出口只链本次 taskId——「记录已写、原任务关联未写」的窗口一旦命中，
      // 原任务的 operationIds 永远为空（S3）。
      if (existingIntent?.operation !== undefined) {
        completeAcceptResult(bookRoot, existingIntent, {
          revision: replayHit.result.appliedRevision,
          sha256: replayHit.result.appliedBodyHash,
        })
      } else if (request.taskId !== undefined) {
        linkTaskOperation(bookRoot, request.taskId, request.operationId)
      }
      return {
        candidateId,
        chapterIndex: candidate.chapterIndex,
        revision: replayHit.result.appliedRevision,
        sha256: replayHit.result.appliedBodyHash,
        alreadyApplied: true,
        ...(isPartialConfirmed ? { confirmPartial: true } : {}),
      }
    }
  }

  if (existingIntent?.state === 'done') {
    markAccepted(bookRoot, candidateId, existingIntent.after.revision, true, { confirmPartial: isPartialConfirmed || Boolean(existingIntent.confirmPartial) })
    // 补齐操作结果：命中「done 已写、操作记录未写」窗口时，这里把原操作的结果补上，
    // 使重启重试后操作结果可查（身份取自 intent 快照，不是本次请求）。
    completeAcceptResult(bookRoot, existingIntent, { revision: existingIntent.after.revision, sha256: existingIntent.after.sha256 })
    return {
      candidateId,
      chapterIndex: candidate.chapterIndex,
      revision: existingIntent.after.revision,
      sha256: existingIntent.after.sha256,
      alreadyApplied: true,
      confirmPartial: isPartialConfirmed || Boolean(existingIntent.confirmPartial),
    }
  }

  // C2 / R01 / W4-2b / W4-2c-3：落盘前终态与正交合法性校验
  // 失败或取消产物一律拒绝；流中/取消请求中一律拒绝
  if (candidate.taskState === 'failed' || candidate.taskState === 'cancelled') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in taskState ${candidate.taskState} cannot be accepted`)
  }
  if (candidate.contentState === 'streaming' || candidate.taskState === 'running' || candidate.taskState === 'cancel_requested') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status ${candidate.status} cannot be accepted`)
  }
  // 半稿必须经显式确认（confirmPartial / allowPartial）才可采纳
  if (candidate.contentState === 'partial' && !isPartialConfirmed) {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status partial requires explicit confirmation`)
  }
  if (candidate.status !== 'ready' && candidate.status !== 'partial' && candidate.status !== 'accepted') {
    throw new CandidateError('CANDIDATE_NOT_ACCEPTABLE', `CANDIDATE_NOT_ACCEPTABLE: candidate ${candidateId} in status ${String(candidate.status)} cannot be accepted`)
  }

  // 采纳全程在同一次借用内完成：读相位 → 写 intent → 落正文 → 落 done intent。
  // 中途任何抛出都经 seam 的 catch 归还句柄（深化 08）——此前靠手写 finally。
  return withBook(bookRoot, (plane) => {
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
        // 与 done 回放共用结果补全：恢复也要把操作记录/任务关联补齐，否则「恢复成功
        // 但操作结果查不到」仍是同一缺陷的另一个入口。
        completeAcceptResult(bookRoot, existingIntent, { revision: existingIntent.after.revision, sha256: currentHash })
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

    // 最新 revision 显式校验：客户端声称 expectedRevision、候选 base.revision、磁盘现场三方必须一致
    if (request.expectedRevision !== undefined && scan.revision !== request.expectedRevision) {
      throw new ProseRevisionConflictError(candidate.chapterIndex, request.expectedRevision, scan.revision)
    }
    if (scan.revision !== candidate.base.revision) {
      throw new ProseRevisionConflictError(candidate.chapterIndex, candidate.base.revision, scan.revision)
    }
    if (scan.revision !== base.revision) {
      throw new ProseRevisionConflictError(candidate.chapterIndex, base.revision, scan.revision)
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
      schemaVersion: INTENT_SCHEMA_VERSION,
      candidateId,
      idempotencyKey,
      bookId: candidate.bookId,
      chapterIndex: candidate.chapterIndex,
      before: { revision: scan.revision, sha256: candidate.base.sha256 },
      after: { revision: afterRevision, sha256: afterSha256 },
      state: 'intent',
      ...(isPartialConfirmed ? { confirmPartial: true } : {}),
      // 原始操作身份快照：恢复/回放据此补全操作结果，绝不依赖重试请求自带的身份。
      ...(request.operationId === undefined
        ? {}
        : {
            operation: {
              operationId: request.operationId,
              principalId: request.principalId ?? 'local_user',
              requestDigest,
              ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
            },
          }),
    }
    writeIntent(bookRoot, intent)

    // 正文落盘：revision CAS + 写前哈希门；confirmExternalOverwrite 不传——
    // 受控采纳不做静默外部覆盖，冲突即 409，交由 UI 展示差异。
    plane.saveProseDraft({
      chapterIndex: candidate.chapterIndex,
      body: composedBody,
      expectedRevision: scan.revision,
    })

    // 落盘后以盘面实据刷新 after（防规范化差异）；再标记候选 accepted（带落账审计）
    const finalRevision = afterRevision
    const finalSha256 = proseFileSha256(bookRoot, candidate.chapterIndex)
    const doneIntent: AcceptIntent = { ...intent, after: { revision: finalRevision, sha256: finalSha256 }, state: 'done' }
    writeIntent(bookRoot, doneIntent)
    markAccepted(bookRoot, candidateId, finalRevision, isPartialConfirmed, { confirmPartial: isPartialConfirmed })

    // W3 操作记录：正常完成、done 回放、崩溃恢复共用 completeAcceptResult，
    // 保证「结果记录与任务关联补齐」后才算采纳成功（此前恢复路径缺这一步）。
    completeAcceptResult(bookRoot, doneIntent, { revision: finalRevision, sha256: finalSha256 })

    return {
      candidateId,
      chapterIndex: candidate.chapterIndex,
      revision: finalRevision,
      sha256: finalSha256,
      alreadyApplied: false,
      ...(isPartialConfirmed ? { confirmPartial: true } : {}),
    }
  })
}