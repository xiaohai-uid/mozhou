/**
 * T5（实现票 #20）行为黑盒：外部修改五态对账。
 * 全部经 LocalDataPlane 接缝打——检出（启动必检 + watcher）/ 作者门 / 落投影 / 基线纪律。
 * 规格锚点：dual-plane-sync-spec Q4/Q8-Q12 + S1-S7 不变量。
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { createBook } from './create-book.js'
import { newUlid } from '@mozhou/kernel'
import {
  MANIFEST_PATH,
  RUNTIME_EVENTS_PATH,
  STYLE_PROFILE_PATH,
  TRACKING_STREAMS,
  VOLUME_ONE_OUTLINE_PATH,
} from './layout.js'
import { LocalDataPlane } from './local-data-plane.js'
import { buildDefaultExtractor as defaultExtractForTest } from './reconciliation.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t5-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: '墨舟对账书' })
  return LocalDataPlane.open(bookRoot)
}

function disk(rel: string): string {
  return readFileSync(join(bookRoot, rel), 'utf8')
}

function jsonLines(rel: string): string[] {
  return disk(rel).split('\n').filter((line) => line.length > 0)
}

function editExternally(rel: string, mutate: (current: string) => string): void {
  writeFileSync(join(bookRoot, rel), mutate(readFileSync(join(bookRoot, rel), 'utf8')))
}

/** 投影内容指纹：全部用户表按 rowid 序 dump 后哈希（与 T1 同法）。 */
function fingerprint(db: Database.Database): string {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string
    }[]
  ).map((row) => row.name)
  const dump = tables.map((table) => JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()))
  return createHash('sha256').update(dump.join('\n')).digest('hex')
}

