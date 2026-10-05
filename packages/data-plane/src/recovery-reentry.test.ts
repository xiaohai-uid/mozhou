/**
 * W1 恢复重入安全（REC-01…REC-04）：pending-commit 恢复的收敛性、终态门禁与原子写清理。
 *
 * 与 chapter.test.ts 同构的隔离夹具（tmpdir 建书 + LocalDataPlane.open），
 * 不读写真实书稿与 mozhou_rt。刻意不 mock 模块内部：
 * - REC-01/03/04 直接在盘面与 journal 上构造混合/损坏状态，验证恢复的分支；
 * - REC-02 用**真实子进程 + SIGKILL**（onStage 回调内自杀）制造硬杀现场，
 *   证明「强杀后重开」而不是进程内异常回退。
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { newFactId, newTimelineEventId } from '@mozhou/kernel'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ATOMIC_TMP_SUFFIX, atomicWriteFileSync } from './atomic-write.js'
import { createBookBackup } from './book-backup.js'
import {
  PendingCommitConflictError,
  readProseChapter,
  recoverPendingCommit,
  type CommitChapterRequest,
} from './chapter.js'
import { createBook } from './create-book.js'
import { openDatabase } from './database.js'
import {
  MANIFEST_PATH,
  PENDING_COMMIT_PATH,
  RUNTIME_DB_PATH,
  RUNTIME_EVENTS_PATH,
  TRACKING_STREAMS,
  proseChapterPath,
} from './layout.js'
import { LocalDataPlane, ProjectionMissingError } from './local-data-plane.js'
import { CorruptManifestError, MissingManifestError } from './manifest.js'
import { sha256Hex } from './sha256.js'

const T0 = '2026-08-24T00:00:00.000Z'

const tmpRoots: string[] = []
let bookRoot = ''
let currentBookId = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-rec-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: '墨舟恢复测试书' })
  const plane = LocalDataPlane.open(bookRoot)
  currentBookId = plane.book.id
  return plane
}

/** 合法 TemporalFact 行（T4 语义门禁要求冻结 Schema 的完整形状）。 */
function factRow(): Record<string, unknown> {
  return {
    id: newFactId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    subject: 'char:lin-wan',
    predicate: 'located',
    value: '墨舟',
    validFrom: 1,
    validUntil: null,
    importance: 'notable',
    riskClass: 'low',
    source: { kind: 'chapter', chapterIndex: 1 },
    status: 'confirmed',
    compactedIntoVolumeId: null,
    provenance: { origin: 'ai', protectedUserContent: false },
  }
}

/** 合法 TimelineEvent 行。 */
function timelineRow(worldTimeOrder: number): Record<string, unknown> {
  return {
    id: newTimelineEventId(),
    bookId: currentBookId,
    revision: 0,
    createdAt: T0,
    updatedAt: T0,
    worldTimeLabel: '开篇',
    worldTimeOrder,
    chapterIndex: 1,
    participants: [],
    summary: '开篇事件',
    impactFactIds: [],
  }
}

function disk(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function jsonLines(root: string, rel: string): string[] {
  return disk(root, rel).split('\n').filter((line) => line.length > 0)
}

function journalPathOf(root: string): string {
  return join(root, PENDING_COMMIT_PATH)
}

interface JournalAppend {
  readonly kind: string | null
  readonly relPath: string
  readonly baseBytes: number
  readonly baseSeq: number
  readonly payloadBase64: string
}

interface JournalShape {
  readonly journalVersion: number
  readonly commitId: string
  readonly proseRelPath: string
  readonly stagedProseSha256: string
  readonly appends: readonly JournalAppend[]
}

function readJournal(root: string): JournalShape {
  return JSON.parse(readFileSync(journalPathOf(root), 'utf8')) as JournalShape
}

function targetOf(journal: JournalShape, kind: string | null): JournalAppend {
  const found = journal.appends.find((target) => target.kind === kind)
  if (found === undefined) {
    throw new Error(`journal has no append target for kind=${String(kind)}`)
  }
  return found
}

type Appends = NonNullable<CommitChapterRequest['appends']>

/** 在指定提交阶段注入故障并关闭句柄，留下盘上崩溃现场（journal + 部分写入）。 */
function crashCommit(root: string, stage: string, appends: Appends): void {
  const plane = LocalDataPlane.open(root)
  try {
    expect(() =>
      plane.commitChapter({
        chapterIndex: 1,
        summary: '崩溃注入',
        appends,
        onStage: (reached) => {
          if (reached === stage) {
            throw new Error(`simulated crash at ${stage}`)
          }
        },
      }),
    ).toThrow(new RegExp(`simulated crash at ${stage}`))
  } finally {
    plane.close()
  }
  expect(existsSync(journalPathOf(root))).toBe(true)
}

function freshDraftBook(): void {
  const plane = newBook()
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
  } finally {
    plane.close()
  }
}

function trackingRows(root: string): unknown[] {
  const plane = LocalDataPlane.open(root)
  try {
    return plane.db
      .prepare('SELECT kind, seq, line_sha256, payload FROM tracking_lines ORDER BY kind, seq')
      .all()
  } finally {
    plane.close()
  }
}

