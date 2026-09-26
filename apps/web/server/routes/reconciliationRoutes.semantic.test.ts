// @vitest-environment node
/**
 * T28/T29 接线黑盒：对账落定出口 → 语义分析批次（真 LLM 适配器）。
 *
 * 走的是生产入口链：`POST /api/reconciliation.{scan,decide}` →
 * `ReconciliationService.finalize` → `onSettled` → `propagateSettledChanges`
 * → `dispatchSettledSemanticAnalysis` → `runSemanticBatch` → `analyzeSemantic`
 * → `AnalyzeDeps.evaluate`（BYOK 真端点）。上游换成记录请求体的本机 fake
 * OpenAI-compatible 服务，于是「批次是否真的接通、锚点是否真的来自编译凭证」
 * 可以被直接读出来：报告文件 + SemanticAnalyzed 指针行 + 派生投影行 + 上游请求体。
 *
 * 覆盖的失败路径与不变量：
 *   - 上游返回非 JSON ⇒ 不产报告、落 refusal 指针（显式，绝不静默 mock）；
 *   - 无 BYOK 端点 ⇒ L0 显式跳过：零报告、零指针事件、上游零请求；
 *   - 受影响章无编译凭证 ⇒ 跳过该章、不伪造 receiptId/recomputationHash 锚点；
 *   - 逐章单报 + 逐章摘要指纹：两章各读一条上游变更 ⇒ 两份报告、指纹互不相同；
 *   - 解析器严格性：非对象 / verdict 非法 / findings 形状非法一律抛错。
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalDataPlane, createBook, readNarrativeSnapshot, scanEntityCards } from '@mozhou/data-plane'
import { countSemanticReports, readSemanticReports, selectSemanticAnalysisRows } from '@mozhou/flywheel'
import { readPipelineLedger, runCompileStep } from '@mozhou/pipeline'
import { newUlid } from '@mozhou/kernel'
import { parseSemanticReply } from '../llm/semanticEvaluator.js'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import { stopAllReconciliationRuntimes } from './reconciliationRoutes.js'

const FACT_STREAM_REL = '追踪/事实.jsonl'
const NOW = '2026-09-26T00:00:00.000Z'
const charTok = { version: 'fake-char-v1', count: (text: string) => text.length }

/**
 * 非真实凭据：仅用于满足 BYOK 端点解析的「有 key」判据，值本身不参与任何断言，
 * 也不指向任何真实服务（上游是本机 fake）。沿 ssrf-hardening.test.ts 同款常量名，
 * 避免在源码里写出凭据形状字面量。
 */
const OUTBOUND_STUB = 'test-key'

const ENV_KEYS = [
  'MOZHOU_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'MOZHOU_API_BASE',
  'MOZHOU_MODEL',
  'MOZHOU_ALLOW_PRIVATE_LLM',
] as const

let servers: ReturnType<typeof createServer>[] = []
let dirs: string[] = []
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  stopAllReconciliationRuntimes()
  for (const s of servers) s.close()
  servers = []
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // Windows 文件锁容忍
    }
  }
  dirs = []
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.restoreAllMocks()
})

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** 记录每次上游 chat/completions 请求体的 fake provider；回复内容可注入。 */
interface Upstream {
  readonly baseUrl: string
  readonly bodies: Record<string, unknown>[]
  reply: string
}

async function startUpstream(initialReply: string): Promise<Upstream> {
  const bodies: Record<string, unknown>[] = []
  const state = { reply: initialReply }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: state.reply } }] }) + '\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    bodies,
    get reply() {
      return state.reply
    },
    set reply(value: string) {
      state.reply = value
    },
  }
}

function startApi(): Promise<string> {
  return new Promise((resolve) => {
    const router = createMoZhouApiRouter()
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: 'not found' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    })
  })
}

async function post(
  base: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

/** 真实 provider 分支公共前置：BYOK 端点指向本机 fake 上游（仅本测试内使用逃生位）。 */
function armRealProvider(upstream: Upstream): void {
  process.env['MOZHOU_API_KEY'] = OUTBOUND_STUB
  process.env['MOZHOU_API_BASE'] = upstream.baseUrl
  process.env['MOZHOU_MODEL'] = 'semantic-test-model'
  process.env['MOZHOU_ALLOW_PRIVATE_LLM'] = '1'
}

function disarmProvider(): void {
  delete process.env['MOZHOU_API_KEY']
  delete process.env['DEEPSEEK_API_KEY']
  delete process.env['OPENAI_API_KEY']
  delete process.env['MOZHOU_API_BASE']
  delete process.env['MOZHOU_MODEL']
}

function bookIdOf(root: string): string {
  return (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: string }).id
}