/** canon 快照：.mozhou/ 之外所有文件的 rel path → sha256。 */
function canonSnapshot(): Map<string, string> {
  const snapshot = new Map<string, string>()
  const walk = (rel: string): void => {
    for (const name of readdirSafe(join(bookRoot, rel))) {
      const childRel = rel ? `${rel}/${name}` : name
      if (childRel === '.mozhou') continue
      if (statSync(join(bookRoot, childRel)).isDirectory()) walk(childRel)
      else
        snapshot.set(
          childRel,
          createHash('sha256').update(readFileSync(join(bookRoot, childRel))).digest('hex'),
        )
    }
  }
  walk('')
  return snapshot
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** 建一本带一章已提交正文 + 两条事实增量的书。 */
/** 构造一条通过 T4 语义门禁的 TemporalFact 行（应用内提交与外部编辑模拟共用同一形状）。 */
function makeFactRow(plane: LocalDataPlane, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString()
  return {
    id: `fact_${newUlid()}`,
    bookId: plane.book.id,
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

function seedCommittedChapter(plane: LocalDataPlane): { proseRel: string } {
  plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
  const result = plane.commitChapter({
    chapterIndex: 1,
    summary: '主角登舟',
    appends: {
      temporalFact: [
        makeFactRow(plane, { value: '墨舟' }),
        makeFactRow(plane, { predicate: 'mood', value: '警觉' }),
      ],
    },
  })
  return { proseRel: result.proseRelPath }
}

/** 外部编辑器模拟：改写追踪流第 seq 行的 value 字段（id 等身份字段原样保留）。 */
function mutateStreamLine(rel: string, seq: number, patch: Record<string, unknown>): void {
  editExternally(rel, (current) => {
    const lines = current.split('\n').filter((line) => line.length > 0)
    const row = JSON.parse(lines[seq] ?? '{}') as Record<string, unknown>
    lines[seq] = JSON.stringify({ ...row, ...patch })
    return `${lines.join('\n')}\n`
  })
}

describe('五态对账：检出（Q4 启动必检 + 运行期 watcher）', () => {
  it('启动扫描为已提交正文的的外部修改立提案（变更摘要），批准前正典与投影零触碰（AC1/AC2）', () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()

      editExternally(proseRel, (text) => `${text}\n她望向舷外，云海翻涌。\n`)
      const beforeFingerprint = fingerprint(plane.db)
      const beforeCanon = canonSnapshot()

      const outcome = rec.scanExternalModifications('startupScan')

      expect(outcome.proposed).toHaveLength(1)
      const proposal = outcome.proposed[0]
      expect(proposal?.relPath).toBe(proseRel)
      expect(proposal?.state).toBe('awaiting_author')
      expect(proposal?.triggerSource).toBe('startupScan')
      expect(proposal?.proposalId).toMatch(/^rcln_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(proposal?.summary?.kind).toBe('proseChapter')
      if (proposal?.summary?.kind === 'proseChapter') {
        expect(proposal.summary.phase).toBe('committed')
        expect(proposal.summary.chapterIndex).toBe(1)
      }

      // 未批准前：canon 与投影逐字节未动（AC2）
      expect(fingerprint(plane.db)).toBe(beforeFingerprint)
      expect(canonSnapshot()).toEqual(beforeCanon)

      rec.stopWatcher()
    } finally {
      plane.close()
    }
  })

  it('草稿自由改豁免（S2）：不立提案，只在豁免清单可见', () => {
    const plane = newBook()
    try {
      const draft = plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const rec = plane.reconciliation()

      editExternally(draft.proseRelPath, (text) => `${text}草稿随便写。\n`)
      const outcome = rec.scanExternalModifications('startupScan')

      expect(outcome.proposed).toHaveLength(0)
      expect(outcome.draftsExempted).toEqual([draft.proseRelPath])
    } finally {
      plane.close()
    }
  })

  it('追踪流外部改动产出行级三分摘要：尾追加=新增、中段改写=修改行、坏行进解析失败清单', () => {
    const plane = newBook()
    try {
      seedCommittedChapter(plane)
      const rec = plane.reconciliation()

      const factRel = TRACKING_STREAMS[0].path
      mutateStreamLine(factRel, 1, { value: '松弛' })
      editExternally(factRel, (current) => {
        const added = JSON.stringify(makeFactRow(plane, { id: `fact_${newUlid()}`, subject: 'char:jimo', value: '船坞' }))
        return `${current.trimEnd()}\n${added}\n{oops 不是 json}\n`
      })

      const outcome = rec.scanExternalModifications('startupScan')
      expect(outcome.proposed).toHaveLength(1)
      const summary = outcome.proposed[0]?.summary
      expect(summary?.kind).toBe('trackingStream')
      if (summary?.kind === 'trackingStream') {
        expect(summary.streamKind).toBe('temporalFact')
        expect(summary.changes).toHaveLength(1)
        expect(summary.changes[0]?.seq).toBe(1)
        expect(summary.additions).toHaveLength(1)
        expect(summary.additions[0]?.seqOnDisk).toBe(2)
        expect(JSON.parse(summary.additions[0]?.payload ?? '{}')).toMatchObject({ subject: 'char:jimo' })
        expect(summary.removals).toHaveLength(0)
        expect(summary.invalidLines).toHaveLength(1)
        expect(summary.invalidLines[0]?.lineNo).toBe(3)
      }
    } finally {
      plane.close()
    }
  })

  it('mtime 预筛命中但 SHA-256 复核相等 ⇒ 不立提案（预筛≠误报源，AC1 承诺语义）', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()
      const before = statSync(join(bookRoot, STYLE_PROFILE_PATH))
      const future = new Date(before.mtimeMs + 5000)
      utimesSync(join(bookRoot, STYLE_PROFILE_PATH), future, future)

      const outcome = rec.pollOnce()
      expect(outcome.proposed).toHaveLength(0)
    } finally {
      plane.close()
    }
  })

  it('运行期 watcher 最终必检出（承诺语义）：外部编辑落盘后间隔轮询自动立提案', async () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      rec.startWatcher({ intervalMs: 20 })

      editExternally(proseRel, (text) => `${text}watcher 应看到这行。\n`)

      await vi.waitFor(
        () => {
          expect(rec.listOpenProposals().length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 3000, interval: 25 },
      )
      rec.stopWatcher()
    } finally {
      plane.close()
    }
  })

  it('一轮扫描同时覆盖 修改/缺失/新增 三类外部事实', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()

      editExternally(STYLE_PROFILE_PATH, (text) => `${text}<!-- 外部改 -->\n`)
      rmSync(join(bookRoot, '追踪/伏笔.jsonl'))
      writeFileSync(
        join(bookRoot, '设定/人物/林晚.md'),
        '---\nref: char:lin-wan\nname: 林晚\n---\n# 林晚\n',
      )

      const outcome = rec.pollOnce()
      const kinds = outcome.proposed.map((proposal) => proposal.summary?.kind).sort()
      expect(kinds).toEqual(['fileDeleted', 'newEntityCard', 'structuredFile'])

      const byRel = new Map(outcome.proposed.map((proposal) => [proposal.relPath, proposal]))
      expect(byRel.get(STYLE_PROFILE_PATH)?.summary?.kind).toBe('structuredFile')
      expect(byRel.get('追踪/伏笔.jsonl')?.summary?.kind).toBe('fileDeleted')
      expect(byRel.get('设定/人物/林晚.md')?.summary?.kind).toBe('newEntityCard')
    } finally {
      plane.close()
    }
  })

  it('提案落盘持久化：换手重开仍在（detected 状态跨会话存活）', () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      editExternally(proseRel, (text) => `${text}跨会话仍应对账。\n`)
      const created = rec.scanExternalModifications('startupScan').proposed
      expect(created).toHaveLength(1)

      const reopened = LocalDataPlane.open(bookRoot)
      try {
        const persisted = reopened.reconciliation().listOpenProposals()
        expect(persisted).toHaveLength(1)
        expect(persisted[0]?.relPath).toBe(proseRel)
      } finally {
        reopened.close()
      }
    } finally {
      plane.close()
    }
  })
})

