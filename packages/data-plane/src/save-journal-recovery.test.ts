/**
 * 保存路径（saveProseDraft）journal 崩溃注入恢复（议题 #98）。
 *
 * 现状缺口：`saveProseDraft` 没有 onStage 故障注入钩子（对比 `commitChapter`），
 * recovery-reentry 的 REC-01~04 全部构造自**提交**路径；「保存形状 journal 触发
 * `recoverPendingCommit`」此前没有被任何测试直接执行。
 *
 * 本文件不改 `chapter.ts`（该文件正被另一条工作线改动），改用**等价且更稳**的做法：
 * 按 `saveProseDraft` 真实的写盘顺序，在临时书根上手工复现两个崩溃窗口的现场，
 * 再调用既有恢复入口 `recoverPendingCommit`，断言恢复后正文/版本正确且无半份文件。
 *
 * 据以推导 journal 形状与写入顺序的源码位置（packages/data-plane/src/chapter.ts）：
 * - 写 v2 轻量 journal：`saveProseDraft` 第 1283–1292 行（`writeJournal`，第 317–319 行
 *   落 `.mozhou/pending-commit.json`，`JSON.stringify(journal, null, 2)` + 末尾换行）；
 * - journal 字段集：`PendingCommitJournal` 第 264–278 行；`appends` 目标形状
 *   `JournalAppendTarget` 第 254–262 行；保存路径的 appends 只放**一个空载荷**
 *   events 账本目标（第 1276–1282 行）；
 * - 顺序：先 `writeJournal`（1283）→ 再 `atomicReplace` 正文（1295）→ 再 manifest
 *   （1296–1297）→ 再写操作结果记录（1299–1311）→ 最后 `unlinkSync` journal（1312）。
 *
 * 隔离夹具与同目录既有测试同构（tmpdir 建书 + LocalDataPlane.open），不读写真实书稿。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ATOMIC_TMP_SUFFIX } from './atomic-write.js'
import { normalizeProseBody, readProseChapter, recoverPendingCommit, renderProseChapter } from './chapter.js'
import { createBook } from './create-book.js'
import { PENDING_COMMIT_PATH, RUNTIME_EVENTS_PATH, proseChapterPath } from './layout.js'
import { LocalDataPlane } from './local-data-plane.js'
import { readManifest } from './manifest.js'
import { operationRecordPath, readOperationRecord } from './operations.js'
import { sha256FileHex, sha256Hex } from './sha256.js'

const tmpRoots: string[] = []
let bookRoot = ''

beforeEach(() => {
  bookRoot = join(tmpdir(), `mozhou-save-journal-${process.pid}-${Math.random().toString(36).slice(2)}`)
  tmpRoots.push(bookRoot)
  mkdirSync(bookRoot, { recursive: true })
})

afterAll(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const PROSE_REL = proseChapterPath(1)

/** 最小书籍布局 + 一章已保存草稿（正文 '初稿'，revision 1）。 */
function seedDraftBook(): { bookId: string } {
  createBook({ dir: bookRoot, title: '保存路径 journal 恢复测试书' })
  const plane = LocalDataPlane.open(bookRoot)
  try {
    plane.createChapterDraft({ chapterIndex: 1, title: '风起' })
    plane.saveProseDraft({ chapterIndex: 1, body: '初稿', expectedRevision: 0 })
    return { bookId: plane.book.id }
  } finally {
    plane.close()
  }
}

interface SaveOperationIntent {
  readonly operationType: 'prose.save'
  readonly operationId: string
  readonly principalId: string
  readonly bookId: string
  readonly requestDigest: string
}

/**
 * 逐字段复现 `saveProseDraft` 写下的 v2 轻量 journal（chapter.ts:1283–1292）。
 * appends 恰好一个 kind=null 的 events 账本目标、空载荷、baseSeq 占位 -1。
 */
