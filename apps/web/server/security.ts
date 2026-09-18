import type { IncomingMessage } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export const DEFAULT_MAX_JSON_BODY_BYTES = 1024 * 1024

export class RequestBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RequestBoundaryError'
  }
}

/**
 * 统一文件系统路径守卫（Path Guard）：
 * 1. 验证既有书根的合法性（存在、是目录、包含正典标记 book.json）；
 * 2. 避免客户端传入恶意相对路径或任意目录穿越。
 */
export function assertSafeBookRoot(rawPath: unknown): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new RequestBoundaryError(400, 'INVALID_PATH', 'book root must be a non-empty string')
  }
  const target = resolve(rawPath)
  let stat
  try {
    stat = statSync(target)
  } catch {
    throw new RequestBoundaryError(404, 'BOOK_ROOT_NOT_FOUND', `book root directory not found: ${rawPath}`)
  }
  if (!stat.isDirectory()) {
    throw new RequestBoundaryError(400, 'NOT_A_DIRECTORY', `book root is not a directory: ${rawPath}`)
  }
  const marker = resolve(target, 'book.json')
  if (!existsSync(marker)) {
    throw new RequestBoundaryError(
      400,
      'NOT_A_MOZHOU_BOOK',
      `target directory does not contain a MoZhou book marker (book.json): ${rawPath}`,
    )
  }
  return target
}

/**
 * 校验新建/导入书目的父级目录：
 * 1. 父级必须是真实存在的本地目录；
 * 2. 派生的目标子目录必须严格收敛在父目录范围之内，禁止目录穿越。
 */
export function assertSafeParentDirectory(
  rawParent: unknown,
  childName?: string,
): { readonly parentDir: string; readonly targetDir?: string | undefined } {
  if (typeof rawParent !== 'string' || rawParent.trim().length === 0) {
    throw new RequestBoundaryError(400, 'INVALID_PATH', 'parent directory must be a non-empty string')
  }
  const parentDir = resolve(rawParent)
  let stat
  try {
    stat = statSync(parentDir)
  } catch {
    throw new RequestBoundaryError(404, 'PARENT_DIR_NOT_FOUND', `parent directory does not exist: ${rawParent}`)
  }
  if (!stat.isDirectory()) {
    throw new RequestBoundaryError(400, 'NOT_A_DIRECTORY', `parent path is not a directory: ${rawParent}`)
  }
  if (childName === undefined) {
    return { parentDir }
  }
  const sanitized = childName.replace(/[\\/:*?"<>|]/g, ' ').trim()
  if (!sanitized) {
    throw new RequestBoundaryError(400, 'INVALID_CHILD_NAME', 'derived child directory name must not be empty')
  }
  const targetDir = resolve(parentDir, sanitized)
  const allowedPrefix = parentDir.endsWith(sep) ? parentDir : parentDir + sep
  if (targetDir !== parentDir && !targetDir.startsWith(allowedPrefix)) {
    throw new RequestBoundaryError(403, 'PATH_TRAVERSAL_BLOCKED', 'child directory escapes parent directory')
  }
  return { parentDir, targetDir }
}

function normalizeHostHeader(value: string): string {
  return value.trim().toLowerCase()
}

function hostNameOnly(value: string): string {
  const host = normalizeHostHeader(value)
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end >= 0 ? host.slice(1, end) : host
  }
  const colon = host.lastIndexOf(':')
  return colon > 0 ? host.slice(0, colon) : host
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1') return true
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true
  return false
}

export function assertTrustedRequest(req: IncomingMessage): void {
  const rawHost = req.headers.host
  if (typeof rawHost !== 'string' || !isLoopbackHostname(hostNameOnly(rawHost))) {
    throw new RequestBoundaryError(403, 'UNTRUSTED_HOST', 'request Host must resolve to loopback')
  }

  const origin = req.headers.origin
  if (origin === undefined) return
  if (Array.isArray(origin)) {
    throw new RequestBoundaryError(403, 'UNTRUSTED_ORIGIN', 'multiple Origin values are not accepted')
  }

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new RequestBoundaryError(403, 'UNTRUSTED_ORIGIN', 'invalid Origin header')
  }

  const expectedHost = normalizeHostHeader(rawHost)
  if (!isLoopbackHostname(parsed.hostname) || normalizeHostHeader(parsed.host) !== expectedHost) {
    throw new RequestBoundaryError(403, 'UNTRUSTED_ORIGIN', 'browser Origin must match the loopback API origin')
  }
}

export function readJsonBody(
  req: IncomingMessage,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false

    const fail = (error: RequestBoundaryError): void => {
      if (settled) return
      settled = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.resume()
      reject(error)
    }

    const onData = (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        fail(new RequestBoundaryError(413, 'BODY_TOO_LARGE', `JSON request body exceeds ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    }

    const onEnd = (): void => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim().length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw) as unknown
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new RequestBoundaryError(400, 'INVALID_JSON', 'JSON request body must be an object'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        if (error instanceof RequestBoundaryError) {
          reject(error)
        } else {
          reject(new RequestBoundaryError(400, 'INVALID_JSON', 'malformed JSON request body'))
        }
      }
    }

    const onError = (): void => {
      fail(new RequestBoundaryError(400, 'REQUEST_READ_FAILED', 'failed to read request body'))
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/* ============================================================================
 * 本地进程 Bootstrap Token 守卫
 * ========================================================================== */

let currentBootstrapToken: string = randomBytes(32).toString('hex')

export function getBootstrapToken(): string {
  return currentBootstrapToken
}

export function rotateBootstrapToken(): string {
  currentBootstrapToken = randomBytes(32).toString('hex')
  return currentBootstrapToken
}

export function verifyBootstrapToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  const expected = Buffer.from(currentBootstrapToken, 'utf8')
  const actual = Buffer.from(candidate, 'utf8')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function assertBootstrapToken(req: IncomingMessage): void {
  const token = req.headers['x-mozhou-bootstrap-token']
  if (!verifyBootstrapToken(token)) {
    throw new RequestBoundaryError(403, 'UNAUTHORIZED_BOOTSTRAP', 'valid bootstrap token required')
  }
}

/* ============================================================================
 * Cookie 与 CSRF 令牌解析
 * ========================================================================== */

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {}
  const raw = req.headers.cookie
  if (!raw) return list
  for (const part of raw.split(';')) {
    const pair = part.split('=')
    const key = pair[0]?.trim()
    if (key) {
      list[key] = decodeURIComponent(pair.slice(1).join('=').trim())
    }
  }
  return list
}

export function assertValidCsrfToken(req: IncomingMessage, expectedToken: string): void {
  const headerToken = req.headers['x-csrf-token']
  const token = typeof headerToken === 'string' ? headerToken.trim() : null
  if (!token || token !== expectedToken) {
    throw new RequestBoundaryError(403, 'INVALID_CSRF_TOKEN', 'CSRF token mismatch or missing')
  }
}

/* ============================================================================
 * 简单滑动窗口限速器 (RateLimiter)
 * ========================================================================== */

export class RateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly maxAttempts: number = 5,
    private readonly windowMs: number = 60 * 1000,
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const record = this.attempts.get(key)
    if (!record || record.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs })
      return { allowed: true }
    }
    if (record.count >= this.maxAttempts) {
      return { allowed: false, retryAfterMs: record.resetAt - now }
    }
    record.count += 1
    return { allowed: true }
  }

  reset(key: string): void {
    this.attempts.delete(key)
  }

  clear(): void {
    this.attempts.clear()
  }
}