function makeFactRow(bookId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    id: `fact_${newUlid()}`,
    bookId,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    subject: 'char:linwan',
    predicate: 'located',
    value: '墨舟',
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'author', protectedUserContent: true },
    ...overrides,
  }
}

interface SeededBook {
  readonly root: string
  /** 逐章钉版的上游事实 id（数组下标 = 章号 - 1）。 */
  readonly factIds: readonly string[]
  /** 逐章编译凭证 id（withReceipts=false 时为空数组）。 */
  readonly receiptIds: readonly string[]
}

/**
 * 生产序造书：逐章编译（产 ContextCompiled 平铺指针 + receipt 文件）→ 提交（钉版该章事实@0）。
 *
 * **不开会话窗口**：与真实旅程同形——apps/web/src 内 grep 'api/session' 零命中，
 * 作者走 /api/draft.stream → buildDraftContext → runCompileStep
 * （pipelineRoutes.ts:382 / draftContext.ts:138），只落平铺 ContextCompiled 行。
 * `withReceipts=false` 时不跑编译，用于「受影响章无凭证」的诚实负例。
 */
async function seedPinnedBook(dir: string, chapterCount: number, withReceipts: boolean): Promise<SeededBook> {
  const created = createBook({ dir, title: '语义落定书' })
  const factIds = Array.from({ length: chapterCount }, () => `fact_${newUlid()}`)
  const receiptIds: string[] = []

  const plane = LocalDataPlane.open(dir)
  try {
    plane.saveEntityCard('char:lin-xuan', {
      name: '林枫',
      aiContext: 'detected',
      aliases: [{ text: '枫儿', kind: 'exact' }],
      brief: '青云宗外门弟子佩剑听雨',
    })
    for (let chapterIndex = 1; chapterIndex <= chapterCount; chapterIndex += 1) {
      plane.createChapterDraft({ chapterIndex, title: `第${chapterIndex}章` })
    }
  } finally {
    plane.close()
  }

  if (withReceipts) {
    for (let chapterIndex = 1; chapterIndex <= chapterCount; chapterIndex += 1) {
      const receiptId = `rcpt_${newUlid()}`
      receiptIds.push(receiptId)
      await runCompileStep(
        { chapterIndex, staleMarker: null },
        {
          bookRoot: dir,
          bookId: bookIdOf(dir) as never,
          draftText: '枫儿踏入山门，雨声敲在剑鞘上。',
          cards: scanEntityCards(dir),
          snapshot: readNarrativeSnapshot(dir),
          scope: { chapterIndex, pov: 'protagonist' },
          modelProfile: { id: 'semantic-settled-test', contextWindow: 4096 },
          tokenizer: charTok,
          receiptId: receiptId as never,
          nowIso: NOW,
        },
      )
    }
  }

  const plane2 = LocalDataPlane.open(dir)
  try {
    for (let chapterIndex = 1; chapterIndex <= chapterCount; chapterIndex += 1) {
      const factId = factIds[chapterIndex - 1]!
      plane2.commitChapter({
        chapterIndex,
        summary: `第${chapterIndex}章提交`,
        dependencyManifest: { entries: [{ kind: 'temporalFact', id: factId, revision: 0 }] },
        appends: { temporalFact: [makeFactRow(created.book.id, { id: factId, value: `墨舟-${chapterIndex}` })] },
      })
    }
  } finally {
    plane2.close()
  }
  return { root: dir, factIds, receiptIds }
}

