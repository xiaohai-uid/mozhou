/**
 * T3（实现票 #17）行为黑盒：全部经 LocalDataPlane 接缝打——
 * 相位机 / 原子三件套 / 双向崩溃恢复 / I5 不可变断言 / S2 检测面 / S3 写前校验。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ChapterPhaseError,
  PendingCommitConflictError,
  PreWriteHashMismatchError,
  readProseChapter,
} from './chapter.js'
import { createBook } from './create-book.js'
import { RUNTIME_EVENTS_PATH, STYLE_PROFILE_PATH, TRACKING_STREAMS, proseChapterPath } from './layout.js'
import { LocalDataPlane } from './local-data-plane.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-t3-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function newBook(): LocalDataPlane {
  createBook({ dir: bookRoot, title: '墨舟测试书' })
  return LocalDataPlane.open(bookRoot)
}

function disk(rel: string): string {
  return readFileSync(join(bookRoot, rel), 'utf8')
}

function jsonLines(rel: string): string[] {
  return disk(rel).split('\n').filter((line) => line.length > 0)
}

/** 外部编辑器模拟：绕过应用直改盘上文件。 */
function editExternally(rel: string, mutate: (current: string) => string): void {
  writeFileSync(join(bookRoot, rel), mutate(readFileSync(join(bookRoot, rel), 'utf8')))
}

describe('章节相位机：建章草稿', () => {
  it('章大纲节点 + draft 正文一次落两件，frontmatter 携带冻结字段集，基线登记后核对干净', () => {
    const plane = newBook()
    try {
      const draft = plane.createChapterDraft({ chapterIndex: 1, title: '风起' })

      expect(draft.outlineRelPath).toBe('大纲/章节/第0001章.md')
      expect(draft.proseRelPath).toBe('正文/第一卷/第0001章.md')

      const prose = readProseChapter(bookRoot, draft.proseRelPath)
      expect(prose.phase).toBe('draft')
      expect(prose.commitId).toBeUndefined()
      expect(prose.mozhouId).toBe(draft.chapterNodeId)
      expect(prose.chapterIndex).toBe(1)

      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})

describe('原子提交三件套', () => {
  it('正文翻转为 committed + 钉 commitId；追踪流逐行追加；事件行携带内容摘要；投影同步、基线干净', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const result = plane.commitChapter({
        chapterIndex: 1,
        summary: '主角登舟',
        appends: {
          temporalFact: [{ id: 'fact_A', subject: 'char:linwan', predicate: 'located', value: '墨舟' }],
          timelineEvent: [{ id: 'tle_B', summary: '开篇' }],
        },
      })

      expect(result.commitId).toMatch(/^cmit_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(result.appendedCounts).toEqual({ temporalFact: 1, timelineEvent: 1 })

      const prose = readProseChapter(bookRoot, result.proseRelPath)
      expect(prose.phase).toBe('committed')
      expect(prose.commitId).toBe(result.commitId)

      expect(jsonLines('追踪/事实.jsonl')).toHaveLength(1)
      const factLine = jsonLines('追踪/事实.jsonl')[0] ?? ''
      expect(JSON.parse(factLine)).toMatchObject({ id: 'fact_A' })
      expect(jsonLines('追踪/时间线.jsonl')).toHaveLength(1)

      expect(jsonLines(RUNTIME_EVENTS_PATH)).toHaveLength(1)
      const event = JSON.parse(jsonLines(RUNTIME_EVENTS_PATH)[0] ?? '') as Record<string, unknown>
      expect(event).toMatchObject({
        type: 'ChapterCommitted',
        commitId: result.commitId,
        contentSha256: result.contentSha256,
        summary: '主角登舟',
      })

      const rows = plane.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines WHERE kind = ?').get('temporalFact') as { n: number }
      expect(rows.n).toBe(1)

      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})

describe('原子性：中途失败不产生半提交可见状态（验收①）', () => {
  it.each(['journal-durable', 'stream-append', 'event-append', 'prose-flip'] as const)(
    '线性化点（%s）之前中断 ⇒ open() 回滚到提交前净态',
    (stage) => {
      const plane = newBook()
      let threw = false
      try {
        plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { temporalFact: [{ id: 'fact_A' }] },
          onStage: (reached) => {
            if (reached === stage) {
              throw new Error(`simulated crash at ${stage}`)
            }
          },
        })
      } catch (error) {
        threw = true
        expect((error as Error).message).toContain(stage)
      }
      expect(threw).toBe(true)
      // 进程已"崩"，同一实例不再使用；重新打开即恢复
      plane.close()

      const recovered = LocalDataPlane.open(bookRoot)
      try {
        expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
        expect(recovered.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
        const prose = readProseChapter(bookRoot, proseChapterPath(1))
        expect(prose.phase).toBe('draft')
        expect(prose.commitId).toBeUndefined()
        // 全部追踪流回到提交前空态
        for (const stream of TRACKING_STREAMS) {
          expect(disk(stream.path)).toBe('')
        }
        expect(disk(RUNTIME_EVENTS_PATH)).toBe('')
      } finally {
        recovered.close()
      }
    },
  )

  it.each(['projection', 'manifest'] as const)(
    '线性化点（%s）之后中断 ⇒ open() 前滚补齐为完整提交态',
    (stage) => {
      const plane = newBook()
      try {
        plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
        expect(() =>
          plane.commitChapter({
            chapterIndex: 1,
            summary: 'x',
            appends: { temporalFact: [{ id: 'fact_A' }] },
            onStage: (reached) => {
              if (reached === stage) {
                throw new Error(`simulated crash at ${stage}`)
              }
            },
          }),
        ).toThrow(stage)
      } finally {
        plane.close()
      }

      // 崩溃后提交意图仍在日志里：从日志取 commitId，验证前滚把它落实为可见状态
      const journal = JSON.parse(readFileSync(join(bookRoot, '.mozhou/pending-commit.json'), 'utf8')) as {
        commitId: string
      }
      const recovered = LocalDataPlane.open(bookRoot)
      try {
        expect(journal.commitId).toMatch(/^cmit_/)
        expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
        expect(recovered.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
        const prose = readProseChapter(bookRoot, proseChapterPath(1))
        expect(prose.phase).toBe('committed')
        expect(prose.commitId).toBe(journal.commitId)
        const rows = recovered.db.prepare('SELECT COUNT(*) AS n FROM tracking_lines WHERE kind = ?').get('temporalFact') as {
          n: number
        }
        expect(rows.n).toBe(1)
        expect(disk(RUNTIME_EVENTS_PATH)).toContain('"ChapterCommitted"')
      } finally {
        recovered.close()
      }
    },
  )

  it('撕裂写（流文件被截在载荷中段）也被回滚归零', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { temporalFact: [{ id: 'fact_A' }, { id: 'fact_B' }] },
          onStage: (reached) => {
            if (reached === 'event-append') {
              throw new Error('simulated crash mid-stream')
            }
          },
        }),
      ).toThrow(/mid-stream/)
    } finally {
      plane.close()
    }

    // 人为把追加截断在中段，模拟 appendFileSync 中途断电的撕裂写
    writeFileSync(join(bookRoot, '追踪/事实.jsonl'), '{"id":"fact_A"}\n{"id":"fact_')

    const recovered = LocalDataPlane.open(bookRoot)
    try {
      expect(disk('追踪/事实.jsonl')).toBe('')
      expect(recovered.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      recovered.close()
    }
  })

  it('崩溃窗口内正文被外部改动 ⇒ 恢复宁败不脏', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      expect(() =>
        plane.commitChapter({
          chapterIndex: 1,
          summary: 'x',
          appends: { temporalFact: [{ id: 'fact_A' }] },
          onStage: (reached) => {
            if (reached === 'manifest') {
              editExternally(proseChapterPath(1), (raw) => `${raw}\n外部插入\n`)
              throw new Error('simulated crash with racing external edit')
            }
          },
        }),
      ).toThrow(/racing/)
    } finally {
      plane.close()
    }
    expect(() => LocalDataPlane.open(bookRoot)).toThrow(PendingCommitConflictError)
  })
})

