// @vitest-environment node
/**
 * T5 对账接线黑盒：`/api/reconciliation.*` 候选面 + 进程级运行期宿主。
 *
 * 规格锚点：dual-plane-sync-spec Q4（启动必检 + 运行期 watcher）/Q8-Q12（五态状态机、
 * 逐条取舍、拒绝 ≠ 回滚文件、基线无论取舍照常更新）+ 不变量 S2/S4。
 * 覆盖失败路径（未知 id / 状态冲突 / 非法载荷）与不变量（拒绝不回滚文件、基线吸收、
 * 草稿豁免、挂接失败显式可观测），不只走 happy path。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chapterOutlinePath,
  createBook,
  LocalDataPlane,
  parseFrontmatter,
  proseChapterPath,
  readOutlineStaleMarker,
} from '@mozhou/data-plane'
import { newUlid } from '@mozhou/kernel'
import { createMoZhouApiRouter } from '../api.js'
import { defaultBookAccessManager } from '../bookAccess.js'
import { defaultSessionManager, InMemoryAuthProvider } from '../auth/session.js'
import {
  attachReconciliationForDataRoot,
  ensureReconciliationRuntime,
  getReconciliationAttachFailure,
  getReconciliationRuntime,
  installReconciliationAutoAttach,
  stopAllReconciliationRuntimes,
} from './reconciliationRoutes.js'

const FACT_STREAM_REL = '追踪/事实.jsonl'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

beforeEach(() => {
  defaultSessionManager.clear()
  defaultSessionManager.setProvider(new InMemoryAuthProvider())
  defaultBookAccessManager.clear()
  defaultBookAccessManager.setHostedMode(false)
})

afterEach(() => {
  // 常驻宿主持有 runtime.sqlite 句柄：必须先收口再删临时目录（Windows 下否则 EPERM）
  stopAllReconciliationRuntimes()
  for (const s of servers) s.close()
  servers = []
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
  tempDirs = []
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function listen(): Promise<string> {
  return new Promise((resolveUrl) => {
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
      const addr = server.address() as AddressInfo
      resolveUrl(`http://127.0.0.1:${addr.port}`)
    })
  })
}

interface HttpResponse {
  readonly status: number
  readonly json: Record<string, unknown>
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<HttpResponse> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
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
  readonly proseRel: string
}

/** 建一本带一章已提交正文 + 一条事实增量的书（对账面非空）。 */
function seedCommittedBook(dir: string, factCount = 1): SeededBook {
  const created = createBook({ dir, title: '对账接线书' })
  const plane = LocalDataPlane.open(dir)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
    plane.commitChapter({
      chapterIndex: 1,
      summary: '主角登舟',
      appends: {
        temporalFact: Array.from({ length: factCount }, (_, index) =>
          makeFactRow(created.book.id, { value: `墨舟-${index}` }),
        ),
      },
    })
  } finally {
    plane.close()
  }
  return { root: dir, proseRel: proseChapterPath(1) }
}

function appendExternally(absolutePath: string, text: string): void {
  writeFileSync(absolutePath, `${readFileSync(absolutePath, 'utf8')}${text}`, 'utf8')
}

function mutateStreamLine(absolutePath: string, seq: number, patch: Record<string, unknown>): void {
  const lines = readFileSync(absolutePath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  const row = JSON.parse(lines[seq] ?? '{}') as Record<string, unknown>
  lines[seq] = JSON.stringify({ ...row, ...patch })
  writeFileSync(absolutePath, `${lines.join('\n')}\n`, 'utf8')
}

function trackingRows(root: string, kind: string): { seq: number; payload: string }[] {
  const plane = LocalDataPlane.open(root)
  try {
    return plane.db
      .prepare('SELECT seq, payload FROM tracking_lines WHERE kind = ? ORDER BY seq')
      .all(kind) as { seq: number; payload: string }[]
  } finally {
    plane.close()
  }
}

interface PinnedBook {
  readonly root: string
  readonly factId: string
}

/**
 * 两章各带依赖钉版：ch1 依赖 factId@0，ch2 依赖另一条事实@0（无关章对照）。
 * 追踪流落盘序 = [factId, otherFactId]，故外部改版固定在行 0。
 */
function seedPinnedBook(dir: string): PinnedBook {
  const created = createBook({ dir, title: '钉版传播书' })
  const factId = `fact_${newUlid()}`
  const otherFactId = `fact_${newUlid()}`
  const plane = LocalDataPlane.open(dir)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
    plane.createChapterDraft({ chapterIndex: 2, title: '云涌' })
    plane.commitChapter({
      chapterIndex: 1,
      summary: '一章提交',
      dependencyManifest: { entries: [{ kind: 'temporalFact', id: factId, revision: 0 }] },
      appends: { temporalFact: [makeFactRow(created.book.id, { id: factId, value: '墨舟-0' })] },
    })
    plane.commitChapter({
      chapterIndex: 2,
      summary: '二章提交',
      dependencyManifest: { entries: [{ kind: 'temporalFact', id: otherFactId, revision: 0 }] },
      appends: { temporalFact: [makeFactRow(created.book.id, { id: otherFactId, value: '船坞', predicate: 'mood' })] },
    })
  } finally {
    plane.close()
  }
  return { root: dir, factId }
}

