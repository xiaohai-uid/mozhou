/**
 * apps/web · EXTERNAL_MODIFIED 对账路由与进程级运行期宿主 (T5 接线)。
 *
 * 规格锚点：dual-plane-sync-spec Q4/Q8-Q12（启动必检 + 运行期 watcher；五态状态机；
 * 逐条取舍；拒绝 ≠ 回滚文件）与 change-impact-engine-spec §3 D18（对账终态是
 * 影响传播的两大入口信号之一）。
 *
 * 本模块是 `ReconciliationService` 在生产端的唯一接线面，两件事：
 *
 * 1. **运行期宿主**（`ensureReconciliationRuntime`）：按书根挂一个进程级常驻平面 +
 *    `scanExternalModifications('startupScan')` + `startWatcher()`，使「外部修改最终
 *    必被检出」在应用存活期间成立。挂接点由装配层选择——生产入口（productionServer）
 *    在进程启动时挂数据根下已知书，并把 `onBookResolved` 钩子接到 ApiRouter，使
 *    **任何首次被访问的书**立即获得必检与 watcher（书可位于任意目录，无法靠启动扫描
 *    穷举）。同一书根只挂一次（幂等），平面常驻故**不得**在请求结束时关闭。
 *
 * 2. **对账候选面**：`/api/reconciliation.{list,get,decide,dismiss,retry,scan}` 六个
 *    book 级端点，把五态提案与作者门（逐条接受/拒绝）暴露给 UI。读端点用常驻服务；
 *    无常驻宿主时回退到一次性平面（测试/只读装配），请求结束即关闭。
 *
 * 诚实边界：`scan` 是显式检测请求，会**确保**常驻宿主已挂接（作者点「重新对账」
 * 即让检测面进入运行期）；其余读/决策端点不产生挂接触发，检测生命周期归装配层。
 * 挂接失败绝不静默：错误落 stderr 并可在 `list` 响应的 `attachError` 里读到。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LocalDataPlane, ReconciliationError } from '@mozhou/data-plane'
import type { ReconciliationService, ScanOutcome } from '@mozhou/data-plane'
import type { ApiRouter, RouteHandler } from '../router.js'
import { assertSafeBookRoot, RequestBoundaryError } from '../security.js'

/* ----------------------------------------------------------------------------
 * 进程级运行期宿主（一书一根，常驻）
 * ------------------------------------------------------------------------- */

export interface ReconciliationRuntime {
  readonly root: string
  readonly plane: LocalDataPlane
  readonly service: ReconciliationService
  /** 挂接时的启动必检结果（Q4）；挂接失败则整个 runtime 不存在。 */
  readonly startupScan: ScanOutcome
  readonly attachedAt: string
  readonly watcherIntervalMs: number
}

const runtimes = new Map<string, ReconciliationRuntime>()
/** 挂接失败账（书根 → 错误文本）：供装配层与 `list` 观测，绝不静默吞掉。 */
const attachFailures = new Map<string, string>()

const WATCHER_INTERVAL_MS = 2000

export function getReconciliationRuntime(root: string): ReconciliationRuntime | null {
  return runtimes.get(resolve(root)) ?? null
}

export function listReconciliationRuntimes(): readonly ReconciliationRuntime[] {
  return [...runtimes.values()]
}

export function getReconciliationAttachFailure(root: string): string | null {
  return attachFailures.get(resolve(root)) ?? null
}

/**
 * 挂接常驻对账宿主（幂等）：打开平面 → 启动必检 → 起 watcher。
 * 平面常驻至 `stopReconciliationRuntime`；任何一步失败都不留半个 runtime。
 */
export function ensureReconciliationRuntime(
  root: string,
  options: { readonly watcherIntervalMs?: number | undefined } = {},
): ReconciliationRuntime {
  const key = resolve(root)
  const existing = runtimes.get(key)
  if (existing !== undefined) return existing

  const safeRoot = assertSafeBookRoot(key)
  const plane = LocalDataPlane.openOrRebuild(safeRoot)
  try {
    const service = plane.reconciliation()
    const startupScan = service.scanExternalModifications('startupScan')
    const watcherIntervalMs = options.watcherIntervalMs ?? WATCHER_INTERVAL_MS
    service.startWatcher({ intervalMs: watcherIntervalMs })
    const runtime: ReconciliationRuntime = {
      root: safeRoot,
      plane,
      service,
      startupScan,
      attachedAt: new Date().toISOString(),
      watcherIntervalMs,
    }
    runtimes.set(key, runtime)
    attachFailures.delete(key)
    return runtime
  } catch (error) {
    plane.close()
    throw error
  }
}

export function stopReconciliationRuntime(root: string): void {
  const key = resolve(root)
  const runtime = runtimes.get(key)
  if (runtime === undefined) return
  runtimes.delete(key)
  runtime.service.stopWatcher()
  runtime.plane.close()
}

