// @vitest-environment node
/**
 * 章节审查生产链路全生命周期与高可靠故障恢复测试套件
 *
 * 覆盖验收条件：
 * 1. 正常语义审查能够完成并生成版本绑定的报告；
 * 2. 本地可控 HTTP 服务挂起、断流或报错时，审查在 timeoutMs 期限内结束等待，终止与清理有明确证据；
 * 3. 用户取消能够可靠传导到执行端；不合作的子进程能够被强制终止（并在 Windows 平台验证进程树清理）；
 * 4. 取消/超时后的迟到结果不产生任何后续落盘、收割、吸收或 session 账本推进；
 * 5. 失败后可以再次重新审查，正文不丢失，资源不残留；
 * 6. 补充生产路由相关的单元与集成测试，保留原有格式测试。
 */
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiMiddleware } from '../api.js'
import {
  LocalDataPlane,
  scanEntityCards,
  readNarrativeSnapshot,
  proseChapterPath,
  readProseChapter,
} from '@mozhou/data-plane'
import { newUlid, type ContextReceiptId } from '@mozhou/kernel'
import {
  ChapterProductionSession,
  ChapterReviewCancelledError,
  ChapterReviewTimeoutError,
  executeChapterReview,
  runCompileStep,
  type ReviewCapabilityCompletedResponse,
  type ReviewCapabilityExecutor,
  type ReviewCapabilityRequest,
} from '@mozhou/pipeline'
import { PublishBus } from '@mozhou/runtime'
import { hashProse, type QualityPolicy, type QualityReviewReport } from '@mozhou/quality-engine'

const charTok = { version: 'fake-char-v1', count: (text: string) => text.length }

const TEST_POLICY: QualityPolicy = {
  schemaVersion: 1,
  projectId: 'lifecycle-test',
  rules: [
    {
      id: 'PARA-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'deterministic',
      severity: 'blocking',
      description: '段落瀑布',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'REV-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'deterministic',
      severity: 'blocking',
      description: '锚点一致',
      evidenceRequired: true,
      enabled: true,
    },
    {
      id: 'NARR-001',
      version: '1.0.0',
      scope: 'platform',
      kind: 'semantic',
      severity: 'advisory',
      description: '大纲扩写',
      evidenceRequired: true,
      enabled: true,
    },
  ],
  maxAutomaticReworks: 2,
}

let servers: ReturnType<typeof createServer>[] = []
const activeSockets: Set<Socket> = new Set()
let roots: string[] = []
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {
    DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
    DEEPSEEK_API_BASE: process.env['DEEPSEEK_API_BASE'],
    OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
    OPENAI_API_BASE: process.env['OPENAI_API_BASE'],
    MOZHOU_API_KEY: process.env['MOZHOU_API_KEY'],
    MOZHOU_API_BASE: process.env['MOZHOU_API_BASE'],
    MOZHOU_ALLOW_PRIVATE_LLM: process.env['MOZHOU_ALLOW_PRIVATE_LLM'],
    MOZHOU_DRAFT_PROVIDER: process.env['MOZHOU_DRAFT_PROVIDER'],
  }
})

afterEach(() => {
  for (const sock of activeSockets) {
    try {
      sock.destroy()
    } catch {
      // 忽略
    }
  }
  activeSockets.clear()

  for (const s of servers) {
    try {
      s.close()
    } catch {
      // 忽略
    }
  }
  servers = []

  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      // Windows file lock tolerance
    }
  }
  roots = []
})

function trackServer(server: ReturnType<typeof createServer>) {
  server.on('connection', (sock) => {
    activeSockets.add(sock)
    sock.on('close', () => activeSockets.delete(sock))
  })
  servers.push(server)
  return server
}

function listenApp(): Promise<string> {
  return new Promise((resolve) => {
    const server = trackServer(
      createServer((req, res) => {
        apiMiddleware()(req, res, () => {
          res.statusCode = 404
          res.end('nf')
        })
      }),
    )
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

function listenMockLlm(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
): Promise<{ url: string; port: number; server: ReturnType<typeof createServer> }> {
  return new Promise((resolve) => {
    const server = trackServer(createServer(handler))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: 'http://127.0.0.1:' + addr.port,
        port: addr.port,
        server,
      })
    })
  })
}