describe('I5：旧 commit 永不改写（验收②）', () => {
  it('重开再提交产生新 cmit；首个 commit 的账本前缀（事件行 + 各流行）逐字节恒定', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      const first = plane.commitChapter({
        chapterIndex: 1,
        summary: '一提',
        finalProse: '# 风起\n\n第一版定稿。\n',
        appends: { temporalFact: [{ id: 'fact_A', v: 1 }] },
      })

      const eventsAfterFirst = disk(RUNTIME_EVENTS_PATH)
      const factsAfterFirst = disk('追踪/事实.jsonl')

      const reopened = plane.reopenChapter(1)
      expect(reopened.reopenedFromCommitId).toBe(first.commitId)

      const second = plane.commitChapter({
        chapterIndex: 1,
        summary: '二提',
        finalProse: '# 风起\n\n改写后的正文。\n',
        appends: { temporalFact: [{ id: 'fact_A2', v: 2 }] },
      })

      expect(second.commitId).not.toBe(first.commitId)
      // 账本 append-only：旧字节是新文件的严格前缀，一提的物理痕迹零改写
      expect(disk(RUNTIME_EVENTS_PATH).startsWith(eventsAfterFirst)).toBe(true)
      expect(disk('追踪/事实.jsonl').startsWith(factsAfterFirst)).toBe(true)

      const firstEvent = JSON.parse(eventsAfterFirst.split('\n')[0] ?? '') as {
        commitId: string
        contentSha256: string
      }
      expect(firstEvent.commitId).toBe(first.commitId)
      expect(firstEvent.contentSha256).toBe(first.contentSha256)

      const prose = readProseChapter(bookRoot, proseChapterPath(1))
      expect(prose.phase).toBe('committed')
      expect(prose.commitId).toBe(second.commitId)
    } finally {
      plane.close()
    }
  })

  it('reopen：相位移回 draft、摘除 commitId、revision+1、正文保留，并追加审计事件', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.commitChapter({ chapterIndex: 1, summary: 'x', finalProse: '# 风起\n\n定稿。\n' })
      const committedRevision = readProseChapter(bookRoot, proseChapterPath(1)).revision

      plane.reopenChapter(1)
      const prose = readProseChapter(bookRoot, proseChapterPath(1))
      expect(prose.phase).toBe('draft')
      expect(prose.commitId).toBeUndefined()
      expect(prose.revision).toBe(committedRevision + 1)
      expect(prose.body).toContain('定稿')

      expect(disk(RUNTIME_EVENTS_PATH)).toContain('"ChapterReopened"')
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})