export function stopAllReconciliationRuntimes(): void {
  for (const key of [...runtimes.keys()]) stopReconciliationRuntime(key)
}

/* ----------------------------------------------------------------------------
 * 装配层挂接：启动扫描数据根 + 书解析钩子
 * ------------------------------------------------------------------------- */

export interface ReconciliationAttachReport {
  readonly attached: readonly string[]
  readonly failed: readonly { readonly root: string; readonly error: string }[]
}

/** 进程启动必检：数据根下已知书（books 目录与 users 用户书目录）逐个挂接。 */
export function attachReconciliationForDataRoot(dataRoot: string): ReconciliationAttachReport {
  const candidates = new Set<string>()
  collectBookRoots(resolve(dataRoot, 'books'), candidates)
  const usersDir = resolve(dataRoot, 'users')
  for (const user of readdirSafe(usersDir)) {
    collectBookRoots(resolve(usersDir, user, 'books'), candidates)
  }

  const attached: string[] = []
  const failed: { root: string; error: string }[] = []
  for (const root of candidates) {
    try {
      ensureReconciliationRuntime(root)
      attached.push(root)
    } catch (error) {
      const message = (error as Error).message
      attachFailures.set(root, message)
      failed.push({ root, error: message })
    }
  }
  return { attached, failed }
}

/**
 * 把「书根被解析」接到对账宿主：书位于任意目录，启动扫描无法穷举，故以首次访问
 * 为准完成必检 + watcher。钩子失败只记录不抛出——对账是旁路，绝不阻断业务请求。
 */
export function installReconciliationAutoAttach(router: ApiRouter): void {
  router.onBookResolved = (root: string): void => {
    try {
      ensureReconciliationRuntime(root)
    } catch (error) {
      const message = (error as Error).message
      const previous = attachFailures.get(resolve(root))
      attachFailures.set(resolve(root), message)
      if (previous !== message) {
        console.error(`[reconciliation] auto-attach failed for ${root}: ${message}`)
      }
    }
  }
}