/** 把追踪流每行都改版（revision 0 → 1）后立提案，返回提案 id。 */
async function proposeStreamEdit(base: string, root: string): Promise<string> {
  const streamAbs = join(root, FACT_STREAM_REL)
  const lines = readFileSync(streamAbs, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  for (let index = 0; index < lines.length; index += 1) {
    const row = JSON.parse(lines[index] ?? '{}') as Record<string, unknown>
    lines[index] = JSON.stringify({ ...row, value: `${String(row['value'])}-改`, revision: 1 })
  }
  writeFileSync(streamAbs, `${lines.join('\n')}\n`, 'utf8')

  const scan = await post(base, '/api/reconciliation.scan', { root })
  const proposals = scan.json['openProposals'] as Record<string, unknown>[]
  const proposal = proposals.find((candidate) => candidate['relPath'] === FACT_STREAM_REL)
  expect(proposal, `expected a proposal for ${FACT_STREAM_REL}, got ${JSON.stringify(proposals)}`).toBeDefined()
  return proposal!['proposalId'] as string
}

/**
 * 全接受（含 'whole' 与每条行级条目）：追踪流的行级条目不在 'whole' 的语义里，
 * 只传 'whole' 会落 partially_applied 并把改版行写进抑制账本 ⇒ 上游变更表为空。
 * 语义批次要求「真正升格进投影」的变更，故此处逐条接受。
 */
async function acceptEverything(base: string, root: string, proposalId: string): Promise<Record<string, unknown>> {
  const got = await post(base, '/api/reconciliation.get', { root, proposalId })
  const proposal = got.json['proposal'] as Record<string, unknown>
  const summary = proposal['summary'] as Record<string, unknown>
  const accepted = new Set<string>(['whole'])
  for (const change of (summary['changes'] ?? []) as { seq: number }[]) accepted.add(`change:${change.seq}`)
  for (const addition of (summary['additions'] ?? []) as { seqOnDisk: number }[]) accepted.add(`add:${addition.seqOnDisk}`)
  for (const removal of (summary['removals'] ?? []) as { seq: number }[]) accepted.add(`remove:${removal.seq}`)
  const decided = await post(base, '/api/reconciliation.decide', {
    root,
    proposalId,
    acceptedItemIds: [...accepted],
  })
  expect(decided.status).toBe(200)
  return decided.json
}

interface SemanticPointerRow {
  readonly taskRef: string
  readonly chapterIndex?: number
  readonly payload: Record<string, unknown>
}

/** 账本里全部 SemanticAnalyzed 指针行（任务行格式；PublishBus 单口写入）。 */
function semanticPointerRows(root: string): SemanticPointerRow[] {
  const rows: SemanticPointerRow[] = []
  for (const row of readPipelineLedger(root)) {
    if (row.kind !== 'task' || row.event.type !== 'SemanticAnalyzed') continue
    rows.push({
      taskRef: row.event.taskRef,
      ...(row.event.chapterIndex === undefined ? {} : { chapterIndex: row.event.chapterIndex }),
      payload: row.event.payload ?? {},
    })
  }
  return rows
}

const REPLY_ATTENTION = JSON.stringify({
  verdict: 'attention',
  findings: [
    { severity: 'warning', code: 'upstream_canon_drift', message: '上游正典变更波及本章，建议人工复核。' },
  ],
})

/* ========================================================================== */

describe('落定出口 → 语义分析批次（T28/T29 生产接线）', () => {
  it('外部改追踪流 → 落定 → 逐章真 LLM 报告落盘 + SemanticAnalyzed 指针 + 派生投影行', async () => {
    const upstream = await startUpstream(REPLY_ATTENTION)
    const dataRoot = tmp('mozhou-semantic-data-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, receiptIds, factIds } = await seedPinnedBook(join(dataRoot, 'book-a'), 2, true)
    armRealProvider(upstream)
    const base = await startApi()

    // 与真实旅程同形的守卫：账本里没有任何 TaskStarted（作者从不调 /api/session.open）。
    // 若有人把锚点解析改回 projectSession().lastReceiptId（只认会话窗口内指针），
    // 本用例会立刻转红——这正是本票修掉的「接线空转」缺陷。
    expect(
      readPipelineLedger(root).some((row) => row.kind === 'task' && row.event.type === 'TaskStarted'),
    ).toBe(false)

    const proposalId = await proposeStreamEdit(base, root)
    const decided = await acceptEverything(base, root, proposalId)
    expect((decided['proposal'] as Record<string, unknown>)['state']).toBe('applied')

    await vi.waitFor(
      () => {
        expect(countSemanticReports(root)).toBe(2)
      },
      { timeout: 8_000, interval: 25 },
    )

    // 逐章单报（D12）：两章各一次真上游调用，正文含该章锚点。
    expect(upstream.bodies).toHaveLength(2)
    const contents = upstream.bodies.map((body) => {
      const messages = (body as { messages: { role: string; content: string }[] }).messages
      expect(messages).toHaveLength(2)
      return messages[1]!.content
    })
    expect(contents[0]).toContain(receiptIds[0])
    expect(contents[0]).toContain('"chapterIndex":1')
    expect(contents[1]).toContain(receiptIds[1])
    expect(contents[1]).toContain('"chapterIndex":2')

    const reports = [...readSemanticReports(root)].sort((a, b) => (a.anchor.chapterIndex ?? 0) - (b.anchor.chapterIndex ?? 0))
    expect(reports).toHaveLength(2)

    // 锚点真源 = 该章编译凭证（D10：receiptId + recomputationHash + taskType）。
    expect(reports.map((report) => report.anchor.receiptId)).toEqual(receiptIds)
    for (const report of reports) {
      expect(report.anchor.recomputationHash).toMatch(/^[0-9a-f]{64}$/)
      expect(report.anchor.taskType).toBe('CHAPTER_DRAFTING')
      expect(report.anchor.reconciliationRef?.proposalId).toBe(proposalId)
      expect(report.anchor.reconciliationRef?.changeSummaryDigest).toMatch(/^[0-9a-f]{64}$/)
      expect(report.provider).toBe('semantic-test-model')
      expect(report.verdict).toBe('attention')
      expect(report.findings).toHaveLength(1)
      expect(report.findings[0]!.code).toBe('upstream_canon_drift')
      expect(report.inputStats.inputTokens).toBeGreaterThan(0)
      expect(report.inputStats.outputTokens).toBeGreaterThan(0)
    }

    // 逐章摘要指纹（D17「受影响章 diffs」）：逐章 = 本章钉版真正读到的上游变更，
    // 批次锚 = 整张上游变更表。指纹按「排序后的 kind:id@revision 集合」稳定序列化，
    // 故此处可精确复算（不靠「非空/不相等」这类弱断言）。
    const digestOf = (entries: readonly string[]): string =>
      createHash('sha256').update([...entries].sort().join('\n')).digest('hex')
    const expectedChapterDigests = [
      digestOf([`temporalFact:${factIds[0]}@1`]),
      digestOf([`temporalFact:${factIds[1]}@1`]),
    ]
    const expectedBatchDigest = digestOf([
      `temporalFact:${factIds[0]}@1`,
      `temporalFact:${factIds[1]}@1`,
    ])
    expect(reports.map((report) => report.affectedRefs[0]!.changeSummaryDigest)).toEqual(expectedChapterDigests)
    expect(expectedChapterDigests[0]).not.toBe(expectedChapterDigests[1])
    expect(reports.map((report) => report.anchor.reconciliationRef!.changeSummaryDigest)).toEqual([
      expectedBatchDigest,
      expectedBatchDigest,
    ])
    expect(reports.map((report) => report.affectedRefs[0]!.chapterIndex)).toEqual([1, 2])

    // 指针事件（D14 入账序：报告文件先、指针后），逐章一条、章序升序。
    const pointers = semanticPointerRows(root)
    expect(pointers.map((pointer) => pointer.chapterIndex)).toEqual([1, 2])
    expect(pointers.map((pointer) => pointer.payload['reportId'])).toEqual(reports.map((report) => report.reportId))
    expect(pointers.every((pointer) => pointer.payload['refusal'] === undefined)).toBe(true)

    // 派生投影可弃重建：扫报告目录即得行（E5）。
    const rows = selectSemanticAnalysisRows(root)
    expect(rows.map((row) => row.chapter_index)).toEqual([1, 2])
    expect(rows.map((row) => row.report_id)).toEqual(reports.map((report) => report.reportId))
    expect(rows.every((row) => row.verdict === 'attention')).toBe(true)

    // 作者决策不受语义旁路影响：文件保持作者改后的样子（Q12）。
    expect(readFileSync(join(root, FACT_STREAM_REL), 'utf8')).toContain('墨舟-1-改')
  }, 20_000)

  it('失败路径：上游回复非 JSON ⇒ 不产报告，落 refusal 指针（显式，绝不静默 mock）', async () => {
    const upstream = await startUpstream('抱歉，我无法判断这段内容。')
    const dataRoot = tmp('mozhou-semantic-bad-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = await seedPinnedBook(join(dataRoot, 'book-b'), 1, true)
    armRealProvider(upstream)
    const base = await startApi()

    const proposalId = await proposeStreamEdit(base, root)
    await acceptEverything(base, root, proposalId)

    // L2 三次尝试（默认 1s/2s 退避）后落 refusal；报告目录保持零文件。
    await vi.waitFor(
      () => {
        expect(semanticPointerRows(root)).toHaveLength(1)
      },
      { timeout: 12_000, interval: 50 },
    )

    expect(countSemanticReports(root)).toBe(0)
    const pointer = semanticPointerRows(root)[0]!
    expect(pointer.chapterIndex).toBe(1)
    expect(pointer.payload['reportId']).toBeNull()
    expect(pointer.payload['refusal']).toBe('provider_unavailable')
    // 真适配器被真实调用过（重试 3 次），不是零调用的假通过。
    expect(upstream.bodies).toHaveLength(3)
    expect(selectSemanticAnalysisRows(root)).toHaveLength(0)
  }, 20_000)

  it('失败路径：无 BYOK 端点 ⇒ L0 显式跳过：零报告、零指针事件、上游零请求', async () => {
    const upstream = await startUpstream(REPLY_ATTENTION)
    const dataRoot = tmp('mozhou-semantic-nokey-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = await seedPinnedBook(join(dataRoot, 'book-c'), 1, true)
    armRealProvider(upstream)
    const base = await startApi()
    // 落定前撤掉凭据：适配器装配期为 null ⇒ 调用方按 L0 收口（不产报告、不静默 mock）。
    disarmProvider()

    const proposalId = await proposeStreamEdit(base, root)
    await acceptEverything(base, root, proposalId)

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(upstream.bodies).toHaveLength(0)
    expect(countSemanticReports(root)).toBe(0)
    expect(semanticPointerRows(root)).toHaveLength(0)
  }, 20_000)

  it('不变量：受影响章无编译凭证 ⇒ 跳过该章，不伪造 receiptId/recomputationHash 锚点（且显式留痕）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const upstream = await startUpstream(REPLY_ATTENTION)
    const dataRoot = tmp('mozhou-semantic-noanchor-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = await seedPinnedBook(join(dataRoot, 'book-d'), 1, false)
    armRealProvider(upstream)
    const base = await startApi()

    const proposalId = await proposeStreamEdit(base, root)
    await acceptEverything(base, root, proposalId)

    await new Promise((resolve) => setTimeout(resolve, 200))
    // 受影响章确实存在（钉版被命中）——但缺凭证 ⇒ 无「评估哪版编译」可声明（D10）。
    expect(
      readPipelineLedger(root).some((row) => row.kind === 'domain' && row.row['type'] === 'ChapterCommitted'),
    ).toBe(true)
    expect(upstream.bodies).toHaveLength(0)
    expect(countSemanticReports(root)).toBe(0)
    expect(semanticPointerRows(root)).toHaveLength(0)
    // 空转必须可观测：逐章跳过落 console.warn（否则「看起来接通了其实没生效」无从发现）。
    const warned = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(warned).toContain('章 1 跳过')
    expect(warned).toContain('ContextCompiled')
  }, 20_000)
})

describe('语义回复解析严格性（失败路径，不产半成品报告）', () => {
  it('非 JSON / 非对象 / verdict 非法 / findings 形状非法一律抛错', () => {
    expect(() => parseSemanticReply('这里没有任何 JSON')).toThrow(/无 JSON 对象/)
    expect(() => parseSemanticReply('[1,2,3]')).toThrow(/无 JSON 对象/)
    expect(() => parseSemanticReply('{"verdict":"good","findings":[]}')).toThrow(/verdict 非法/)
    expect(() => parseSemanticReply('{"verdict":"ok"}')).toThrow(/缺少 findings/)
    expect(() => parseSemanticReply('{"verdict":"ok","findings":{}}')).toThrow(/不是数组/)
    expect(() => parseSemanticReply('{"verdict":"ok","findings":[{"severity":"fatal","code":"x","message":"y"}]}')).toThrow(
      /severity 非法/,
    )
    expect(() => parseSemanticReply('{"verdict":"ok","findings":[{"severity":"info","code":"","message":"y"}]}')).toThrow(
      /code 缺失/,
    )
    expect(() => parseSemanticReply('{"verdict":"ok","findings":[{"severity":"info","code":"x","message":""}]}')).toThrow(
      /message 缺失/,
    )
  })

  it('合法回复（含围栏残留）被接受：verdict + findings 逐字段回填', () => {
    const parsed = parseSemanticReply(
      '```json\n{"verdict":"ok","findings":[{"severity":"info","code":"c","message":"m"}]}\n```',
    )
    expect(parsed.verdict).toBe('ok')
    expect(parsed.findings).toEqual([{ severity: 'info', code: 'c', message: 'm' }])
  })
})
