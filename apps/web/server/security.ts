import type { IncomingMessage } from 'node:http'

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