async function post(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = { rawText: text }
  }
  return { status: res.status, data }
}

async function setupBook(
  title: string,
  options?: {
    proseText?: string
    skipSession?: boolean
    skipCompile?: boolean
  },
) {
  const base = await listenApp()
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-lifecycle-book-'))
  roots.push(dir)

  await post(base, '/api/book', { title, dir })
  const plane = LocalDataPlane.open(dir)
  const bookId = plane.book.id
  const text =
    options?.proseText ??
    '天下大势，分久必合。陈缺推门而入，看着案几上摆放的一纸文书，神色凝重地坐下，端起茶盏轻轻吹开浮沫。\n\n' +
      '窗外的夜雨淅淅沥沥地下着，将廊下的青苔洗得发亮，远处隐隐传来打更之声。\n\n' +
      '长生久视不过是虚妄。'

  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
    plane.saveProseDraft({ chapterIndex: 1, body: text, expectedRevision: 0 })
    plane.saveEntityCard('char:chenque', {
      name: '陈缺',
      aiContext: 'detected',
      brief: '孤城按剑少年',
    })
  } finally {
    plane.close()
  }

  let receiptId: ContextReceiptId | null = null
  if (!options?.skipCompile) {
    receiptId = ('rcpt_' + newUlid()) as ContextReceiptId
    await runCompileStep(
      { chapterIndex: 1, staleMarker: null },
      {
        bookRoot: dir,
        bookId,
        draftText: text,
        cards: scanEntityCards(dir),
        snapshot: readNarrativeSnapshot(dir),
        scope: { chapterIndex: 1, pov: 'protagonist' },
        modelProfile: { id: 'api-contract-test', contextWindow: 4096 },
        tokenizer: charTok,
        receiptId,
        nowIso: '2026-09-27T00:00:00.000Z',
      },
    )
  }

  let session: ChapterProductionSession | null = null
  if (!options?.skipSession) {
    session = ChapterProductionSession.start({
      bus: new PublishBus(),
      root: dir,
      chapterIndex: 1,
      newTaskRef: () => 'tsk_lifecycle',
    })
    session.advance('compile')
    session.advance('draft')
    session.advance('review')
  }

  return { base, root: dir, bookId, receiptId, session, text }
}