describe('S2 检测面：只有 phase=committed 的正文章外部修改触发对账（验收③）', () => {
  it('草稿随便改不入面；committed 正文与规划层修改入面', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '草稿章' })
      plane.createChapterDraft({ chapterIndex: 2, title: '定稿章' })
      plane.commitChapter({ chapterIndex: 2, summary: 'x' })

      editExternally(proseChapterPath(1), (raw) => `${raw}草稿涂鸦\n`)
      editExternally(proseChapterPath(2), (raw) => `${raw}外部改写已提交章\n`)
      editExternally(STYLE_PROFILE_PATH, (raw) => `${raw}\n外部动过文风\n`)

      const report = plane.verifyBaseline()
      expect(report.draftFreeEdits).toEqual([proseChapterPath(1)])
      expect(report.reconcileSurface).toEqual(expect.arrayContaining([proseChapterPath(2), STYLE_PROFILE_PATH]))
      expect(report.modified).toHaveLength(3)
    } finally {
      plane.close()
    }
  })

  it('已提交正文章被外部删除 ⇒ 缺失保守入对账面', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.commitChapter({ chapterIndex: 1, summary: 'x' })
      rmSync(join(bookRoot, proseChapterPath(1)))

      const report = plane.verifyBaseline()
      expect(report.missing).toEqual([proseChapterPath(1)])
      expect(report.reconcileSurface).toEqual([proseChapterPath(1)])
    } finally {
      plane.close()
    }
  })
})

describe('S3 写前校验与相位守卫', () => {
  it('外部改动未对账时挂起写入：draft 与 committed 一律拒绝静默覆盖', () => {
    const plane = newBook()
    try {
      // draft 被外部改过 ⇒ commit 拒绝（S3 单一规则覆盖全部文件类型）
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      editExternally(proseChapterPath(1), (raw) => `${raw}未对账的外部修改\n`)
      expect(() => plane.commitChapter({ chapterIndex: 1, summary: 'x' })).toThrow(PreWriteHashMismatchError)
    } finally {
      plane.close()
    }
  })

  it('已提交正文章被外部改动后，reopen 触发写前校验拒绝', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.commitChapter({ chapterIndex: 1, summary: 'x' })
      editExternally(proseChapterPath(1), (raw) => `${raw}外部改写已提交章\n`)
      expect(() => plane.reopenChapter(1)).toThrow(PreWriteHashMismatchError)
    } finally {
      plane.close()
    }
  })

  it('重复提交未重开的章节抛相位违例；重开 draft 章同样违例', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
      plane.commitChapter({ chapterIndex: 1, summary: 'x' })
      expect(() => plane.commitChapter({ chapterIndex: 1, summary: 'y' })).toThrow(ChapterPhaseError)

      plane.reopenChapter(1)
      expect(() => plane.reopenChapter(1)).toThrow(ChapterPhaseError)
    } finally {
      plane.close()
    }
  })

  it('多章并存：各章相位互不干扰，第二提交只追加自己的增量', () => {
    const plane = newBook()
    try {
      plane.createChapterDraft({ chapterIndex: 1, title: '一章' })
      plane.createChapterDraft({ chapterIndex: 2, title: '二章' })
      plane.commitChapter({ chapterIndex: 1, summary: 'a', appends: { temporalFact: [{ id: 'f1' }] } })
      plane.commitChapter({ chapterIndex: 2, summary: 'b', appends: { temporalFact: [{ id: 'f2' }] } })

      expect(jsonLines('追踪/事实.jsonl')).toHaveLength(2)
      expect(readProseChapter(bookRoot, proseChapterPath(1)).commitId).toBeDefined()
      expect(readProseChapter(bookRoot, proseChapterPath(2)).commitId).toBeDefined()
      expect(existsSync(join(bookRoot, '.mozhou/pending-commit.json'))).toBe(false)
      expect(plane.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      plane.close()
    }
  })
})