/* ---------------------------------------------------------------------------
 * REC-01：混合 untouched/partial/done 盘面，连续恢复三次
 * ------------------------------------------------------------------------- */

describe('REC-01 混合盘面连续恢复', () => {
  it('连续三次恢复后与一次性完成逐字节一致，追踪流无重复/缺行，journal 在终态后才移除', () => {
    freshDraftBook()
    // 整目录复制出「一次性完成」参照本：同 bookId ⇒ 同载荷字节，可比对
    const referenceRoot = `${bookRoot}-ref`
    tmpRoots.push(referenceRoot)
    cpSync(bookRoot, referenceRoot, { recursive: true })

    const appends: Appends = { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] }

    const referencePlane = LocalDataPlane.open(referenceRoot)
    try {
      referencePlane.commitChapter({ chapterIndex: 1, summary: '一次性完成', appends })
      expect(referencePlane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      referencePlane.close()
    }
    const referenceRows = trackingRows(referenceRoot)

    // 故障本：投影阶段崩 ⇒ journal + 已翻转正文 + 已追加流
    crashCommit(bookRoot, 'projection', appends)
    const journal = readJournal(bookRoot)

    // 人为造出混合盘面：temporalFact=untouched、timelineEvent=partial、events=done
    const factTarget = targetOf(journal, 'temporalFact')
    const timelineTarget = targetOf(journal, 'timelineEvent')
    const eventTarget = targetOf(journal, null)
    const timelinePayload = Buffer.from(timelineTarget.payloadBase64, 'base64')
    truncateSync(join(bookRoot, factTarget.relPath), factTarget.baseBytes)
    truncateSync(
      join(bookRoot, timelineTarget.relPath),
      timelineTarget.baseBytes + Math.floor(timelinePayload.length / 2),
    )
    // 盘面确实是 untouched / partial / done 三分法
    expect(readFileSync(join(bookRoot, factTarget.relPath)).length).toBe(factTarget.baseBytes)
    const timelineOnDisk = readFileSync(join(bookRoot, timelineTarget.relPath)).length
    expect(timelineOnDisk).toBeGreaterThan(timelineTarget.baseBytes)
    expect(timelineOnDisk).toBeLessThan(timelineTarget.baseBytes + timelinePayload.length)
    const eventPayload = Buffer.from(eventTarget.payloadBase64, 'base64')
    expect(readFileSync(join(bookRoot, eventTarget.relPath)).length).toBe(eventTarget.baseBytes + eventPayload.length)

    const snapshot = (): Record<string, unknown> => ({
      journal: existsSync(journalPathOf(bookRoot)),
      prose: disk(bookRoot, proseChapterPath(1)),
      streams: TRACKING_STREAMS.map((stream) => disk(bookRoot, stream.path)),
      events: disk(bookRoot, RUNTIME_EVENTS_PATH),
    })

    recoverPendingCommit(bookRoot)
    const afterFirst = snapshot()
    recoverPendingCommit(bookRoot)
    recoverPendingCommit(bookRoot)
    expect(snapshot()).toEqual(afterFirst)
    // 终态（目标完整 + flush + 投影匹配 + manifest 一致）满足后 journal 才消失
    expect(afterFirst.journal).toBe(false)

    // 与一次性完成逐字节一致
    for (const stream of TRACKING_STREAMS) {
      expect(disk(bookRoot, stream.path)).toBe(disk(referenceRoot, stream.path))
    }
    const recoveredProse = readProseChapter(bookRoot, proseChapterPath(1))
    const referenceProse = readProseChapter(referenceRoot, proseChapterPath(1))
    expect(recoveredProse.phase).toBe('committed')
    expect(recoveredProse.commitId).toBe(journal.commitId)
    expect(recoveredProse.body).toBe(referenceProse.body)
    expect(sha256Hex(disk(bookRoot, proseChapterPath(1)))).toBe(journal.stagedProseSha256)

    // 追踪流无重复行、无缺行；事件账本恰好一行且属于本事务
    expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
    expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
    const event = JSON.parse(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)[0] ?? '') as { type: string; commitId: string }
    expect(event).toMatchObject({ type: 'ChapterCommitted', commitId: journal.commitId })

    // 投影行与参照本全等（kind/seq/line_sha256/payload）
    const recoveredRows = trackingRows(bookRoot)
    expect(recoveredRows).toHaveLength(2)
    expect(recoveredRows).toEqual(referenceRows)

    const recoveredPlane = LocalDataPlane.open(bookRoot)
    try {
      expect(recoveredPlane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      recoveredPlane.close()
    }
  })
})

/* ---------------------------------------------------------------------------
 * REC-02：onStage 故障注入 + 子进程 SIGKILL 强杀后重开
 * ------------------------------------------------------------------------- */

const CHILD_LOADER = `import { register } from 'node:module'
register('./hooks.mjs', import.meta.url)
`