function collectBookRoots(booksDir: string, into: Set<string>): void {
  for (const name of readdirSafe(booksDir)) {
    const candidate = join(booksDir, name)
    if (existsSync(join(candidate, 'book.json'))) into.add(candidate)
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/* ----------------------------------------------------------------------------
 * 路由面
 * ------------------------------------------------------------------------- */

/** 请求期服务解析：优先复用常驻宿主，缺省回退一次性平面（调用方负责关闭）。 */
interface ResolvedService {
  readonly service: ReconciliationService
  readonly close: () => void
}

function resolveService(root: string): ResolvedService {
  const runtime = getReconciliationRuntime(root)
  if (runtime !== null) {
    return { service: runtime.service, close: () => undefined }
  }
  const safeRoot = assertSafeBookRoot(root)
  const plane = LocalDataPlane.openOrRebuild(safeRoot)
  return { service: plane.reconciliation(), close: () => plane.close() }
}

function sendError(json: (status: number, body: unknown) => void, error: unknown): void {
  if (error instanceof RequestBoundaryError) {
    json(error.status, { ok: false, code: error.code, error: error.message })
    return
  }
  if (error instanceof ReconciliationError) {
    json(409, { ok: false, code: 'RECONCILIATION_CONFLICT', error: error.message })
    return
  }
  json(500, { ok: false, code: 'RECONCILIATION_FAILED', error: (error as Error).message })
}

function readProposalId(body: Record<string, unknown>): string | null {
  const raw = body['proposalId']
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return /^rcln_[0-9A-HJKMNP-TV-Z]{26}$/.test(trimmed) ? trimmed : null
}

/** 存在性前置：未知 id 是 404，状态机冲突（已终态/状态不符）才是 409。 */
function proposalExists(
  service: ReconciliationService,
  proposalId: string,
  json: (status: number, body: unknown) => void,
): boolean {
  if (service.getProposal(proposalId) !== null) return true
  json(404, { ok: false, code: 'PROPOSAL_NOT_FOUND', error: `no proposal ${proposalId}` })
  return false
}

function runtimeView(root: string): Record<string, unknown> {
  const runtime = getReconciliationRuntime(root)
  const attachError = getReconciliationAttachFailure(root)
  if (runtime === null) {
    return { attached: false, attachedAt: null, startupScan: null, watcherIntervalMs: null, attachError }
  }
  return {
    attached: true,
    attachedAt: runtime.attachedAt,
    startupScan: {
      proposedCount: runtime.startupScan.proposed.length,
      draftsExempted: runtime.startupScan.draftsExempted,
    },
    watcherIntervalMs: runtime.watcherIntervalMs,
    attachError,
  }
}

export const reconciliationRoutes: RouteHandler = (req, res, { path, body, json, bookRoot }) => {
  if (req.method !== 'POST') return false
  if (!path.startsWith('/api/reconciliation')) return false

  const root = bookRoot ?? null
  if (root === null) {
    json(400, { ok: false, code: 'BOOK_REQUIRED', error: 'root required' })
    return true
  }

  /* ---- 提案清单（读；常驻宿主缺省时用一次性平面） ---- */
  if (path === '/api/reconciliation.list') {
    let resolved: ResolvedService | null = null
    try {
      resolved = resolveService(root)
      const proposals = resolved.service.listProposals()
      json(200, {
        ok: true,
        proposals,
        openCount: resolved.service.listOpenProposals().length,
        runtime: runtimeView(root),
      })
    } catch (error) {
      sendError(json, error)
    } finally {
      resolved?.close()
    }
    return true
  }

  /* ---- 单提案详情（读） ---- */
  if (path === '/api/reconciliation.get') {
    const proposalId = readProposalId(body)
    if (proposalId === null) {
      json(400, { ok: false, code: 'INVALID_PROPOSAL_ID', error: 'proposalId (rcln_<ULID>) required' })
      return true
    }
    let resolved: ResolvedService | null = null
    try {
      resolved = resolveService(root)
      if (!proposalExists(resolved.service, proposalId, json)) return true
      json(200, { ok: true, proposal: resolved.service.getProposal(proposalId) })
    } catch (error) {
      sendError(json, error)
    } finally {
      resolved?.close()
    }
    return true
  }

  /* ---- 作者门：逐条取舍（全接受 ⇒ applied；混合 ⇒ partially_applied；全拒 ⇒ dismissed） ---- */
  if (path === '/api/reconciliation.decide') {
    const proposalId = readProposalId(body)
    const rawAccepted = body['acceptedItemIds']
    if (proposalId === null) {
      json(400, { ok: false, code: 'INVALID_PROPOSAL_ID', error: 'proposalId (rcln_<ULID>) required' })
      return true
    }
    if (!Array.isArray(rawAccepted) || rawAccepted.some((item) => typeof item !== 'string')) {
      json(400, {
        ok: false,
        code: 'INVALID_ACCEPTED_ITEMS',
        error: 'acceptedItemIds must be an array of strings (use [] to reject every item)',
      })
      return true
    }
    let resolved: ResolvedService | null = null
    try {
      resolved = resolveService(root)
      if (!proposalExists(resolved.service, proposalId, json)) return true
      const proposal = resolved.service.decideItems(proposalId, rawAccepted as string[])
      json(200, { ok: true, proposal })
    } catch (error) {
      sendError(json, error)
    } finally {
      resolved?.close()
    }
    return true
  }

  /* ---- 整份跳过（拒绝升格，文件保持作者改后的样子） ---- */
  if (path === '/api/reconciliation.dismiss') {
    const proposalId = readProposalId(body)
    if (proposalId === null) {
      json(400, { ok: false, code: 'INVALID_PROPOSAL_ID', error: 'proposalId (rcln_<ULID>) required' })
      return true
    }
    let resolved: ResolvedService | null = null
    try {
      resolved = resolveService(root)
      if (!proposalExists(resolved.service, proposalId, json)) return true
      const proposal = resolved.service.dismiss(proposalId)
      json(200, { ok: true, proposal })
    } catch (error) {
      sendError(json, error)
    } finally {
      resolved?.close()
    }
    return true
  }

  /* ---- extract_failed 一键重试 ---- */
  if (path === '/api/reconciliation.retry') {
    const proposalId = readProposalId(body)
    if (proposalId === null) {
      json(400, { ok: false, code: 'INVALID_PROPOSAL_ID', error: 'proposalId (rcln_<ULID>) required' })
      return true
    }
    let resolved: ResolvedService | null = null
    try {
      resolved = resolveService(root)
      if (!proposalExists(resolved.service, proposalId, json)) return true
      const proposal = resolved.service.retryExtraction(proposalId)
      json(200, { ok: true, proposal })
    } catch (error) {
      sendError(json, error)
    } finally {
      resolved?.close()
    }
    return true
  }

  /* ---- 显式检测：确保常驻宿主（必检 + watcher）后做一次全量复核 ---- */
  if (path === '/api/reconciliation.scan') {
    try {
      const runtime = ensureReconciliationRuntime(root)
      // 挂接本身已跑过一次启动必检；本次复核只新建「尚未立过提案」的路径，
      // 故 proposed = 本次新建、openProposals = 当前未决全集（作者门的实际输入）。
      const outcome = runtime.service.scanExternalModifications('startupScan')
      json(200, {
        ok: true,
        proposed: outcome.proposed,
        draftsExempted: outcome.draftsExempted,
        openProposals: runtime.service.listOpenProposals(),
        runtime: runtimeView(root),
      })
    } catch (error) {
      sendError(json, error)
    }
    return true
  }

  return false
}