describe('五态对账：作者门与落投影（Q8-Q12 + S4）', () => {
  it('批准正文吸收：基线更新核对干净、事件留痕、投影不动', () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      editExternally(proseRel, (text) => `${text}\n她望向舷外，云海翻涌。\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(proposal).toBeDefined()
      const beforeFingerprint = fingerprint(plane.db)
      const eventsBefore = jsonLines(RUNTIME_EVENTS_PATH).length

      const resolved = rec.decideItems(proposal!.proposalId, ['whole'])

      expect(resolved.state).toBe('applied')
      expect(resolved.resolution).toBe('applied')
      expect(rec.listOpenProposals()).toHaveLength(0)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      // 正文不入投影表：投影指纹不变即「未被触碰」；一致性由基线承载
      expect(fingerprint(plane.db)).toBe(beforeFingerprint)

      const lastEvent = JSON.parse(jsonLines(RUNTIME_EVENTS_PATH).at(-1) ?? '{}') as Record<string, unknown>
      expect(lastEvent).toMatchObject({
        type: 'ReconciliationResolved',
        proposalId: proposal!.proposalId,
        relPath: proseRel,
        resolution: 'applied',
      })
      expect(jsonLines(RUNTIME_EVENTS_PATH)).toHaveLength(eventsBefore + 1)
    } finally {
      plane.close()
    }
  })

  it('追踪流逐条取舍：接受的修改行落投影、拒绝的保持基线行、拒绝的新增行不入库；基线无论取舍照常更新（Q12/S4）', () => {
    const plane = newBook()
    try {
      seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      const factRel = TRACKING_STREAMS[0].path

      mutateStreamLine(factRel, 1, { mood: '松弛' })
      editExternally(factRel, (current) => {
        const added = JSON.stringify(
          makeFactRow(plane, { id: `fact_${newUlid()}`, subject: 'char:jimo', predicate: 'located', value: '船坞', source: { kind: 'chapter', chapterIndex: 2 } }),
        )
        return `${current.trimEnd()}\n${added}\n`
      })
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(proposal?.summary?.kind).toBe('trackingStream')

      // 只接受 seq1 的修改行；新增行拒绝
      const resolved = rec.decideItems(proposal!.proposalId, ['change:1'])
      expect(resolved.state).toBe('partially_applied')

      const rows = (
        plane.db.prepare('SELECT seq, payload FROM tracking_lines WHERE kind = ? ORDER BY seq').all('temporalFact') as {
          seq: number
          payload: string
        }[]
      ).map((row) => JSON.parse(row.payload) as Record<string, unknown>)
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ predicate: 'located', value: '墨舟' }) // 未动行原样
      expect(rows[1]).toMatchObject({ mood: '松弛' }) // 接受的修改行落投影
      expect(rows[1]?.['id']).toMatch(/^fact_[0-9A-HJKMNP-TV-Z]{26}$/) // 身份字段保留
      // 拒绝的新增行：盘上存在但未升格（拒绝 ≠ 回滚文件）
      expect(disk(factRel)).toContain('char:jimo')

      // S4：基线无论取舍照常更新 ⇒ 核对干净，不会死循环重报
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })

  it('再检出抑制：已被拒绝过的 (旧行,新行) 对与新行载荷不再重复上报，新尾部照常上报', () => {
    const plane = newBook()
    try {
      seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      const factRel = TRACKING_STREAMS[0].path

      mutateStreamLine(factRel, 1, { mood: '松弛' })
      const first = rec.scanExternalModifications('startupScan').proposed[0]
      rec.decideItems(first!.proposalId, []) // 全拒

      // 二次外部编辑：追加一条全新行（被拒的修改行原样留在盘上）
      editExternally(factRel, (current) => {
        const fresh = JSON.stringify(
          makeFactRow(plane, { id: `fact_${newUlid()}`, value: '码头', source: { kind: 'chapter', chapterIndex: 2 } }),
        )
        return `${current.trimEnd()}\n${fresh}\n`
      })
      const second = rec.scanExternalModifications('startupScan')
      expect(second.proposed).toHaveLength(1)
      const summary = second.proposed[0]?.summary
      if (summary?.kind === 'trackingStream') {
        expect(summary.changes).toHaveLength(0) // 已拒对的 (旧行,新行) 被抑制
        expect(summary.additions).toHaveLength(1)
        expect(JSON.parse(summary.additions[0]?.payload ?? '{}')).toMatchObject({ value: '码头' })
      } else {
        expect.unreachable('expected trackingStream summary')
      }
    } finally {
      plane.close()
    }
  })

  it('驳回（dismiss）：投影零触碰，基线照样吸收盘上现状（S4 与取舍无关）', () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      editExternally(proseRel, (text) => `${text}\n她望向舷外，云海翻涌。\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(proposal).toBeDefined()
      const beforeFingerprint = fingerprint(plane.db)

      const dismissed = rec.dismiss(proposal!.proposalId)

      expect(dismissed.state).toBe('dismissed')
      expect(dismissed.resolution).toBe('dismissed')
      expect(fingerprint(plane.db)).toBe(beforeFingerprint)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      expect(disk(proseRel)).toContain('舷外')
    } finally {
      plane.close()
    }
  })

  it('批准目录卡删除提案：投影行清除 + 基线键移除，核对干净', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()
      const cardRel = '设定/人物/林晚.md'
      writeFileSync(join(bookRoot, cardRel), '---\nref: char:lin-wan\nname: 林晚\n---\n# 林晚\n')
      const created = rec.pollOnce().proposed.find((proposal) => proposal.relPath === cardRel)
      expect(created?.summary?.kind).toBe('newEntityCard')
      rec.decideItems(created!.proposalId, ['whole'])
      expect(
        (plane.db.prepare('SELECT COUNT(*) AS n FROM entity_cards').all() as { n: number }[])[0]?.n,
      ).toBe(1)

      rmSync(join(bookRoot, cardRel))
      const deletion = rec.pollOnce().proposed.find((proposal) => proposal.relPath === cardRel)
      expect(deletion?.summary?.kind).toBe('fileDeleted')

      const resolved = rec.decideItems(deletion!.proposalId, ['whole'])
      expect(resolved.state).toBe('applied')
      expect(
        (plane.db.prepare('SELECT COUNT(*) AS n FROM entity_cards').all() as { n: number }[])[0]?.n,
      ).toBe(0)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })

  it('批准新增目录卡吸收：entity_cards 冻结行形入投影 + 基线登记（缺省档 detected）', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()
      writeFileSync(
        join(bookRoot, '设定/人物/季默.md'),
        '---\nref: char:ji-mo\nname: 季默\nbrief: 船坞匠人\n---\n# 季默\n',
      )
      const proposal = rec.pollOnce().proposed[0]
      expect(proposal?.summary?.kind).toBe('newEntityCard')
      if (proposal?.summary?.kind === 'newEntityCard') {
        expect(proposal.summary.ref).toBe('char:ji-mo')
        expect(proposal.summary.name).toBe('季默')
      }

      const resolved = rec.decideItems(proposal!.proposalId, ['whole'])
      expect(resolved.state).toBe('applied')

      const row = plane.db
        .prepare('SELECT ref, name, ai_context FROM entity_cards WHERE ref = ?')
        .get('char:ji-mo') as { ref: string; name: string; ai_context: string } | undefined
      expect(row).toEqual({ ref: 'char:ji-mo', name: '季默', ai_context: 'detected' })
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })

  it('结构化文件批准：大纲节点字段差异落投影（write-through 行形一致），核对干净', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()

      editExternally(VOLUME_ONE_OUTLINE_PATH, (current) =>
        current.replace('revision: 0', 'revision: 3').replace('# 第一卷', '# 第一卷·启航'),
      )
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(proposal?.summary?.kind).toBe('structuredFile')
      if (proposal?.summary?.kind === 'structuredFile') {
        expect(proposal.summary.fileType).toBe('outlineNode')
        const fields = Object.fromEntries(
          proposal.summary.fieldDiffs.map((diff) => [diff.field, diff.after]),
        )
        expect(fields['revision']).toBe(3)
        expect(fields['title']).toBe('第一卷·启航')
      }

      rec.decideItems(proposal!.proposalId, ['whole'])
      const row = plane.db.prepare('SELECT title, revision FROM outline_nodes WHERE node_type = ?').get('volume') as {
        title: string
        revision: number
      } | undefined
      expect(row).toEqual({ title: '第一卷·启航', revision: 3 })
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })

  it('提取失败态：注入故障提取器 ⇒ extract_failed 不阻塞他票；一键重试恢复 awaiting_author', () => {
    const plane = newBook()
    try {
      const { proseRel } = seedCommittedChapter(plane)
      let shouldFail = true
      const fallback = defaultExtractForTest()
      const rec = plane.reconciliation({
        extract: (request, context) => {
          if (shouldFail) throw new Error('注入的提取故障')
          return fallback(request, context)
        },
      })

      editExternally(proseRel, (text) => `${text}二次修改。\n`)
      const failed = rec.scanExternalModifications('startupScan').proposed[0]
      expect(failed?.state).toBe('extract_failed')
      expect(failed?.extractErrorDetail).toContain('注入的提取故障')
      expect(rec.listOpenProposals().map((proposal) => proposal.state)).toContain('extract_failed')

      shouldFail = false
      const retried = rec.retryExtraction(failed!.proposalId)
      expect(retried.state).toBe('awaiting_author')
      expect(retried.summary?.kind).toBe('proseChapter')
    } finally {
      plane.close()
    }
  })

  it('守卫：未知提案 / 非 awaiting_author 状态决策 / 未知条目一律响亮拒绝', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()
      expect(() => rec.decideItems('rcln_NOPE', ['whole'])).toThrow(/no open proposal/i)

      const { proseRel } = seedCommittedChapter(plane)
      editExternally(proseRel, (text) => `${text}x\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(() => rec.decideItems(proposal!.proposalId, ['nope:99'])).toThrow(/unknown item/i)
      expect(() => rec.dismiss('rcln_NOPE')).toThrow(/no open proposal/i)
    } finally {
      plane.close()
    }
  })
})

describe('T25：公共落定出口 onSettled（D18-D20）', () => {
  it('applied 终态触发 onSettled，且发生在 ReconciliationResolved 事件之后', () => {
    const plane = newBook()
    try {
      const calls: string[] = []
      const rec = plane.reconciliation({
        onSettled: (p) => calls.push(p.resolution + ':' + p.proposalId),
      })
      const { proseRel } = seedCommittedChapter(plane)
      editExternally(proseRel, (text) => `${text}\n外部补写。\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(proposal).toBeDefined()

      rec.decideItems(proposal!.proposalId, ['whole'])

      // 回调收到 applied 终态与 proposalId（嗅探幂等键）
      expect(calls).toHaveLength(1)
      expect(calls[0]).toBe('applied:' + proposal!.proposalId)
      // 事件已落账后才有回调（先文件后事件再回调的公共出口序）
      const lastEvent = JSON.parse(jsonLines(RUNTIME_EVENTS_PATH).at(-1) ?? '{}') as { type?: string }
      expect(lastEvent.type).toBe('ReconciliationResolved')
    } finally {
      plane.close()
    }
  })

  it('dismiss 终态同样触发（拒绝≠回滚，落定即通知）', () => {
    const plane = newBook()
    try {
      const settled: string[] = []
      const rec = plane.reconciliation({ onSettled: (p) => settled.push(p.resolution) })
      const { proseRel } = seedCommittedChapter(plane)
      editExternally(proseRel, (text) => `${text}x\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      rec.dismiss(proposal!.proposalId)
      expect(settled).toEqual(['dismissed'])
    } finally {
      plane.close()
    }
  })

  it('未注入 onSettled 的默认服务零回调（兼容旧调用方）', () => {
    const plane = newBook()
    try {
      const rec = plane.reconciliation()
      const { proseRel } = seedCommittedChapter(plane)
      editExternally(proseRel, (text) => `${text}y\n`)
      const proposal = rec.scanExternalModifications('startupScan').proposed[0]
      expect(() => rec.decideItems(proposal!.proposalId, ['whole'])).not.toThrow()
    } finally {
      plane.close()
    }
  })
})

describe('常驻平面接线（运行期 watcher 宿主）', () => {
  it('其它平面 write-through 后本平面复核零提案：应用自身写入不得误报为外部修改（Q5 基线真源在文件侧）', () => {
    const plane = newBook()
    try {
      seedCommittedChapter(plane)
      const rec = plane.reconciliation()

      // 第二个平面 = 同一本书的另一次应用内写入（web 端 per-request 平面）：
      // 提交第 2 章会刷新正文、章大纲与追踪流，并 write-through 落 manifest.json
      const second = LocalDataPlane.open(bookRoot)
      try {
        second.createChapterDraft({ chapterIndex: 2, title: '云涌' })
        second.commitChapter({
          chapterIndex: 2,
          summary: '续章',
          appends: { temporalFact: [makeFactRow(second)] },
        })
      } finally {
        second.close()
      }

      // 常驻平面必须先重载文件侧基线再核对；否则陈旧内存基线会把应用自己的
      // 写入整批误报成 EXTERNAL_MODIFIED。
      expect(rec.pollOnce().proposed).toEqual([])
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })

  it('watcher 单拍失败不掀翻宿主：manifest 损坏时显式落错，恢复后继续检出（承诺语义不因单点故障失效）', async () => {
    const plane = newBook()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { proseRel } = seedCommittedChapter(plane)
      const rec = plane.reconciliation()
      rec.startWatcher({ intervalMs: 20 })

      const manifestAbs = join(bookRoot, MANIFEST_PATH)
      const pristineManifest = readFileSync(manifestAbs, 'utf8')
      writeFileSync(manifestAbs, '{ 截断的 manifest', 'utf8')
      editExternally(proseRel, (text) => `${text}第一拍。\n`)

      await vi.waitFor(
        () => {
          expect(
            errorSpy.mock.calls.some((call) => String(call[0]).includes('watcher tick failed')),
          ).toBe(true)
        },
        { timeout: 3000, interval: 25 },
      )

      // 单拍抛错未打断定时链：恢复基线后再来一次外部编辑仍被自动检出
      writeFileSync(manifestAbs, pristineManifest, 'utf8')
      editExternally(proseRel, (text) => `${text}第二拍。\n`)

      await vi.waitFor(
        () => {
          expect(rec.listOpenProposals().length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 3000, interval: 25 },
      )
      rec.stopWatcher()
    } finally {
      errorSpy.mockRestore()
      plane.close()
    }
  })
})