/** 只做一件事：把源码里的 './x.js' 说明符解析到同名 './x.ts'（仓库源码用 NodeNext 写法）。 */
const CHILD_HOOKS = `import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (specifier.endsWith('.js') && context.parentURL && context.parentURL.startsWith('file:')) {
      const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true }
      }
    }
    throw error
  }
}
`

const CHILD_SCRIPT = (dataPlaneUrl: string): string => `import { readFileSync, writeSync } from 'node:fs'
import { LocalDataPlane } from '${dataPlaneUrl}'

const [root, appendsPath, stage] = process.argv.slice(2)
const appends = JSON.parse(readFileSync(appendsPath, 'utf8'))
const plane = LocalDataPlane.open(root)
plane.commitChapter({
  chapterIndex: 1,
  summary: '子进程强杀',
  appends,
  onStage: (reached) => {
    // 同步写 fd 1：硬杀前必须留下「已到达该阶段」的证据，管道缓冲不参与
    writeSync(1, \`STAGE:\${reached}\\n\`)
    if (reached === stage) {
      process.kill(process.pid, 'SIGKILL')
    }
  },
})
plane.close()
console.log('COMMIT_COMPLETED')
`

function spawnCrashChild(root: string, stage: string, appends: Appends): { stdout: string; stderr: string } {
  const workDir = mkdtempSync(join(tmpdir(), `mozhou-rec-child-${process.pid}-`))
  tmpRoots.push(workDir)
  writeFileSync(join(workDir, 'hooks.mjs'), CHILD_HOOKS)
  writeFileSync(join(workDir, 'loader.mjs'), CHILD_LOADER)
  const appendsPath = join(workDir, 'appends.json')
  writeFileSync(appendsPath, JSON.stringify(appends))
  const childPath = join(workDir, 'child.ts')
  writeFileSync(childPath, CHILD_SCRIPT(new URL('./local-data-plane.ts', import.meta.url).href))

  const result = spawnSync(
    process.execPath,
    [
      '--experimental-transform-types',
      '--import',
      pathToFileURL(join(workDir, 'loader.mjs')).href,
      childPath,
      root,
      appendsPath,
      stage,
    ],
    { encoding: 'utf8', timeout: 120_000 },
  )
  expect(result.error).toBeUndefined()
  expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
  expect(result.stderr).not.toContain('SyntaxError')
  // 未捕获异常会打印堆栈：硬杀不应伴随任何 JS 错误
  expect(result.stderr).not.toContain('Error')
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('REC-02 子进程 SIGKILL 强杀后重开', () => {
  it.each(['event-append', 'prose-flip', 'projection', 'manifest'] as const)(
    '在 %s 阶段被硬杀后重开可收敛且 journal 消失',
    (stage) => {
      freshDraftBook()
      const appends: Appends = { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] }

      const child = spawnCrashChild(bookRoot, stage, appends)
      // 子进程确实走到了目标阶段才被硬杀：STAGE 轨迹有、提交未完成、journal 在盘上
      expect(child.stdout).toContain(`STAGE:${stage}`)
      expect(child.stdout).not.toContain('COMMIT_COMPLETED')
      expect(existsSync(journalPathOf(bookRoot))).toBe(true)

      const recovered = LocalDataPlane.open(bookRoot)
      try {
        expect(existsSync(journalPathOf(bookRoot))).toBe(false)
        const prose = readProseChapter(bookRoot, proseChapterPath(1))
        if (stage === 'event-append' || stage === 'prose-flip') {
          // 线性化点之前被硬杀 ⇒ 回滚到提交前净态
          expect(prose.phase).toBe('draft')
          expect(prose.commitId).toBeUndefined()
          for (const stream of TRACKING_STREAMS) {
            expect(disk(bookRoot, stream.path)).toBe('')
          }
          expect(disk(bookRoot, RUNTIME_EVENTS_PATH)).toBe('')
        } else {
          // 线性化点之后被硬杀 ⇒ 前滚补齐为完整提交态
          expect(prose.phase).toBe('committed')
          expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
          expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
          expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
          const rows = recovered.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines').get() as { n: number }
          expect(rows.n).toBe(2)
        }
        expect(recovered.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      } finally {
        recovered.close()
      }
    },
  )
})

/* ---------------------------------------------------------------------------
 * REC-03：日志损坏 / 目标缺失 / 前缀冲突 —— 一律保留证据
 * ------------------------------------------------------------------------- */

describe('REC-03 损坏、缺失与冲突保留证据', () => {
  it('日志截断（非法 JSON）：抛可定位冲突而非 SyntaxError，日志与原件逐字节保留', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()] })
    const proseBefore = disk(bookRoot, proseChapterPath(1))
    const factBefore = disk(bookRoot, '追踪/事实.jsonl')

    const raw = readFileSync(journalPathOf(bookRoot), 'utf8')
    const truncated = raw.slice(0, Math.floor(raw.length / 2))
    writeFileSync(journalPathOf(bookRoot), truncated)

    let thrown: unknown
    try {
      recoverPendingCommit(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PendingCommitConflictError)
    expect(thrown).not.toBeInstanceOf(SyntaxError)
    expect(thrown).not.toBeInstanceOf(TypeError)
    const message = String((thrown as Error).message)
    expect(message).toContain(PENDING_COMMIT_PATH) // 可定位到日志文件
    expect(message).toContain('not valid JSON') // 具体原因
    // 宁败不脏：日志与原件逐字节保留
    expect(readFileSync(journalPathOf(bookRoot), 'utf8')).toBe(truncated)
    expect(disk(bookRoot, proseChapterPath(1))).toBe(proseBefore)
    expect(disk(bookRoot, '追踪/事实.jsonl')).toBe(factBefore)
  })

  it.each([
    ['空对象', '{}', 'journalVersion must be 1'],
    ['非对象（数组）', '[]', 'journal must be a JSON object'],
    [
      'journalVersion 未知',
      JSON.stringify({
        // W3 Contract Delta（t32 冻结）：journalVersion 2 已成为合法格式（携带 operation），
        // 故本行的"未知版本必须拒绝"示例改用 3——断言意图（未知版本一律拒）不变。
        journalVersion: 3,
        commitId: 'cmit_x',
        proseRelPath: 'p.md',
        originalProseSha256: 'a',
        stagedProseSha256: 'b',
        appends: [],
      }),
      'journalVersion must be 1 or 2, got 3',
    ],
    [
      'appends 不是数组',
      JSON.stringify({
        journalVersion: 1,
        commitId: 'cmit_x',
        proseRelPath: 'p.md',
        originalProseSha256: 'a',
        stagedProseSha256: 'b',
        appends: {},
      }),
      "journal field 'appends' must be an array",
    ],
    [
      'proseRelPath 非字符串',
      JSON.stringify({
        journalVersion: 1,
        commitId: 'cmit_x',
        proseRelPath: 7,
        originalProseSha256: 'a',
        stagedProseSha256: 'b',
        appends: [],
      }),
      "journal field 'proseRelPath' must be a string",
    ],
  ])('日志形状非法（%s）：抛可定位冲突而非 TypeError，日志原样保留', (_label, malformed, reason) => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()] })
    writeFileSync(journalPathOf(bookRoot), malformed)

    let thrown: unknown
    try {
      recoverPendingCommit(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PendingCommitConflictError)
    expect(thrown).not.toBeInstanceOf(TypeError)
    expect(thrown).not.toBeInstanceOf(SyntaxError)
    const message = String((thrown as Error).message)
    expect(message).toContain(PENDING_COMMIT_PATH) // 可定位到日志文件
    expect(message).toContain(reason) // 具体原因
    expect(readFileSync(journalPathOf(bookRoot), 'utf8')).toBe(malformed)
  })

  it('manifest 缺失 + pending journal：抛带路径的 MissingManifestError，日志与原件保留', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()] })
    const journalRaw = readFileSync(journalPathOf(bookRoot), 'utf8')
    const proseBefore = disk(bookRoot, proseChapterPath(1))
    rmSync(join(bookRoot, MANIFEST_PATH))

    let openThrown: unknown
    try {
      LocalDataPlane.open(bookRoot)
    } catch (error) {
      openThrown = error
    }
    expect(openThrown).toBeInstanceOf(MissingManifestError)
    expect((openThrown as MissingManifestError).manifestPath).toContain('manifest.json')
    expect(String((openThrown as Error).message)).toContain('manifest.json')

    // 宁败不脏：日志与正文原件原样保留
    expect(readFileSync(journalPathOf(bookRoot), 'utf8')).toBe(journalRaw)
    expect(disk(bookRoot, proseChapterPath(1))).toBe(proseBefore)

    // 缺失 manifest 是「根目录指错」的强信号，openOrRebuild 刻意不重建（既有设计），
    // 但必须是同一领域错误而不是裸 ENOENT
    let rebuildThrown: unknown
    try {
      LocalDataPlane.openOrRebuild(bookRoot)
    } catch (error) {
      rebuildThrown = error
    }
    expect(rebuildThrown).toBeInstanceOf(MissingManifestError)
    expect(existsSync(journalPathOf(bookRoot))).toBe(true)
  })

  it('manifest 损坏 + pending journal：open 抛带路径的 CorruptManifestError 并保留日志；openOrRebuild 经既有重建路径收敛', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] })
    const journal = readJournal(bookRoot)
    const factTarget = targetOf(journal, 'temporalFact')
    const timelineTarget = targetOf(journal, 'timelineEvent')
    const proseBefore = disk(bookRoot, proseChapterPath(1))
    writeFileSync(join(bookRoot, MANIFEST_PATH), 'not a json manifest at all')

    let thrown: unknown
    try {
      LocalDataPlane.open(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CorruptManifestError)
    expect((thrown as CorruptManifestError).manifestPath).toContain('manifest.json')
    // 宁败不脏：不删日志、不覆盖更新过的正文
    expect(existsSync(journalPathOf(bookRoot))).toBe(true)
    expect(readFileSync(journalPathOf(bookRoot), 'utf8')).toContain(journal.commitId)
    expect(disk(bookRoot, proseChapterPath(1))).toBe(proseBefore)

    // 既有重建路径重新可达：第二次 open 成功、journal 移除、正文 committed、追踪流恰一份增量
    const plane = LocalDataPlane.openOrRebuild(bookRoot)
    try {
      expect(existsSync(journalPathOf(bookRoot))).toBe(false)
      const prose = readProseChapter(bookRoot, proseChapterPath(1))
      expect(prose.phase).toBe('committed')
      expect(prose.commitId).toBe(journal.commitId)
      expect(disk(bookRoot, '追踪/事实.jsonl')).toBe(
        Buffer.from(factTarget.payloadBase64, 'base64').toString('utf8'),
      )
      expect(disk(bookRoot, '追踪/时间线.jsonl')).toBe(
        Buffer.from(timelineTarget.payloadBase64, 'base64').toString('utf8'),
      )
      expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
      const rows = plane.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines').get() as { n: number }
      expect(rows.n).toBe(2)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }

    // 不无限重建：收敛后再 open 一次即可正常打开
    const again = LocalDataPlane.open(bookRoot)
    try {
      expect(existsSync(journalPathOf(bookRoot))).toBe(false)
      expect(again.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      again.close()
    }
  })

  it('对照：manifest 损坏但无 pending journal 时 openOrRebuild 依旧收敛（修复未破坏既有重建路径）', () => {
    freshDraftBook()
    const committed = LocalDataPlane.open(bookRoot)
    try {
      committed.commitChapter({ chapterIndex: 1, summary: '干净提交', appends: { temporalFact: [factRow()] } })
    } finally {
      committed.close()
    }
    expect(existsSync(journalPathOf(bookRoot))).toBe(false)
    writeFileSync(join(bookRoot, MANIFEST_PATH), 'not a json manifest at all')

    const plane = LocalDataPlane.openOrRebuild(bookRoot)
    try {
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      const rows = plane.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines').get() as { n: number }
      expect(rows.n).toBe(1)
    } finally {
      plane.close()
    }
  })

  it('结构锁定：chapter.ts 的 manifest 读取已全部收口到 readManifest', () => {
    const source = readFileSync(new URL('./chapter.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('JSON.parse(readFileSync')
    expect(source).toContain('readManifest(root)')
    // 冗余绊线：容忍换行/空格的等价写法；行为用例（MissingManifestError/CorruptManifestError/收敛）才是真保证
    expect(source).not.toMatch(/JSON\.parse\s*\(\s*readFileSync/)
  })

  it('目标缺失：抛可定位冲突，日志与其余原件保留', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] })
    const timelineTarget = targetOf(readJournal(bookRoot), 'timelineEvent')
    rmSync(join(bookRoot, timelineTarget.relPath))

    let thrown: unknown
    try {
      recoverPendingCommit(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PendingCommitConflictError)
    expect((thrown as PendingCommitConflictError).relPath).toBe(timelineTarget.relPath)
    expect(existsSync(journalPathOf(bookRoot))).toBe(true)
    expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
  })

  it('前缀冲突：盘上字节与载荷不符时抛可定位冲突，日志与原件字节均保留', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()] })
    const factTarget = targetOf(readJournal(bookRoot), 'temporalFact')
    const tampered = 'X'.repeat(16)
    writeFileSync(join(bookRoot, factTarget.relPath), tampered)

    let thrown: unknown
    try {
      recoverPendingCommit(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PendingCommitConflictError)
    expect((thrown as PendingCommitConflictError).relPath).toBe(factTarget.relPath)
    expect(readFileSync(join(bookRoot, factTarget.relPath), 'utf8')).toBe(tampered)
    expect(existsSync(journalPathOf(bookRoot))).toBe(true)
  })

  it('投影既有行与载荷不一致：报错而非把 INSERT OR IGNORE 的忽略当成功', () => {
    freshDraftBook()
    // 崩在 manifest 阶段：投影行已插入，前滚必须核对既有行而不是静默忽略
    crashCommit(bookRoot, 'manifest', { temporalFact: [factRow()] })

    const db = openDatabase({ path: join(bookRoot, RUNTIME_DB_PATH) })
    try {
      db.prepare("UPDATE tracking_lines SET payload = ? WHERE kind = 'temporalFact' AND seq = 0").run(
        '{"tampered":true}',
      )
    } finally {
      db.close()
    }

    let thrown: unknown
    try {
      recoverPendingCommit(bookRoot)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(PendingCommitConflictError)
    expect(String((thrown as Error).message)).toContain('temporalFact#0')
    expect(existsSync(journalPathOf(bookRoot))).toBe(true)
  })
})

