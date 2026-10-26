/**
 * 出站请求的**地址绑定**传输层（SSRF 防护的第二半：校验与连接使用同一解析结果）。
 *
 * 为什么需要：`ssrfGuard` 只做字面 host / IP 网段分类，`openaiStream.assertSafeRemoteTarget`
 * 做 DNS 前检——但「校验用的解析结果」与「真正连接时的解析结果」是两次独立查询，
 * 中间存在 TOCTOU（DNS rebinding：前检解析到公网 IP，连接时解析到 127.0.0.1）。
 *
 * 本仓的 Node 内置 fetch（undici）无法注入 dispatcher（undici 不是依赖，只有类型包），
 * 因此这里用 `node:https` / `node:http` 的 `lookup` 注入把连接固定到**已验证地址**：
 * - URL 的 host 保持不变 ⇒ Host 头、TLS SNI（servername 默认取 hostname）与证书校验
 *   仍按原域名进行——不是「把 URL 换成 IP」；
 * - lookup 只回已验证地址 ⇒ 不会发生第二次解析。
 *
 * 与原生 fetch 的等价性（T1/T2）：fetch 会自己发 Accept-Encoding 并透明解压，
 * 也会在取消时给出 AbortError。本模块显式补上这两件事——解压走 `decodeBody`，
 * 取消分类走 `normalizeAbort`——否则 SSE 会解析出零事件、HTML 会变乱码，
 * 而取消会被下游误判成网络故障。
 *
 * 本模块**不含任何 SSRF 策略**：策略（协议白名单、私有/保留网段判定）留在调用方
 * （`llm/openaiStream.ts` 的 LLM 侧、`crawlers/provider-utils.ts` 的爬虫侧），
 * 调用方解析并校验后把地址交进来。字面 IP 或部署者显式授权的本机端点不传 addresses，
 * 此时不注入 lookup（交由系统解析，与既有行为一致）。
 */
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { pipeline, type Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { abortReason } from './abortWait.js'

export interface PinnedAddress {
  readonly address: string
  readonly family: number
}

export interface PinnedRequestInit {
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: string | undefined
  readonly signal?: AbortSignal | undefined
  /**
   * 已验证的解析结果。提供且非空时，连接固定到这些地址；不提供时交由系统解析
   * （字面 IP 端点 / 部署者授权的本机端点）。
   */
  readonly addresses?: readonly PinnedAddress[] | undefined
}

export interface PinnedResponse {
  readonly status: number
  readonly ok: boolean
  /**
   * 响应体（已按 Content-Encoding 解压的 Buffer 块流）；无体时为 null。
   * 与 `text()` 共用同一条底层流——二者只能取其一，重复读会二次消费。
   */
  readonly stream: AsyncIterable<Buffer> | null
  readonly headers: { get(name: string): string | null }
  /** 读全响应体为文本（测试连接 / 爬虫单页抓取用）；与 `stream` 共用同一条解压路径。 */
  text(): Promise<string>
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void

/** 与原生 fetch 的默认协商一致（undici 默认发 gzip, deflate）。 */
const DEFAULT_ACCEPT_ENCODING = 'gzip, deflate'

/** 只回已验证地址的 lookup：杜绝「校验后 DNS 变化导致连接到别的地址」。 */
function makePinnedLookup(addresses: readonly PinnedAddress[]) {
  return (_hostname: string, options: unknown, callback: LookupCallback): void => {
    const wantsAll = (options as { all?: boolean } | undefined)?.all === true
    if (wantsAll) {
      callback(null, addresses.map((entry) => ({ address: entry.address, family: entry.family })))
      return
    }
    const first = addresses[0]!
    callback(null, first.address, first.family)
  }
}

/**
 * 按 Content-Encoding 解压响应体。原生 fetch 透明解压，本传输层必须自己做，
 * 否则 SSE 解析出零事件、HTML 变压缩乱码（T1）。
 * 未知编码**显式失败**，绝不把乱码当正文交给调用方；解压失败由流错误如实上抛。
 */
function decodeBody(res: IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase()
  if (encoding === '' || encoding === 'identity') return res
  const decoder = encoding === 'gzip' || encoding === 'x-gzip' ? createGunzip()
    : encoding === 'deflate' ? createInflate()
      : encoding === 'br' ? createBrotliDecompress() : null
  if (decoder === null) {
    throw new Error(`上游返回未支持的 Content-Encoding: ${encoding}（已拒绝解码，避免把压缩字节当正文）`)
  }
  // pipe 不传播源错误；pipeline 统一销毁响应与解压器，并使读流收到同一失败。
  pipeline(res, decoder, () => { /* 错误由 decoder 的异步迭代器读取。 */ })
  return decoder
}

/**
 * 取消归一（T2）：响应头到达后，实际读错误来自 IncomingMessage——destroy 会给出
 * ECONNRESET/aborted，请求对象上的 AbortError 覆盖不到这个形状。
 * **仅当本次取消确实生效**（signal.aborted）时归一为中止错误，保住下游分类
 * （`storyboard/generate.ts` 按 name==='AbortError' 判「超时被中止」）；
 * 远端自行断开（signal 未中止）仍是网络失败，不得误报成用户取消。
 */
async function* normalizeAbort(
  stream: AsyncIterable<Buffer>,
  signal: AbortSignal | undefined,
  dispose: () => void,
): AsyncGenerator<Buffer> {
  try {
    for await (const chunk of stream) {
      if (signal?.aborted === true) throw abortReason(signal)
      yield chunk
    }
  } catch (error) {
    if (signal?.aborted === true) throw abortReason(signal)
    throw error
  } finally {
    dispose()
  }
}

async function readAllText(body: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export function pinnedRequest(target: URL, init: PinnedRequestInit): Promise<PinnedResponse> {
  if (init.signal?.aborted === true) {
    return Promise.reject(abortReason(init.signal))
  }
  return new Promise<PinnedResponse>((resolve, reject) => {
    const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
    const headers: Record<string, string> = { ...init.headers }
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'accept-encoding')) {
      headers['Accept-Encoding'] = DEFAULT_ACCEPT_ENCODING
    }
    const options: RequestOptions & { lookup?: ReturnType<typeof makePinnedLookup> } = {
      method: init.method,
      headers,
      // 独立直连：全局 Agent 的环境代理会绕过 lookup 绑定，并可能复用旧 DNS 连接。
      agent: false,
    }
    if (init.addresses !== undefined && init.addresses.length > 0) {
      options.lookup = makePinnedLookup(init.addresses)
    }
    let response: IncomingMessage | undefined
    let decoded: Readable | undefined
    const removeAbort = (): void => init.signal?.removeEventListener('abort', onAbort)
    const dispose = (): void => {
      decoded?.destroy()
      response?.destroy()
      req.destroy()
      removeAbort()
    }
    const req = requestFn(target, options, (res: IncomingMessage) => {
      response = res
      // 响应在消费者开始读取前也可能失败；安装监听防止无人消费的错误变成未捕获异常。
      res.on('error', reject)
      const status = res.statusCode ?? 0
      let body: AsyncIterable<Buffer>
      try {
        decoded = decodeBody(res)
        decoded.once('close', removeAbort)
        body = normalizeAbort(decoded, init.signal, dispose)
      } catch (error) {
        dispose()
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      resolve({
        status,
        ok: status >= 200 && status < 300,
        stream: body,
        headers: {
          get: (name: string) => {
            const value = res.headers[name.toLowerCase()]
            if (value === undefined) return null
            return Array.isArray(value) ? value.join(', ') : value
          },
        },
        text: () => readAllText(body),
      })
    })
    const onAbort = (): void => {
      const error = abortReason(init.signal)
      decoded?.destroy(error)
      response?.destroy(error)
      req.destroy(error)
      removeAbort()
    }
    if (init.signal !== undefined) {
      init.signal.addEventListener('abort', onAbort, { once: true })
    }
    req.on('close', () => {
      // 响应头之后，解压器可能仍有缓存；监听保留到响应体结束或显式释放。
      if (response === undefined) removeAbort()
    })
    req.on('error', (error) => {
      decoded?.destroy(error)
      response?.destroy(error)
      removeAbort()
      reject(error)
    })
    if (init.body !== undefined) {
      // 显式 Content-Length：避免 chunked 传输被部分上游网关拒绝。
      req.setHeader('Content-Length', Buffer.byteLength(init.body))
      req.write(init.body)
    }
    req.end()
  })
}