function outlineData(root: string, chapterIndex: number): Record<string, unknown> {
  return parseFrontmatter(readFileSync(join(root, chapterOutlinePath(chapterIndex)), 'utf8')).data
}

/** 立一条追踪流提案并把提案 id 取出（所有传播用例的共同前置）。 */
async function proposeStreamEdit(base: string, root: string, streamAbs: string): Promise<string> {
  mutateStreamLine(streamAbs, 0, { value: '墨舟-改', revision: 1 })
  const scan = await post(base, '/api/reconciliation.scan', { root })
  const proposals = scan.json['openProposals'] as Record<string, unknown>[]
  const proposal = proposals.find((candidate) => candidate['relPath'] === FACT_STREAM_REL)
  expect(proposal, `expected a proposal for ${FACT_STREAM_REL}, got ${JSON.stringify(proposals)}`).toBeDefined()
  return proposal!['proposalId'] as string
}

/* ========================================================================== */

describe('对账候选面接线（/api/reconciliation.*）', () => {
  it('外部改定稿章：scan 立提案 → list/get 可见 → 全接受 applied → 基线吸收且 canon 不回写', async () => {
    const dataRoot = tempDir('mozhou-rcln-face-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, proseRel } = seedCommittedBook(join(dataRoot, 'book-a'))
    const base = await listen()

    const proseAbs = join(root, proseRel)
    const externalText = `${readFileSync(proseAbs, 'utf8')}她望向舷外，云海翻涌。\n`
    writeFileSync(proseAbs, externalText, 'utf8')

    const scan = await post(base, '/api/reconciliation.scan', { root })
    expect(scan.status).toBe(200)
    const proposed = scan.json['openProposals'] as Record<string, unknown>[]
    expect(proposed).toHaveLength(1)
    expect(proposed[0]?.['relPath']).toBe(proseRel)
    expect(proposed[0]?.['state']).toBe('awaiting_author')
    expect(proposed[0]?.['triggerSource']).toBe('startupScan')
    expect((scan.json['runtime'] as Record<string, unknown>)['attached']).toBe(true)
    const proposalId = proposed[0]?.['proposalId'] as string

    const list = await post(base, '/api/reconciliation.list', { root })
    expect(list.status).toBe(200)
    expect(list.json['openCount']).toBe(1)
    expect((list.json['proposals'] as unknown[]).length).toBe(1)

    const got = await post(base, '/api/reconciliation.get', { root, proposalId })
    expect(got.status).toBe(200)
    expect((got.json['proposal'] as Record<string, unknown>)['proposalId']).toBe(proposalId)

    const decided = await post(base, '/api/reconciliation.decide', {
      root,
      proposalId,
      acceptedItemIds: ['whole'],
    })
    expect(decided.status).toBe(200)
    expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('applied')

    // canon 永不回写：文件保持作者改后的样子（Q12）
    expect(readFileSync(proseAbs, 'utf8')).toBe(externalText)

    // S4：终态即吸收盘上现状 ⇒ 再扫零提案（不死循环重报）
    const again = await post(base, '/api/reconciliation.scan', { root })
    expect((again.json['proposed'] as unknown[]).length).toBe(0)
    expect(again.json['draftsExempted']).toEqual([])
  })

  it('失败路径：非法 id 400、未知 id 404、非法载荷 400、未知条目/已终态 409', async () => {
    const dataRoot = tempDir('mozhou-rcln-fail-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, proseRel } = seedCommittedBook(join(dataRoot, 'book-b'))
    const base = await listen()
    appendExternally(join(root, proseRel), '外部加一行。\n')

    // 非法 proposalId 形状
    expect((await post(base, '/api/reconciliation.get', { root, proposalId: 'not-an-id' })).status).toBe(400)
    expect((await post(base, '/api/reconciliation.decide', { root, acceptedItemIds: [] })).status).toBe(400)

    // 形状合法但不存在
    const unknown = `rcln_${newUlid()}`
    const missing = await post(base, '/api/reconciliation.get', { root, proposalId: unknown })
    expect(missing.status).toBe(404)
    expect(missing.json['code']).toBe('PROPOSAL_NOT_FOUND')
    expect((await post(base, '/api/reconciliation.decide', { root, proposalId: unknown, acceptedItemIds: [] })).status).toBe(404)
    expect((await post(base, '/api/reconciliation.dismiss', { root, proposalId: unknown })).status).toBe(404)
    expect((await post(base, '/api/reconciliation.retry', { root, proposalId: unknown })).status).toBe(404)

    const scan = await post(base, '/api/reconciliation.scan', { root })
    const proposalId = (scan.json['openProposals'] as Record<string, unknown>[])[0]?.['proposalId'] as string

    // 非法 acceptedItemIds 载荷：非数组 / 含非字符串
    const badPayload = await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: 'whole' })
    expect(badPayload.status).toBe(400)
    expect(badPayload.json['code']).toBe('INVALID_ACCEPTED_ITEMS')
    expect((await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: [1] })).status).toBe(400)

    // 未知条目 id：状态机拒绝，提案保持未决（零写入）
    const badItem = await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: ['no-such-item'] })
    expect(badItem.status).toBe(409)
    expect(badItem.json['code']).toBe('RECONCILIATION_CONFLICT')
    const stillOpen = await post(base, '/api/reconciliation.get', { root, proposalId })
    expect((stillOpen.json['proposal'] as Record<string, unknown>)['state']).toBe('awaiting_author')

    // 落定后再决策 = 状态冲突
    expect((await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: ['whole'] })).status).toBe(200)
    const afterResolved = await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: ['whole'] })
    expect(afterResolved.status).toBe(409)

    // extract_failed 之外的 retry 同样是状态冲突
    expect((await post(base, '/api/reconciliation.retry', { root, proposalId })).status).toBe(409)
  })

  it('拒绝一条 delta ≠ 回滚文件（Q12/S4）：文件保持作者改后样子，投影保持基线，基线照常吸收', async () => {
    const dataRoot = tempDir('mozhou-rcln-reject-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedCommittedBook(join(dataRoot, 'book-c'), 1)
    const base = await listen()
    const streamAbs = join(root, FACT_STREAM_REL)

    mutateStreamLine(streamAbs, 0, { value: '松弛' })
    const appended = makeFactRow((await post(base, '/api/works', { root })).json['bookId'] as string, {
      subject: 'char:jimo',
      value: '船坞',
    })
    appendExternally(streamAbs, `${JSON.stringify(appended)}\n`)

    const scan = await post(base, '/api/reconciliation.scan', { root })
    const proposal = (scan.json['openProposals'] as Record<string, unknown>[])[0] as Record<string, unknown>
    const summary = proposal['summary'] as Record<string, unknown>
    expect(summary['kind']).toBe('trackingStream')
    expect((summary['changes'] as unknown[]).length).toBe(1)
    expect((summary['additions'] as unknown[]).length).toBe(1)

    const dismissed = await post(base, '/api/reconciliation.dismiss', {
      root,
      proposalId: proposal['proposalId'],
    })
    expect(dismissed.status).toBe(200)
    expect((dismissed.json['proposal'] as Record<string, unknown>)['state']).toBe('dismissed')

    // 文件零回滚：拒绝的只是「升格进投影」的断言，盘上保持作者改后的样子
    const diskAfter = readFileSync(streamAbs, 'utf8')
    expect(diskAfter).toContain('松弛')
    expect(diskAfter).toContain(appended['id'] as string)

    // 投影 = 基线（拒绝的修改行与新增行都不升格）
    const rows = trackingRows(root, 'temporalFact')
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({ value: '墨舟-0' })

    // 基线照常吸收 ⇒ 再扫零提案
    const again = await post(base, '/api/reconciliation.scan', { root })
    expect((again.json['proposed'] as unknown[]).length).toBe(0)
  })

  it('草稿自由改豁免（S2）：不立提案，只在豁免清单可见', async () => {
    const dataRoot = tempDir('mozhou-rcln-draft-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedCommittedBook(join(dataRoot, 'book-d'))
    const base = await listen()

    const plane = LocalDataPlane.open(root)
    let draftRel: string
    try {
      draftRel = plane.createChapterDraft({ chapterIndex: 2, title: '云涌' }).proseRelPath
    } finally {
      plane.close()
    }
    appendExternally(join(root, draftRel), '草稿随便写。\n')

    const scan = await post(base, '/api/reconciliation.scan', { root })
    expect((scan.json['proposed'] as unknown[]).length).toBe(0)
    expect(scan.json['draftsExempted']).toEqual([draftRel])
  })

  it('无常驻宿主时读面仍可用：提案跨平面存活，list 回退一次性平面并如实报告未挂接', async () => {
    const dataRoot = tempDir('mozhou-rcln-fallback-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, proseRel } = seedCommittedBook(join(dataRoot, 'book-e'))
    appendExternally(join(root, proseRel), '换手后仍应对账。\n')

    // 用一次性平面直接立提案后关闭（模拟上一次会话留下的未决提案）
    const plane = LocalDataPlane.open(root)
    try {
      expect(plane.reconciliation().scanExternalModifications('startupScan').proposed).toHaveLength(1)
    } finally {
      plane.close()
    }
    stopAllReconciliationRuntimes()

    const base = await listen()
    const list = await post(base, '/api/reconciliation.list', { root })
    expect(list.status).toBe(200)
    expect(list.json['openCount']).toBe(1)
    expect((list.json['runtime'] as Record<string, unknown>)['attached']).toBe(false)
    expect((list.json['runtime'] as Record<string, unknown>)['attachError']).toBeNull()
  })

  it('缺 root 的 book 级请求被显式拒绝（400），绝不用假数据兜底', async () => {
    const dataRoot = tempDir('mozhou-rcln-noroot-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const base = await listen()
    const res = await post(base, '/api/reconciliation.list', {})
    expect(res.status).toBe(400)
    expect(res.json['ok']).toBe(false)
  })
})

describe('进程级运行期宿主（启动必检 + watcher）', () => {
  it('watcher 最终必被检出（承诺语义）：挂接宿主后外部编辑无需再调 scan 即自动立提案', async () => {
    const dataRoot = tempDir('mozhou-rcln-watch-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, proseRel } = seedCommittedBook(join(dataRoot, 'book-f'))

    const runtime = ensureReconciliationRuntime(root, { watcherIntervalMs: 20 })
    expect(runtime.startupScan.proposed).toEqual([])

    appendExternally(join(root, proseRel), 'watcher 应看到这行。\n')

    await vi.waitFor(
      () => {
        expect(runtime.service.listOpenProposals().length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 3000, interval: 25 },
    )
  })

  it('挂接幂等且可收口：同一书根重复挂接返回同一宿主，stop 后句柄释放', () => {
    const dataRoot = tempDir('mozhou-rcln-idem-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedCommittedBook(join(dataRoot, 'book-g'))

    const first = ensureReconciliationRuntime(root)
    expect(ensureReconciliationRuntime(root)).toBe(first)
    expect(getReconciliationRuntime(root)).toBe(first)

    stopAllReconciliationRuntimes()
    expect(getReconciliationRuntime(root)).toBeNull()
    // 句柄已释放 ⇒ 临时目录可删（afterEach 会再删一次，force 容错）
  })

  it('非书目录挂接显式失败，绝不静默（ensure 抛出）', () => {
    const notABook = tempDir('mozhou-rcln-notbook-')
    expect(() => ensureReconciliationRuntime(notABook)).toThrow()
    expect(getReconciliationRuntime(notABook)).toBeNull()
  })

  it('启动必检挂接数据根下已知书，并报告逐书结果', () => {
    const dataRoot = tempDir('mozhou-rcln-boot-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedCommittedBook(join(dataRoot, 'books', 'bk_boot'))

    const report = attachReconciliationForDataRoot(dataRoot)
    expect(report.attached).toEqual([root])
    expect(report.failed).toEqual([])
    expect(getReconciliationRuntime(root)).not.toBeNull()
  })

  it('书根首次被解析即自动挂接（onBookResolved 钩子），失败落可观测账而非静默', async () => {
    const dataRoot = tempDir('mozhou-rcln-hook-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedCommittedBook(join(dataRoot, 'book-h'))

    const router = createMoZhouApiRouter()
    installReconciliationAutoAttach(router)
    const server = createServer((req, res) => {
      void router.dispatch(req, res).then(() => undefined)
    })
    servers.push(server)
    const base = await new Promise<string>((resolveUrl) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        resolveUrl(`http://127.0.0.1:${addr.port}`)
      })
    })

    // book 级请求解析出书根 ⇒ 必检 + watcher 挂接
    expect((await post(base, '/api/works', { root })).status).toBe(200)
    const attached = getReconciliationRuntime(root)
    expect(attached).not.toBeNull()
    expect(attached?.startupScan.proposed).toEqual([])

    // 幂等：再次请求不换宿主
    await post(base, '/api/works', { root })
    expect(getReconciliationRuntime(root)).toBe(attached)

    // 非书目录经 local-native 面解析书根时挂接失败 ⇒ 记入可观测账，请求本身照常 400
    const notABook = tempDir('mozhou-rcln-hook-bad-')
    const rejected = await post(base, '/api/library.open', { root: notABook })
    expect(rejected.status).toBe(400)
    expect(getReconciliationAttachFailure(notABook)).toContain('book.json')
  })
})

/* ==========================================================================
 * 落定出口 → StaleMarker 传播（change-impact-engine D18/D19/D20）
 *
 * 接线点：两处 plane.reconciliation(...) 注入的 onSettled。覆盖成功路径
 * （接受 → 命中章标 stale、无关章不动、正文零丢失、自身写入不被误报）与失败路径
 * （部分拒绝 / 整份拒绝不传播；章大纲外部编辑在途时 S3 拒绝叠加且显式落 stderr）。
 * ========================================================================== */

describe('落定出口 → StaleMarker 传播（D18/D19/D20）', () => {
  it('追踪行外部改版被接受 → 依赖章获得 stale 三要素；无关章不动；正文零丢失', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, factId } = seedPinnedBook(join(dataRoot, 'book-s1'))
    const base = await listen()

    const proseBefore = readFileSync(join(root, proseChapterPath(1)), 'utf8')
    const markedBefore = outlineData(root, 1)['revision'] as number
    const untouchedBefore = outlineData(root, 2)['revision'] as number

    const proposalId = await proposeStreamEdit(base, root, join(root, FACT_STREAM_REL))
    const decided = await post(base, '/api/reconciliation.decide', {
      root,
      proposalId,
      acceptedItemIds: ['whole', 'change:0'],
    })
    expect(decided.status).toBe(200)
    expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('applied')

    // 命中章：带原因 / 精确上游引用 / 时间三要素齐备，revision 原地 +1
    const marker = readOutlineStaleMarker(outlineData(root, 1) as never)
    expect(marker?.reason).toBe('upstream_canon_changed')
    expect(marker?.upstreamRefs).toEqual([{ kind: 'temporalFact', id: factId, revision: 1 }])
    expect(Number.isFinite(Date.parse(marker?.markedAt ?? ''))).toBe(true)
    expect(outlineData(root, 1)['revision']).toBe(markedBefore + 1)

    // 无关章零触碰
    expect(outlineData(root, 2)['staleReason']).toBeUndefined()
    expect(outlineData(root, 2)['revision']).toBe(untouchedBefore)

    // I1：传播是附加元数据通道，作者正文一个字节都不动
    expect(readFileSync(join(root, proseChapterPath(1)), 'utf8')).toBe(proseBefore)

    // 自己的写入自己吸收：传播后启动必检不得把自己的标记当外部修改
    const again = await post(base, '/api/reconciliation.scan', { root })
    expect((again.json['proposed'] as unknown[]).length).toBe(0)
  })

  it('部分接受：被拒的改版行不传播（拒绝 ≠ 上游变更），章大纲零标记', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-partial-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedPinnedBook(join(dataRoot, 'book-s2'))
    const base = await listen()

    const revisionBefore = outlineData(root, 1)['revision'] as number
    const proposalId = await proposeStreamEdit(base, root, join(root, FACT_STREAM_REL))

    // 只接受 'whole'（追踪流条目里它不携带行取舍）⇒ change:0 落入抑制账本
    const decided = await post(base, '/api/reconciliation.decide', { root, proposalId, acceptedItemIds: ['whole'] })
    expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('partially_applied')

    // 拒绝 ≠ 回滚：盘上仍是作者改后的版本
    expect(readFileSync(join(root, FACT_STREAM_REL), 'utf8')).toContain('墨舟-改')
    // 但投影未升格该行 ⇒ 不得有任何章被标 stale（按盘上现状传播会是误标）
    expect(outlineData(root, 1)['staleReason']).toBeUndefined()
    expect(outlineData(root, 1)['revision']).toBe(revisionBefore)
  })

  it('整份拒绝（dismiss）不传播：盘上带新版本，仍无章被标 stale', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-dismiss-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedPinnedBook(join(dataRoot, 'book-s3'))
    const base = await listen()

    const revisionBefore = outlineData(root, 1)['revision'] as number
    const proposalId = await proposeStreamEdit(base, root, join(root, FACT_STREAM_REL))

    const dismissed = await post(base, '/api/reconciliation.dismiss', { root, proposalId })
    expect((dismissed.json['proposal'] as Record<string, unknown>)['state']).toBe('dismissed')

    expect(readFileSync(join(root, FACT_STREAM_REL), 'utf8')).toContain('墨舟-改')
    expect(outlineData(root, 1)['staleReason']).toBeUndefined()
    expect(outlineData(root, 1)['revision']).toBe(revisionBefore)
  })

  it('正文外部改动落定不产上游变更表：零标记零噪声（无版本化实体可对齐）', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-prose-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedPinnedBook(join(dataRoot, 'book-s4'))
    const base = await listen()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const revisionBefore = outlineData(root, 1)['revision'] as number
      const proseAbs = join(root, proseChapterPath(1))
      writeFileSync(proseAbs, `${readFileSync(proseAbs, 'utf8')}她望向舷外。\n`, 'utf8')

      const scan = await post(base, '/api/reconciliation.scan', { root })
      const proposal = (scan.json['openProposals'] as Record<string, unknown>[])[0] as Record<string, unknown>
      expect(proposal['relPath']).toBe(proseChapterPath(1))

      const decided = await post(base, '/api/reconciliation.decide', {
        root,
        proposalId: proposal['proposalId'],
        acceptedItemIds: ['whole'],
      })
      expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('applied')

      expect(outlineData(root, 1)['staleReason']).toBeUndefined()
      expect(outlineData(root, 1)['revision']).toBe(revisionBefore)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('章大纲外部编辑在途：传播拒绝叠加（S3）→ 显式落 stderr，作者决策照常落定', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-s3-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root } = seedPinnedBook(join(dataRoot, 'book-s5'))
    const base = await listen()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const proposalId = await proposeStreamEdit(base, root, join(root, FACT_STREAM_REL))
      // 章大纲外部编辑在途（尚未对账）⇒ 写前 hash 校验必拒
      const outlineAbs = join(root, chapterOutlinePath(1))
      const outlineExternal = `${readFileSync(outlineAbs, 'utf8')}\n<!-- 外部批注 -->\n`
      writeFileSync(outlineAbs, outlineExternal, 'utf8')

      const decided = await post(base, '/api/reconciliation.decide', {
        root,
        proposalId,
        acceptedItemIds: ['whole', 'change:0'],
      })
      // 决策本身已落定：传播失败不得伪装成 500 回滚
      expect(decided.status).toBe(200)
      expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('applied')

      // 宁败不脏：外部编辑原样保留，未被静默叠加标记
      expect(readFileSync(outlineAbs, 'utf8')).toBe(outlineExternal)
      // 失败显式可观测，绝不静默
      const logged = errorSpy.mock.calls.map((call) => String(call[0]))
      expect(logged.some((line) => line.includes('stale propagation failed'))).toBe(true)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('无常驻宿主时决策同样传播：回退一次性平面的落定出口也注入', async () => {
    const dataRoot = tempDir('mozhou-rcln-stale-fallback-')
    defaultBookAccessManager.setDataRoot(dataRoot)
    const { root, factId } = seedPinnedBook(join(dataRoot, 'book-s6'))
    const streamAbs = join(root, FACT_STREAM_REL)
    mutateStreamLine(streamAbs, 0, { value: '墨舟-改', revision: 1 })

    // 一次性平面立提案后关闭（模拟上一次会话留下的未决提案）
    const plane = LocalDataPlane.open(root)
    let proposalId: string
    try {
      proposalId = plane.reconciliation().scanExternalModifications('startupScan').proposed[0]!.proposalId
    } finally {
      plane.close()
    }
    stopAllReconciliationRuntimes()

    const base = await listen()
    const decided = await post(base, '/api/reconciliation.decide', {
      root,
      proposalId,
      acceptedItemIds: ['whole', 'change:0'],
    })
    expect(decided.status).toBe(200)
    expect((decided.json['proposal'] as Record<string, unknown>)['state']).toBe('applied')
    expect(readOutlineStaleMarker(outlineData(root, 1) as never)?.upstreamRefs).toEqual([
      { kind: 'temporalFact', id: factId, revision: 1 },
    ])
  })
})