/* ---------------------------------------------------------------------------
 * REC-03b：journal 语义越界 —— 静默丢行必须变成可定位错误
 * ------------------------------------------------------------------------- */

/**
 * 崩在 projection 阶段留下合法 journal，再按 mutateJournal 改写整份日志后写回。
 * makeAppends 必须是**工厂**：行携带 bookId，必须在 freshDraftBook() 之后构造。
 */
function rewriteJournal(
  makeAppends: () => Appends,
  mutateJournal: (journal: Record<string, unknown>) => void,
): { journalRaw: string; proseBefore: string; streamsBefore: string[]; eventsBefore: string } {
  freshDraftBook()
  crashCommit(bookRoot, 'projection', makeAppends())
  const parsed = JSON.parse(readFileSync(journalPathOf(bookRoot), 'utf8')) as Record<string, unknown>
  mutateJournal(parsed)
  const journalRaw = `${JSON.stringify(parsed, null, 2)}\n`
  writeFileSync(journalPathOf(bookRoot), journalRaw)
  return {
    journalRaw,
    proseBefore: disk(bookRoot, proseChapterPath(1)),
    streamsBefore: TRACKING_STREAMS.map((stream) => disk(bookRoot, stream.path)),
    eventsBefore: disk(bookRoot, RUNTIME_EVENTS_PATH),
  }
}