function writeSaveShapeJournal(fields: {
  readonly originalProseSha256: string
  readonly stagedProseSha256: string
  readonly operation: SaveOperationIntent
}): void {
  const journal = {
    journalVersion: 2,
    commitId: '',
    chapterIndex: 1,
    proseRelPath: PROSE_REL,
    originalProseSha256: fields.originalProseSha256,
    stagedProseSha256: fields.stagedProseSha256,
    appends: [
      {
        kind: null,
        relPath: RUNTIME_EVENTS_PATH,
        baseBytes: statSync(join(bookRoot, RUNTIME_EVENTS_PATH)).size,
        baseSeq: -1,
        payloadBase64: '',
      },
    ],
    operation: fields.operation,
  }
  writeFileSync(join(bookRoot, PENDING_COMMIT_PATH), `${JSON.stringify(journal, null, 2)}\n`)
}

/** 目标文件残留的原子写临时文件（`<target>.mozhou-tmp-*`，即崩溃留下的「半份文件」）。 */
function tmpFilesFor(relPath: string): string[] {
  const dir = dirname(join(bookRoot, relPath))
  const prefix = `${basename(relPath)}${ATOMIC_TMP_SUFFIX}`
  return readdirSync(dir).filter((entry) => entry.startsWith(prefix))
}

function stagedProseOf(source: { mozhouId: string; chapterIndex: number; revision: number }, body: string): string {
  return renderProseChapter({
    mozhouId: source.mozhouId,
    revision: source.revision + 1,
    chapterIndex: source.chapterIndex,
    phase: 'draft',
    body: normalizeProseBody(body),
  })
}