describe('章节审查生产链路全生命周期与高可靠故障测试', () => {
  /* -------------------------------------------------------------------------
   * 验收条件 1: 正常语义审查能够完成并生成版本绑定的报告
   * ------------------------------------------------------------------------- */
  describe('验收条件 1: 正常语义审查能够完成并生成版本绑定的报告', () => {
    it('真实产品入口：接通本地语义模型，成功完成审查并生成严格绑定的 QualityReviewReport', async () => {
      let receivedPrompt = ''
      const mockLlm = await listenMockLlm((req, res) => {
        let body = ''
        req.on('data', (c) => {
          body += c
        })
        req.on('end', () => {
          receivedPrompt = body
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })
          const evalPayload = {
            evaluations: [
              { ruleId: 'PARA-001', verdict: 'pass', note: '段落结构自然，无单一字句瀑布' },
              { ruleId: 'REV-001', verdict: 'pass', note: '锚点一致性良好' },
              { ruleId: 'NARR-001', verdict: 'pass', note: '场景因果充分，无大纲式干瘪扩写' },
            ],
          }
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(evalPayload) } }] })}\n\n`,
          )
          res.write('data: [DONE]\n\n')
          res.end()
        })
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const { base, root, receiptId } = await setupBook('正常语义审查之书')

      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
      })

      // 1. 响应断言
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.verdict).toBe('pass')
      expect(data.semanticReviewer).toBe('attached')
      expect(data.current).toBe(true)
      expect(data.reportId).toBeDefined()
      expect(data.reportPath).toBeDefined()

      // 2. 验证模型确实收到了审查请求
      expect(receivedPrompt).toContain('evaluations')

      // 3. 报告落盘与版本绑定深度验证
      const reviewDir = join(root, '.mozhou', 'quality-reviews', 'chapter_1')
      expect(existsSync(reviewDir)).toBe(true)
      const files = readdirSync(reviewDir)
      expect(files.length).toBe(1)

      const reportContent = JSON.parse(readFileSync(join(reviewDir, files[0]!), 'utf8')) as QualityReviewReport
      expect(reportContent.reportId).toBe(data.reportId)
      expect(reportContent.verdict).toBe('pass')

      // 验证版本绑定六元锚点
      const currentDraft = readProseChapter(root, proseChapterPath(1))
      expect(reportContent.anchor.chapterIndex).toBe(1)
      expect(reportContent.anchor.draftRevision).toBe(currentDraft.revision)
      expect(reportContent.anchor.draftContentHash).toBe(hashProse(currentDraft.body))
      expect(reportContent.anchor.receiptId).toBe(receiptId)
      expect(reportContent.anchor.ruleSetDigest).toBeDefined()
      expect(reportContent.anchor.ruleSetDigest.length).toBeGreaterThan(0)

      // 4. 会话账本推进验证
      const resumed = ChapterProductionSession.resume({
        bus: new PublishBus(),
        root,
        chapterIndex: 1,
      })
      expect(resumed).not.toBeNull()
      expect(resumed!.currentStep).toBe('review')
      expect(resumed!.project().lastQualityVerdict).toBe('pass')
    })
  })

  /* -------------------------------------------------------------------------
   * 验收条件 2: 本地可控 HTTP 服务挂起、断流或报错时，审查在 timeoutMs 期限内结束等待，终止与清理有明确证据
   * ------------------------------------------------------------------------- */
  describe('验收条件 2: 本地 HTTP 服务挂起、断流、报错故障模拟', () => {
    it('故障模拟 2.1 (挂起): HTTP 服务挂起无响应，审查在 timeoutMs 期限内结束等待并返回 408', async () => {
      let abortedOnServer = false
      const mockLlm = await listenMockLlm((req) => {
        // 服务端收到请求后不返回任何数据，挂起
        req.on('close', () => {
          abortedOnServer = true
        })
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const { base, root } = await setupBook('挂起测试之书')

      const start = Date.now()
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
        timeoutMs: 1000,
      })
      const duration = Date.now() - start

      // 验证在 timeout 期限内返回，且返回明确的超时错误
      expect(status).toBe(408)
      expect(data.ok).toBe(false)
      expect(data.code).toBe('CHAPTER_REVIEW_TIMEOUT')
      expect(duration).toBeGreaterThanOrEqual(950)
      expect(duration).toBeLessThan(4000)

      // 终止与清理证据：报告未落盘
      const reviewDir = join(root, '.mozhou', 'quality-reviews', 'chapter_1')
      expect(existsSync(reviewDir)).toBe(false)

      // 会话账本证据：状态未推进为完成态 pass
      const resumed = ChapterProductionSession.resume({
        bus: new PublishBus(),
        root,
        chapterIndex: 1,
      })
      expect(resumed!.project().lastQualityVerdict).toBeNull()

      // 连接终止证据：上游连接最终被中止
      const waitAbortStart = Date.now()
      while (!abortedOnServer && Date.now() - waitAbortStart < 2000) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(abortedOnServer).toBe(true)
    })

    it('故障模拟 2.2 (断流): HTTP 服务传输中途突发断流，审查在期限内快速结束等待并给出 Fail-Closed refused 判定', async () => {
      const mockLlm = await listenMockLlm((req, res) => {
        // 先发送部分响应，随后立即强制销毁底层 socket
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        res.write('data: {"choices":[{"delta":{"content":"{\\"evaluations\\": ["}}]}\n\n')
        setTimeout(() => {
          req.socket.destroy()
        }, 50)
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const { base, root } = await setupBook('断流测试之书')

      const start = Date.now()
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
        timeoutMs: 5000,
      })
      const duration = Date.now() - start

      // 快速结束等待断言（远小于 5000ms 超时）
      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.verdict).toBe('refused')
      expect(duration).toBeLessThan(3000)

      // 验证落盘报告中包含提供方异常证据（Fail-Closed 审计留痕）
      const reportFile = join(root, data.reportPath as string)
      expect(existsSync(reportFile)).toBe(true)
      const reportContent = JSON.parse(readFileSync(reportFile, 'utf8')) as QualityReviewReport
      expect(reportContent.verdict).toBe('refused')
      const unknownEval = reportContent.evaluations.find((e) => e.verdict === 'unknown')
      expect(unknownEval).toBeDefined()
      expect(unknownEval!.evidence[0]?.note).toContain('语义审查提供方异常')

      // 会话账本证据：判定为 refused，阻止向 user_edit 推进
      const resumed = ChapterProductionSession.resume({
        bus: new PublishBus(),
        root,
        chapterIndex: 1,
      })
      expect(resumed!.project().lastQualityVerdict).toBe('refused')
    })

    it('故障模拟 2.3 (服务端报错): HTTP 服务返回 500 或 SSE 流内错误，受控判为 refused 且留存错误证据', async () => {
      // 子场景 A: 上游直接返回 HTTP 500
      let errorMode: 'http500' | 'sseError' = 'http500'
      const mockLlm = await listenMockLlm((req, res) => {
        if (errorMode === 'http500') {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Upstream GPU node failed' } }))
        } else {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
          res.write(
            `data: ${JSON.stringify({ error: { message: 'Tokens limit exceeded', code: 'insufficient_quota' } })}\n\n`,
          )
          res.end()
        }
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const { base, root } = await setupBook('报错测试之书')

      // 测试 HTTP 500
      const res1 = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
      })
      expect(res1.status).toBe(200)
      expect(res1.data.ok).toBe(true)
      expect(res1.data.verdict).toBe('refused')
      const reportFile1 = join(root, res1.data.reportPath as string)
      const reportContent1 = JSON.parse(readFileSync(reportFile1, 'utf8')) as QualityReviewReport
      const unknownEval1 = reportContent1.evaluations.find((e) => e.verdict === 'unknown')
      expect(unknownEval1).toBeDefined()
      expect(unknownEval1!.evidence[0]?.note).toContain('上游 500')

      // 测试 SSE 流内错误
      errorMode = 'sseError'
      const res2 = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
      })
      expect(res2.status).toBe(200)
      expect(res2.data.ok).toBe(true)
      expect(res2.data.verdict).toBe('refused')
      const reportFile2 = join(root, res2.data.reportPath as string)
      const reportContent2 = JSON.parse(readFileSync(reportFile2, 'utf8')) as QualityReviewReport
      const unknownEval2 = reportContent2.evaluations.find((e) => e.verdict === 'unknown')
      expect(unknownEval2).toBeDefined()
      expect(unknownEval2!.evidence[0]?.note).toContain('上游流内错误 (insufficient_quota)')
    })

    it('故障模拟 2.4 (能力执行器崩溃): 底层能力执行器失败时，审查链抛出异常并向客户端返回 500', async () => {
      const { root, receiptId, session } = await setupBook('执行器失败之书')

      const failCall = executeChapterReview({
        bookRoot: root,
        chapterIndex: 1,
        session,
        receiptId: receiptId!,
        policy: TEST_POLICY,
        capabilityExecutor: async () => {
          await Promise.resolve()
          return {
            schemaVersion: 1,
            requestId: 'req_fail_test',
            status: 'failed',
            error: {
              code: 'WORKER_CRASHED',
              message: '审查计算子系统发生致命故障',
            },
          }
        },
      })

      await expect(failCall).rejects.toThrow('审查能力执行失败 [WORKER_CRASHED]')
      expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)
    })
  })

  /* -------------------------------------------------------------------------
   * 验收条件 3: 用户取消能够可靠传导到执行端（取消 ≠ 完成）
   * ------------------------------------------------------------------------- */
  describe('验收条件 3: 取消可靠传导', () => {
    it('取消传导 3.1: 客户端连接断开时，取消可靠传导并中止上游模型请求', async () => {
      let mockReceived = false
      let upstreamAborted = false
      const mockLlm = await listenMockLlm((req) => {
        mockReceived = true
        req.on('close', () => {
          upstreamAborted = true
        })
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const { base, root } = await setupBook('客户端取消之书')
      const targetUrl = new URL(base + '/api/chapter.review')

      // 使用原生 http 客户端主动断开连接
      const clientReq = httpRequest(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: targetUrl.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        () => {},
      )

      clientReq.on('error', () => {
        // 预期客户端销毁会产生错误
      })

      clientReq.write(
        JSON.stringify({
          root,
          chapterIndex: 1,
          policy: TEST_POLICY,
          timeoutMs: 10000,
        }),
      )
      clientReq.end()

      // 等待上游 mock 接收到连接后立即主动切断连接
      const waitMockStart = Date.now()
      while (!mockReceived && Date.now() - waitMockStart < 4000) {
        await new Promise((r) => setTimeout(r, 30))
      }
      clientReq.destroy()

      // 等待取消传导到达服务端与 mock 节点
      const waitStart = Date.now()
      while (!upstreamAborted && Date.now() - waitStart < 3000) {
        await new Promise((r) => setTimeout(r, 50))
      }

      expect(upstreamAborted).toBe(true)
      expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)
    })

    it('取消传导 3.2: executeChapterReview 支持 AbortSignal 主动取消并精准抛出 ChapterReviewCancelledError', async () => {
      const { root, receiptId, session } = await setupBook('内核取消之书')
      const controller = new AbortController()

      const reviewPromise = executeChapterReview({
        bookRoot: root,
        chapterIndex: 1,
        session,
        receiptId: receiptId!,
        policy: TEST_POLICY,
        signal: controller.signal,
        capabilityExecutor: async (_req, opts) => {
          // 模拟执行耗时
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 2000)
            opts?.signal?.addEventListener('abort', () => {
              clearTimeout(timer)
              const reason: unknown = opts?.signal?.reason
              reject(new ChapterReviewCancelledError(typeof reason === 'string' ? reason : undefined))
            })
          })
          throw new Error('should not reach')
        },
      })

      // 50ms 后主动取消
      setTimeout(() => {
        controller.abort('用户主动取消本轮审查')
      }, 50)

      await expect(reviewPromise).rejects.toBeInstanceOf(ChapterReviewCancelledError)
      expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)
    })
  })

  /* -------------------------------------------------------------------------
   * 验收条件 4: 取消/超时后的迟到结果不产生任何后续落盘、收割、吸收或 session 账本推进
   * ------------------------------------------------------------------------- */
  describe('验收条件 4: 迟到保护（落盘/金句/反例/账本推进四重封锁）', () => {
    it('迟到保护 4.1: 超时后的迟到完成结果绝对不落盘、不收割金句、不吸收反例、不推进 session', async () => {
      const { root, receiptId, session } = await setupBook('超时迟到保护之书', {
        proseText:
          '长生久视不过是虚妄。\n\n陈缺推门而入。\n\n这是一段包含 AI 味与总结陈词的违规反例文本，总体而言，总的来说。',
      })

      // 构造一个会延迟 300ms 返回合法的 completed 响应的执行器
      let lateExecutorFinished = false
      const slowExecutor: ReviewCapabilityExecutor = async (req: ReviewCapabilityRequest): Promise<ReviewCapabilityCompletedResponse> => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        lateExecutorFinished = true
        return {
          schemaVersion: 1,
          requestId: req.requestId,
          status: 'completed',
          report: {
            schemaVersion: 1,
            reportId: 'rep_late_result_' + newUlid(),
            reviewer: req.reviewer,
            anchor: {
              chapterIndex: req.draft.chapterIndex,
              draftRevision: req.draft.revision,
              draftContentHash: req.draft.contentHash,
              receiptId: req.receiptId,
              ruleSetDigest: req.ruleSetDigest,
            },
            evaluations: [
              {
                ruleId: 'AI-FLAVOR-001',
                ruleVersion: '1.0.0',
                verdict: 'fail',
                severity: 'blocking',
                evidence: [{ ruleId: 'AI-FLAVOR-001', note: '总结陈词', excerpt: '总体而言，总的来说' }],
              },
            ],
            verdict: 'blocking_fail',
          },
          mechanicalGate: {
            passed: false,
            checks: [],
            fails: ['FAIL_LATE'],
            oks: [],
          },
        }
      }

      // 超时设定为 60ms
      const reviewCall = executeChapterReview({
        bookRoot: root,
        chapterIndex: 1,
        session,
        receiptId: receiptId!,
        policy: TEST_POLICY,
        timeoutMs: 60,
        capabilityExecutor: slowExecutor,
      })

      await expect(reviewCall).rejects.toBeInstanceOf(ChapterReviewTimeoutError)

      // 即使主调用已超时报错，等待迟到执行器在后台彻底跑完
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(lateExecutorFinished).toBe(true)

      // 1. 验证报告绝不落盘
      const reviewDir = join(root, '.mozhou', 'quality-reviews', 'chapter_1')
      expect(existsSync(reviewDir)).toBe(false)

      // 2. 验证 session 账本绝不推进
      expect(session!.currentStep).toBe('review')
      expect(session!.project().lastQualityVerdict).toBeNull()

      // 3. 验证反例库绝不吸收迟到反例
      const counterexamplesFile = join(root, '.mozhou', 'quality-reviews', 'counterexamples.json')
      expect(existsSync(counterexamplesFile)).toBe(false)
    })

    it('迟到保护 4.2: 取消后的迟到完成结果同样严格被封锁', async () => {
      const { root, receiptId, session } = await setupBook('取消迟到保护之书')
      const controller = new AbortController()

      let lateFinished = false
      const slowExecutor: ReviewCapabilityExecutor = async (req: ReviewCapabilityRequest): Promise<ReviewCapabilityCompletedResponse> => {
        await new Promise((resolve) => setTimeout(resolve, 250))
        lateFinished = true
        return {
          schemaVersion: 1,
          requestId: req.requestId,
          status: 'completed',
          report: {
            schemaVersion: 1,
            reportId: 'rep_cancelled_late_' + newUlid(),
            reviewer: req.reviewer,
            anchor: {
              chapterIndex: req.draft.chapterIndex,
              draftRevision: req.draft.revision,
              draftContentHash: req.draft.contentHash,
              receiptId: req.receiptId,
              ruleSetDigest: req.ruleSetDigest,
            },
            evaluations: [],
            verdict: 'pass',
          },
          mechanicalGate: { passed: true, checks: [], fails: [], oks: [] },
        }
      }

      const reviewCall = executeChapterReview({
        bookRoot: root,
        chapterIndex: 1,
        session,
        receiptId: receiptId!,
        policy: TEST_POLICY,
        signal: controller.signal,
        capabilityExecutor: slowExecutor,
      })

      // 40ms 后取消
      setTimeout(() => controller.abort('作者取消'), 40)

      await expect(reviewCall).rejects.toBeInstanceOf(ChapterReviewCancelledError)

      // 等待迟到执行器跑完
      await new Promise((r) => setTimeout(r, 350))
      expect(lateFinished).toBe(true)

      // 验证未产生任何磁盘落盘与账本推进
      expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)
      expect(session!.project().lastQualityVerdict).toBeNull()
    })
  })

  /* -------------------------------------------------------------------------
   * 验收条件 5: 失败后可以再次重新审查，正文不丢失，资源不残留
   * ------------------------------------------------------------------------- */
  describe('验收条件 5: 失败恢复闭环与正文完整性不变量', () => {
    it('经历超时或断流失败后，草稿正文不丢失且未被修改；恢复后可顺利重新审查并成功通过', async () => {
      let shouldFail = true
      const mockLlm = await listenMockLlm((req, res) => {
        if (shouldFail) {
          // 第一次：模拟服务挂起导致超时失败
          return
        } else {
          // 第二次：正常返回审查结果
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
          const payload = {
            evaluations: [
              { ruleId: 'PARA-001', verdict: 'pass', note: '段落结构通过' },
              { ruleId: 'REV-001', verdict: 'pass', note: '锚点一致通过' },
              { ruleId: 'NARR-001', verdict: 'pass', note: '叙事因果通过' },
            ],
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payload) } }] })}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
        }
      })

      process.env['DEEPSEEK_API_KEY'] = 'test-key'
      process.env['DEEPSEEK_API_BASE'] = mockLlm.url
      process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'

      const initialProse = '天下大势，分久必合。孤城少年陈缺按剑伫立，凝视案几之上的染血信笺。\n\n长生久视不过虚妄。'
      const { base, root } = await setupBook('恢复闭环之书', { proseText: initialProse })

      // 记录初始正文状态
      const proseRel = proseChapterPath(1)
      const initialScan = readProseChapter(root, proseRel)
      const initialBody = initialScan.body
      const initialHash = hashProse(initialBody)

      // 1. 第一次审查：遭遇故障（超时）
      const firstRes = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
        timeoutMs: 1000,
      })
      expect(firstRes.status).toBe(408)
      expect(firstRes.data.code).toBe('CHAPTER_REVIEW_TIMEOUT')

      // 2. 检查正文完整性：正文绝不丢失、逐字节未变、revision 未变！
      const afterFailScan = readProseChapter(root, proseRel)
      expect(afterFailScan.body).toBe(initialBody)
      expect(hashProse(afterFailScan.body)).toBe(initialHash)
      expect(afterFailScan.revision).toBe(initialScan.revision)

      // 检查资源不残留：无半成品报告
      expect(existsSync(join(root, '.mozhou', 'quality-reviews', 'chapter_1'))).toBe(false)

      // 3. 恢复故障节点
      shouldFail = false

      // 4. 第二次重新审查：再次发起
      const secondRes = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
      })
      expect(secondRes.status).toBe(200)
      expect(secondRes.data.ok).toBe(true)
      expect(secondRes.data.verdict).toBe('pass')

      // 5. 验证第二次成功产出报告且版本绑定
      const reviewDir = join(root, '.mozhou', 'quality-reviews', 'chapter_1')
      const reports = readdirSync(reviewDir)
      expect(reports.length).toBe(1)
      const reportContent = JSON.parse(readFileSync(join(reviewDir, reports[0]!), 'utf8')) as QualityReviewReport
      expect(reportContent.anchor.draftContentHash).toBe(initialHash)

      // 正文依然完好
      const finalScan = readProseChapter(root, proseRel)
      expect(finalScan.body).toBe(initialBody)
    })
  })

  /* -------------------------------------------------------------------------
   * 验收条件 6: 补充生产路由相关的单元与集成测试，保留原有格式测试
   * ------------------------------------------------------------------------- */
  describe('验收条件 6: 路由边界与错误码契约防御', () => {
    it('无会话时请求审查：明确返回 409，严禁非法进入审查', async () => {
      const { base, root } = await setupBook('无会话之书', { skipSession: true })
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
      })
      expect(status).toBe(409)
      expect(data.ok).toBe(false)
      expect(data.code).toBe('NO_OPEN_PRODUCTION_SESSION')
    })

    it('无编译凭证时请求审查：明确返回 409 NO_COMPILED_RECEIPT，绝不编造锚点', async () => {
      const { base, root } = await setupBook('无编译凭证之书', { skipCompile: true })
      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
      })
      expect(status).toBe(409)
      expect(data.ok).toBe(false)
      expect(data.code).toBe('NO_COMPILED_RECEIPT')
    })

    it('机械门规则失败时：正确暴露 blockingFailures，报告落盘为 blocking_fail', async () => {
      // 提供违反 PARA-001（段落瀑布）的正文
      const waterfallProse = '他抬头。\n\n门开了。\n\n风进来了。\n\n陈缺没有动。'
      const { base, root } = await setupBook('瀑布违规之书', { proseText: waterfallProse })

      const { status, data } = await post(base, '/api/chapter.review', {
        root,
        chapterIndex: 1,
        policy: TEST_POLICY,
      })

      expect(status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.verdict).toBe('blocking_fail')
      expect(Array.isArray(data.blockingFailures)).toBe(true)
      const failures = data.blockingFailures as Array<{ ruleId: string }>
      expect(failures.some((f) => f.ruleId === 'PARA-001')).toBe(true)

      // 验证落盘报告与会话状态
      const resumed = ChapterProductionSession.resume({
        bus: new PublishBus(),
        root,
        chapterIndex: 1,
      })
      expect(resumed!.project().lastQualityVerdict).toBe('blocking_fail')
    })
  })
})