/** 只改写某一个追加目标（按 kind 定位）的便捷包装。 */
function rewriteJournalAppend(
  makeAppends: () => Appends,
  targetKind: string | null,
  mutate: (target: Record<string, unknown>) => void,
): { journalRaw: string; proseBefore: string; streamsBefore: string[]; eventsBefore: string } {
  return rewriteJournal(makeAppends, (journal) => {
    const list = journal['appends'] as Record<string, unknown>[]
    const entry = list.find((item) => item['kind'] === targetKind)
    if (entry === undefined) {
      throw new Error(`journal has no append target for kind=${String(targetKind)}`)
    }
    mutate(entry)
  })
}

/** 断言恢复抛可定位领域错误，且 journal 与原件逐字节保留（journal 不得被当终态移除）。 */
function expectLocatableConflictPreservingEvidence(
  scene: { journalRaw: string; proseBefore: string; streamsBefore: string[]; eventsBefore: string },
  run: () => void,
): PendingCommitConflictError {
  let thrown: unknown
  try {
    run()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(PendingCommitConflictError)
  expect(thrown).not.toBeInstanceOf(SyntaxError)
  expect(thrown).not.toBeInstanceOf(TypeError)
  expect(String((thrown as Error).message)).toContain(PENDING_COMMIT_PATH)
  // 宁败不脏：journal 与原件逐字节保留，事务未被当作终态
  expect(existsSync(journalPathOf(bookRoot))).toBe(true)
  expect(readFileSync(journalPathOf(bookRoot), 'utf8')).toBe(scene.journalRaw)
  expect(disk(bookRoot, proseChapterPath(1))).toBe(scene.proseBefore)
  expect(TRACKING_STREAMS.map((stream) => disk(bookRoot, stream.path))).toEqual(scene.streamsBefore)
  expect(disk(bookRoot, RUNTIME_EVENTS_PATH)).toBe(scene.eventsBefore)
  return thrown as PendingCommitConflictError
}

function twoStreamAppends(): Appends {
  return { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] }
}