describe('保存路径 journal 崩溃恢复（saveProseDraft 形状）', () => {
  it('崩溃窗口一：journal 已落盘、正文未更新 → 恢复回滚到崩溃前正文与版本，清扫半份文件', () => {
    const { bookId } = seedDraftBook()
    const seeded = readProseChapter(bookRoot, PROSE_REL)
    expect(seeded.body).toBe('初稿\n')
    expect(seeded.revision).toBe(1)

    // 崩在 writeJournal（chapter.ts:1283）与 atomicReplace（chapter.ts:1295）之间：
    // journal 在盘，正文仍是旧版本（staged 内容从未落盘）。
    const stagedContent = stagedProseOf(seeded, '二稿')
    writeSaveShapeJournal({
      originalProseSha256: sha256FileHex(join(bookRoot, PROSE_REL)),
      stagedProseSha256: sha256Hex(stagedContent),
      operation: {
        operationType: 'prose.save',
        operationId: 'op_save_crash_backward',
        principalId: 'user_local',
        bookId,
        requestDigest: 'sha256:crash-backward',
      },
    })
    // 再模拟 atomicReplace 自己的临时写窗口被中断：半份正文残留在 <prose>.mozhou-tmp-*
    writeFileSync(
      `${join(bookRoot, PROSE_REL)}${ATOMIC_TMP_SUFFIX}-crashhalf`,
      stagedContent.slice(0, Math.floor(stagedContent.length / 2)),
    )
    const eventsBefore = readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')

    // 恢复前（坏）：悬挂 journal + 半份临时文件 + 作者要的 '二稿' 尚未落盘（正文为旧版本）
    expect(existsSync(join(bookRoot, PENDING_COMMIT_PATH))).toBe(true)
    expect(tmpFilesFor(PROSE_REL)).toHaveLength(1)
    const beforeRecovery = readProseChapter(bookRoot, PROSE_REL)
    expect(beforeRecovery.body).toBe('初稿\n')
    expect(beforeRecovery.body).not.toContain('二稿')
    expect(beforeRecovery.revision).toBe(1)

    recoverPendingCommit(bookRoot)

    // 恢复后（对）：journal 移除、半份临时文件清扫、正文/版本为崩溃前的正确值（原子回滚）
    expect(existsSync(join(bookRoot, PENDING_COMMIT_PATH))).toBe(false)
    expect(tmpFilesFor(PROSE_REL)).toHaveLength(0)
    const afterRecovery = readProseChapter(bookRoot, PROSE_REL)
    expect(afterRecovery.body).toBe('初稿\n')
    expect(afterRecovery.revision).toBe(1)
    expect(afterRecovery.phase).toBe('draft')
    // events 账本零字节变化（保存路径 journal 的载荷为空）
    expect(readFileSync(join(bookRoot, RUNTIME_EVENTS_PATH), 'utf8')).toBe(eventsBefore)
    // 崩在写操作结果之前：回滚不留下半份身份记录
    expect(readOperationRecord(bookRoot, 'op_save_crash_backward')).toBeNull()
    expect(existsSync(operationRecordPath(bookRoot, 'op_save_crash_backward'))).toBe(false)

    // 重开平面：基线自洽，且恢复幂等（无 journal 零开销）
    const reopened = LocalDataPlane.open(bookRoot)
    try {
      expect(reopened.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
      expect(readProseChapter(bookRoot, PROSE_REL).revision).toBe(1)
    } finally {
      reopened.close()
    }
    recoverPendingCommit(bookRoot)
    expect(existsSync(join(bookRoot, PENDING_COMMIT_PATH))).toBe(false)
  })

  it('崩溃窗口二：正文已翻转但收尾未完成 → 恢复前滚补齐 manifest 与操作结果，回读正文/版本正确', () => {
    const { bookId } = seedDraftBook()
    const seeded = readProseChapter(bookRoot, PROSE_REL)
    expect(seeded.body).toBe('初稿\n')
    expect(seeded.revision).toBe(1)
    const originalSha = sha256FileHex(join(bookRoot, PROSE_REL))

    // 崩在 atomicReplace（chapter.ts:1295）之后、写 manifest（1296–1297）/
    // 操作结果（1299–1311）/ 删 journal（1312）之前：正文已翻转，收尾未完成。
    const stagedBody = normalizeProseBody('二稿')
    const stagedContent = stagedProseOf(seeded, '二稿')
    writeFileSync(join(bookRoot, PROSE_REL), stagedContent)
    writeSaveShapeJournal({
      originalProseSha256: originalSha,
      stagedProseSha256: sha256Hex(stagedContent),
      operation: {
        operationType: 'prose.save',
        operationId: 'op_save_crash_forward',
        principalId: 'user_local',
        bookId,
        requestDigest: 'sha256:crash-forward',
      },
    })

    // 恢复前（坏）：悬挂 journal + 操作结果缺失（重试会重复执行而非回放）+ manifest 基线陈旧
    expect(existsSync(join(bookRoot, PENDING_COMMIT_PATH))).toBe(true)
    expect(readOperationRecord(bookRoot, 'op_save_crash_forward')).toBeNull()
    expect(readManifest(bookRoot).files[PROSE_REL]?.sha256).not.toBe(sha256FileHex(join(bookRoot, PROSE_REL)))

    recoverPendingCommit(bookRoot)

    // 恢复后（对）：journal 移除、结果记录补齐、manifest 与盘一致，正文/版本正确
    expect(existsSync(join(bookRoot, PENDING_COMMIT_PATH))).toBe(false)
    const record = readOperationRecord(bookRoot, 'op_save_crash_forward')
    expect(record).not.toBeNull()
    expect(record?.operationId).toBe('op_save_crash_forward')
    expect(record?.operationType).toBe('prose.save')
    expect(record?.principalId).toBe('user_local')
    expect(record?.requestDigest).toBe('sha256:crash-forward')
    expect(record?.result.appliedRevision).toBe(2)
    expect(record?.result.appliedBodyHash).toBe(sha256Hex(stagedBody))

    const afterRecovery = readProseChapter(bookRoot, PROSE_REL)
    expect(afterRecovery.body).toBe('二稿\n')
    expect(afterRecovery.revision).toBe(2)
    expect(readManifest(bookRoot).files[PROSE_REL]?.sha256).toBe(sha256FileHex(join(bookRoot, PROSE_REL)))

    const reopened = LocalDataPlane.open(bookRoot)
    try {
      expect(reopened.verifyBaseline()).toMatchObject({ modified: [], missing: [], untracked: [] })
    } finally {
      reopened.close()
    }
  })
})