describe('REC-03b journal 语义越界：不得静默丢行', () => {
  it.each([['bogusKind'], ['temporalFact '], ['TEMPORALFACT']])(
    'kind 越界（%s）：动盘前抛可定位冲突，journal 与原件保留，追踪行未被丢弃',
    (badKind) => {
      const scene = rewriteJournalAppend(twoStreamAppends, 'temporalFact', (target) => {
        target['kind'] = badKind
      })
      expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
      // 文件面保持崩溃现场：事实流仍是已追加的 1 行，未被丢弃也未重复
      expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
      expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
    },
  )

  it.each([
    ['指向另一条追踪流', '追踪/时间线.jsonl'],
    ['指向非追踪流（events 账本）', '.mozhou/events.jsonl'],
  ])('kind 非 null 但 relPath %s：抛可定位冲突并保留证据', (_label, badRelPath) => {
    const scene = rewriteJournalAppend(twoStreamAppends, 'temporalFact', (target) => {
      target['relPath'] = badRelPath
    })
    expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
  })

  it('kind 非 null 但 baseSeq 为负数：抛可定位冲突并保留证据', () => {
    const scene = rewriteJournalAppend(twoStreamAppends, 'temporalFact', (target) => {
      target['baseSeq'] = -1
    })
    expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
  })

  it.each([
    ['含非法字符', '!!!not-base64!!!'],
    ['缺填充（重编码不一致）', 'YWJjZA'],
    ['含换行空白', 'YWJj\nZA=='],
  ])('payloadBase64 非法（%s）：抛可定位冲突并保留证据', (_label, badPayload) => {
    const scene = rewriteJournalAppend(twoStreamAppends, 'temporalFact', (target) => {
      target['payloadBase64'] = badPayload
    })
    expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
  })

  it.each([
    ['指向追踪流', '追踪/时间线.jsonl'],
    ['指向正文文件', '正文/第一卷/第0001章.md'],
  ])('kind=null（events 账本）但 relPath %s：抛可定位冲突，事件行不得被写进错误文件', (_label, badRelPath) => {
    const scene = rewriteJournalAppend(twoStreamAppends, null, (target) => {
      target['relPath'] = badRelPath
      // 关键：把 baseBytes 对齐到目标文件当前长度，形状仍然合法、分类会判为 untouched。
      // 修复前正是这样把事件行静默补写进错误文件并移除 journal（t8 N1：0→335B）。
      target['baseBytes'] = readFileSync(join(bookRoot, badRelPath)).length
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    // 可定位到具体字段值（journal 路径 + 被篡改的 relPath）
    expect(error.message).toContain(badRelPath)
    // 事件行未被静默写进错误文件：五族流与 events 都保持崩溃现场
    expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
  })

  it.each([
    ['0', 0],
    ['正数', 7],
  ])('kind=null（events 账本）但 baseSeq 改为 %s：抛可定位冲突并保留全部原件', (_label, badBaseSeq) => {
    const scene = rewriteJournalAppend(twoStreamAppends, null, (target) => {
      target['baseSeq'] = badBaseSeq
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    expect(error.message).toContain(String(badBaseSeq))
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
    expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
  })

  it('兼容锁定：kind=null 的 events 目标（baseSeq=-1 占位、.mozhou/events.jsonl）不被语义校验拦下', () => {
    freshDraftBook()
    const plane = LocalDataPlane.open(bookRoot)
    try {
      const result = plane.commitChapter({ chapterIndex: 1, summary: '正常提交', appends: twoStreamAppends() })
      expect(result.commitId).toMatch(/^cmit_/)
      expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})

/* ---------------------------------------------------------------------------
 * REC-03c：journal 目标集合不变量 —— 残缺事务不得被当终态
 * ------------------------------------------------------------------------- */

describe('REC-03c journal 目标集合不变量：残缺事务不得被静默当终态', () => {
  it('appends 为空数组：抛可定位冲突，journal 不得被移除', () => {
    const scene = rewriteJournal(twoStreamAppends, (journal) => {
      journal['appends'] = []
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    expect(error.message).toContain('at least one target')
    // 崩溃现场未被改动：两族流各 1 行，事件账本 1 行
    expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
    expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
  })

  it('缺少 kind=null 的 events 账本目标：抛可定位冲突并保留全部原件', () => {
    const scene = rewriteJournal(twoStreamAppends, (journal) => {
      const list = journal['appends'] as Record<string, unknown>[]
      journal['appends'] = list.filter((target) => target['kind'] !== null)
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    expect(error.message).toContain('exactly one kind=null')
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
  })

  it('两个 kind=null 的 events 账本目标：抛可定位冲突并保留全部原件', () => {
    const scene = rewriteJournal(twoStreamAppends, (journal) => {
      const list = journal['appends'] as Record<string, unknown>[]
      const eventsTarget = list.find((target) => target['kind'] === null)
      if (eventsTarget === undefined) {
        throw new Error('journal has no events target')
      }
      list.push({ ...eventsTarget })
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    expect(error.message).toContain('exactly one kind=null')
    expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
  })

  it('重复出现同一追踪 kind：抛可定位冲突并保留全部原件', () => {
    const scene = rewriteJournal(twoStreamAppends, (journal) => {
      const list = journal['appends'] as Record<string, unknown>[]
      const factTarget = list.find((target) => target['kind'] === 'temporalFact')
      if (factTarget === undefined) {
        throw new Error('journal has no temporalFact target')
      }
      list.push({ ...factTarget })
    })
    const error = expectLocatableConflictPreservingEvidence(scene, () => recoverPendingCommit(bookRoot))
    expect(error.message).toContain("must not repeat tracking kind 'temporalFact'")
    expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
  })

  it('兼容锁定：正常提交的 appends（恰好 1 个 events + 各不重复的追踪族）满足集合不变量', () => {
    freshDraftBook()
    const plane = LocalDataPlane.open(bookRoot)
    try {
      plane.commitChapter({ chapterIndex: 1, summary: '正常提交', appends: twoStreamAppends() })
      expect(existsSync(journalPathOf(bookRoot))).toBe(false)
      expect(jsonLines(bookRoot, '追踪/事实.jsonl')).toHaveLength(1)
      expect(jsonLines(bookRoot, '追踪/时间线.jsonl')).toHaveLength(1)
      expect(jsonLines(bookRoot, RUNTIME_EVENTS_PATH)).toHaveLength(1)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})

/* ---------------------------------------------------------------------------
 * REC-04：隔离副本上投影缺失 / 损坏
 * ------------------------------------------------------------------------- */

function isolatedCopy(root: string, suffix: string): string {
  const copyRoot = `${root}-${suffix}`
  tmpRoots.push(copyRoot)
  cpSync(root, copyRoot, { recursive: true })
  return copyRoot
}

function removeProjection(root: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${join(root, RUNTIME_DB_PATH)}${suffix}`, { force: true })
  }
}

describe('REC-04 隔离副本投影缺失/损坏', () => {
  it('投影缺失：文件面恢复先完成，重建后投影与追踪流一致', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] })

    const copyRoot = isolatedCopy(bookRoot, 'missing')
    removeProjection(copyRoot)

    // 普通 open：先完成文件面恢复，再因投影缺失抛错（可弃投影由重建派生）
    expect(() => LocalDataPlane.open(copyRoot)).toThrow(ProjectionMissingError)
    expect(existsSync(journalPathOf(copyRoot))).toBe(false)
    expect(jsonLines(copyRoot, '追踪/事实.jsonl')).toHaveLength(1)
    expect(jsonLines(copyRoot, '追踪/时间线.jsonl')).toHaveLength(1)

    const plane = LocalDataPlane.openOrRebuild(copyRoot)
    try {
      expect(existsSync(journalPathOf(copyRoot))).toBe(false)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      const rows = plane.db
        .prepare('SELECT kind, seq, payload FROM tracking_lines ORDER BY kind, seq')
        .all() as { kind: string; seq: number; payload: string }[]
      expect(rows.map((row) => `${row.kind}#${row.seq}`)).toEqual(['temporalFact#0', 'timelineEvent#0'])
      expect(rows[0]?.payload).toBe(jsonLines(copyRoot, '追踪/事实.jsonl')[0])
    } finally {
      plane.close()
    }
  })

  it('投影损坏：普通 open 宁败不脏（日志保留），重建后收敛', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()], timelineEvent: [timelineRow(1)] })

    const copyRoot = isolatedCopy(bookRoot, 'corrupt')
    removeProjection(copyRoot)
    writeFileSync(join(copyRoot, RUNTIME_DB_PATH), Buffer.from('not a sqlite database at all'))

    // 投影损坏：文件面已补齐但投影无法核对 ⇒ 抛出且保留 journal（不静默确认完成）
    expect(() => LocalDataPlane.open(copyRoot)).toThrow()
    expect(existsSync(journalPathOf(copyRoot))).toBe(true)

    const plane = LocalDataPlane.openOrRebuild(copyRoot)
    try {
      expect(existsSync(journalPathOf(copyRoot))).toBe(false)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      const rows = plane.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines').get() as { n: number }
      expect(rows.n).toBe(2)
    } finally {
      plane.close()
    }
  })
})

/* ---------------------------------------------------------------------------
 * 原子写：唯一独占临时文件、失败清理与 .mozhou-tmp 契约
 * ------------------------------------------------------------------------- */

function freshDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-${process.pid}-`))
  tmpRoots.push(root)
  return root
}

function tmpResidue(root: string): string[] {
  return readdirSync(root).filter((name) => name.includes(ATOMIC_TMP_SUFFIX))
}

describe('原子写：唯一独占临时文件、失败清理与后缀契约', () => {
  it('唯一命名：不触碰已存在的旧版固定临时文件，本次临时文件不残留', () => {
    const root = freshDir('mozhou-atomic-rec')
    const target = join(root, 'x.md')
    const legacy = `${target}${ATOMIC_TMP_SUFFIX}`
    writeFileSync(legacy, '他人正在写的临时内容')

    atomicWriteFileSync(target, '本次内容')

    expect(readFileSync(target, 'utf8')).toBe('本次内容')
    expect(existsSync(legacy)).toBe(true)
    expect(readFileSync(legacy, 'utf8')).toBe('他人正在写的临时内容')
    expect(tmpResidue(root)).toEqual([`x.md${ATOMIC_TMP_SUFFIX}`])
  })

  it('失败路径清理本次临时文件：写失败与 rename 失败都不留残留', () => {
    const root = freshDir('mozhou-atomic-rec')
    const writeTarget = join(root, 'w.md')
    expect(() => atomicWriteFileSync(writeTarget, undefined as unknown as string)).toThrow()
    expect(tmpResidue(root)).toEqual([])

    const dirTarget = join(root, 'as-dir')
    mkdirSync(dirTarget)
    expect(() => atomicWriteFileSync(dirTarget, 'x')).toThrow()
    expect(tmpResidue(root)).toEqual([])
    expect(existsSync(dirTarget)).toBe(true)
  })

  it('恢复清扫只删本次事务目标的临时文件，其他目标的临时文件不动', () => {
    freshDraftBook()
    crashCommit(bookRoot, 'projection', { temporalFact: [factRow()] })

    const proseResidue = join(bookRoot, `${proseChapterPath(1)}${ATOMIC_TMP_SUFFIX}-stale`)
    const otherResidue = join(bookRoot, `大纲/第一卷.md${ATOMIC_TMP_SUFFIX}-other`)
    writeFileSync(proseResidue, '半份正文')
    writeFileSync(otherResidue, '别人的临时文件')

    recoverPendingCommit(bookRoot)

    expect(existsSync(proseResidue)).toBe(false)
    expect(existsSync(otherResidue)).toBe(true)
    expect(readFileSync(otherResidue, 'utf8')).toBe('别人的临时文件')
  })

  it('备份过滤仍按 .mozhou-tmp 排除临时文件（唯一 token 命名不破坏契约）', () => {
    freshDraftBook()
    writeFileSync(join(bookRoot, `${proseChapterPath(1)}${ATOMIC_TMP_SUFFIX}-zzz`), '半份写入')

    const backup = createBookBackup(bookRoot)
    const paths = backup.manifest.files.map((item) => item.path)
    expect(paths.some((path) => path.includes(ATOMIC_TMP_SUFFIX))).toBe(false)
    expect(paths).toContain(proseChapterPath(1))
  })
})
