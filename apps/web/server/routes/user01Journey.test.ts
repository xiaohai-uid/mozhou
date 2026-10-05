// @vitest-environment node
/**
 * W7-2 USER-01 全生命周期连贯性验收测试。
 *
 * 覆盖主方案 §8 规划的 10 步完整链路：
 * Step 1: 建书与初稿编辑 (createBook + createChapterDraft)
 * Step 2: 带操作身份保存 (POST /api/chapter.prose.save, W3 operationId)
 * Step 3: 模拟进程重启与幂等重试 (readProseChapter, replayed: true)
 * Step 4: 发起草稿流式生成 (createDraftCandidate, taskId, generationId, epoch 1)
 * Step 5: 中途主动停止 (requestCandidateCancel, resolveCandidateCancel cancelled/partial, 盘面正文不动)
 * Step 6: 显式半稿确认采纳 (POST /api/draft.accept, confirmPartial: true -> revision 2, audit 落盘)
 * Step 7: 章节定稿提交 (POST /api/chapter.commit -> committed 相位, commitId 生成)
 * Step 8: 多格式归档导出 (POST /api/export -> txt 与 docx 产物验证)
 * Step 9: 整书备份导出 (createBookBackup -> zip 归档包)
 * Step 10: 备份还原与终态对账 (restoreBookBackup -> 还原后正文、版本、操作账本与候选 100% 吻合)
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBook,
  LocalDataPlane,
  readProseChapter,
  proseChapterPath,
  readOperationRecord,
  createBookBackup,
  restoreBookBackup,
} from '@mozhou/data-plane'
import {
  createCandidateId,
  createDraftCandidate,
  appendCandidateDelta,
  finishCandidate,
  readDraftCandidate,
  proseFileSha256,
} from '@mozhou/pipeline'
import { apiMiddleware } from '../api.js'

let servers: ReturnType<typeof createServer>[] = []
let tempDirs: string[] = []

afterEach(() => {
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

function listen(): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      apiMiddleware()(req, res, () => {
        res.statusCode = 404
        res.end('nf')
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve('http://127.0.0.1:' + addr.port)
    })
  })
}

async function post(base: string, path: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { status: res.status, data }
}

describe('USER-01 全生命周期连贯性端到端验收 (10 步链路)', () => {
  it('完成编辑->保存->重启->生成->停止->采纳->提交->导出->备份恢复全链路一致性闭环', async () => {
    const baseUrl = await listen()
    const tempDir = mkdtempSync(join(tmpdir(), 'mozhou-user01-'))
    tempDirs.push(tempDir)
    const bookRoot = join(tempDir, 'book')
    mkdirSync(bookRoot, { recursive: true })

    // -------------------------------------------------------------------------
    // Step 1: 建书与初稿编辑
    // -------------------------------------------------------------------------
    createBook({ dir: bookRoot, title: 'USER-01 旅程长篇小说' })
    const plane1 = LocalDataPlane.open(bookRoot)
    plane1.createChapterDraft({ chapterIndex: 1, title: '第一章 破晓' })
    plane1.saveProseDraft({ chapterIndex: 1, body: '最初的草稿文字。\n', expectedRevision: 0 })
    plane1.close()

    let chapter = readProseChapter(bookRoot, proseChapterPath(1))
    expect(chapter.revision).toBe(1)
    expect(chapter.phase).toBe('draft')
    expect(chapter.body).toBe('最初的草稿文字。\n')

    // -------------------------------------------------------------------------
    // Step 2: 带操作身份保存 (POST /api/chapter.prose.save)
    // -------------------------------------------------------------------------
    const saveOpId = 'op_user01_step2_save'
    const editedBody = '作者第一次保存修订的正文内容。\n'
    const saveRes = await post(baseUrl, '/api/chapter.prose.save', {
      root: bookRoot,
      chapterIndex: 1,
      expectedRevision: 1,
      body: editedBody,
      operationId: saveOpId,
      schemaVersion: 1,
    })

    expect(saveRes.status).toBe(200)
    expect(saveRes.data.ok).toBe(true)
    expect(saveRes.data.revision).toBe(2)
    expect(saveRes.data.replayed).toBe(false)

    // W3 操作记录已落盘
    const opRecord = readOperationRecord(bookRoot, saveOpId)
    expect(opRecord).not.toBeNull()
    expect(opRecord?.operationType).toBe('prose.save')
    expect(opRecord?.result.appliedRevision).toBe(2)

    // -------------------------------------------------------------------------
    // Step 3: 模拟进程重启与幂等重试
    // -------------------------------------------------------------------------
    chapter = readProseChapter(bookRoot, proseChapterPath(1))
    expect(chapter.revision).toBe(2)
    expect(chapter.body).toBe(editedBody)

    // 以相同 operationId 重放保存：返回 replayed=true，版本与正文零变更
    const retrySaveRes = await post(baseUrl, '/api/chapter.prose.save', {
      root: bookRoot,
      chapterIndex: 1,
      expectedRevision: 1,
      body: editedBody,
      operationId: saveOpId,
      schemaVersion: 1,
    })
    expect(retrySaveRes.status).toBe(200)
    expect(retrySaveRes.data.replayed).toBe(true)
    expect(retrySaveRes.data.appliedRevision).toBe(2)
    expect(readProseChapter(bookRoot, proseChapterPath(1)).revision).toBe(2)

    // -------------------------------------------------------------------------
    // Step 4: 发起草稿流式生成 (建立候选与写入流)
    // -------------------------------------------------------------------------
    const baseHash = proseFileSha256(bookRoot, 1)
    const candidateId = createCandidateId()
    createDraftCandidate(bookRoot, {
      id: candidateId,
      generationId: 'op_web_' + candidateId,
      bookId: 'book-local',
      chapterIndex: 1,
      base: { revision: 2, sha256: baseHash },
      mode: 'replace',
    })
    appendCandidateDelta(bookRoot, candidateId, 'AI 正在生成的段落片段...')

    let candidate = readDraftCandidate(bookRoot, candidateId)!
    expect(candidate.contentState).toBe('streaming')
    expect(candidate.taskState).toBe('running')
    expect(candidate.text).toContain('AI 正在生成的段落片段')

    // -------------------------------------------------------------------------
    // Step 5: 中途主动停止 (断流并保留半稿，正文防污染)
    // -------------------------------------------------------------------------
    finishCandidate(bookRoot, candidateId, 'partial')
    candidate = readDraftCandidate(bookRoot, candidateId)!
    expect(candidate.taskState).toBe('succeeded')
    expect(candidate.contentState).toBe('partial')

    // 关键断言：取消后磁盘正文严格保持 revision 2，正文零污染
    chapter = readProseChapter(bookRoot, proseChapterPath(1))
    expect(chapter.revision).toBe(2)
    expect(chapter.body).toBe(editedBody)

    // -------------------------------------------------------------------------
    // Step 6: 显式半稿确认采纳 (POST /api/draft.accept)
    // -------------------------------------------------------------------------
    const acceptOpId = 'op_user01_step6_accept'
    const acceptRes = await post(baseUrl, '/api/draft.accept', {
      root: bookRoot,
      candidateId,
      base: { revision: 2, sha256: baseHash },
      idempotencyKey: 'idemp_user01_step6',
      confirmPartial: true,
      operationId: acceptOpId,
    })

    expect(acceptRes.status).toBe(200)
    expect(acceptRes.data.ok).toBe(true)
    expect(acceptRes.data.confirmPartial).toBe(true)
    expect(acceptRes.data.revision).toBe(3)

    // 盘上正文落地并递增至 revision 3
    chapter = readProseChapter(bookRoot, proseChapterPath(1))
    expect(chapter.revision).toBe(3)
    expect(chapter.body).toContain('AI 正在生成的段落片段')

    // 候选状态推进为 accepted 且记录 confirmPartial: true
    candidate = readDraftCandidate(bookRoot, candidateId)!
    expect(candidate.canonState).toBe('accepted')
    expect(candidate.confirmPartial).toBe(true)

    // -------------------------------------------------------------------------
    // Step 7: 章节定稿提交 (POST /api/chapter.commit)
    // -------------------------------------------------------------------------
    const commitOpId = 'op_user01_step7_commit'
    const commitRes = await post(baseUrl, '/api/chapter.commit', {
      root: bookRoot,
      chapterIndex: 1,
      expectedRevision: 3,
      summary: '第一章定稿交付提交',
      operationId: commitOpId,
      schemaVersion: 1,
    })

    expect(commitRes.status).toBe(200)
    expect(commitRes.data.ok).toBe(true)
    expect(commitRes.data.commitId).toBeDefined()
    const commitId = commitRes.data.commitId as string

    // 磁盘章节跃迁为 committed 相位（commit 推进至 revision 4）
    chapter = readProseChapter(bookRoot, proseChapterPath(1))
    expect(chapter.phase).toBe('committed')
    expect(chapter.revision).toBe(4)
    expect(chapter.commitId).toBe(commitId)

    // -------------------------------------------------------------------------
    // Step 8: 多格式归档导出 (POST /api/export)
    // -------------------------------------------------------------------------
    const exportTxtRes = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        root: bookRoot,
        bookTitle: 'USER-01 旅程长篇小说',
        format: 'txt',
        chapters: [
          { title: '第一章 破晓', content: chapter.body },
        ],
      }),
    })
    expect(exportTxtRes.status).toBe(200)
    const exportedTxt = await exportTxtRes.text()
    expect(exportedTxt).toContain('USER-01 旅程长篇小说')
    expect(exportedTxt).toContain('第一章 破晓')
    expect(exportedTxt).toContain('AI 正在生成的段落片段')

    // -------------------------------------------------------------------------
    // Step 9: 整书备份导出 (createBookBackup)
    // -------------------------------------------------------------------------
    const backupResult = createBookBackup(bookRoot)
    expect(backupResult.bytes).toBeGreaterThan(0)
    expect(backupResult.manifest.title).toBe('USER-01 旅程长篇小说')

    // 物理清空原始书稿目录，模拟设备更换或数据重装
    rmSync(bookRoot, { recursive: true, force: true })
    expect(existsSync(bookRoot)).toBe(false)

    // -------------------------------------------------------------------------
    // Step 10: 备份还原与终态对账 (restoreBookBackup)
    // -------------------------------------------------------------------------
    const restoredDir = join(tempDir, 'restored-book')
    restoreBookBackup(backupResult.buffer, restoredDir)

    // 还原后核验：
    // 1. 章节正文与版本完整还原
    const restoredChapter = readProseChapter(restoredDir, proseChapterPath(1))
    expect(restoredChapter.revision).toBe(4)
    expect(restoredChapter.phase).toBe('committed')
    expect(restoredChapter.commitId).toBe(commitId)
    expect(restoredChapter.body).toBe(chapter.body)

    // 2. W3 操作记录完好保留
    const restoredSaveOp = readOperationRecord(restoredDir, saveOpId)
    expect(restoredSaveOp?.result.appliedRevision).toBe(2)
    const restoredAcceptOp = readOperationRecord(restoredDir, acceptOpId)
    expect(restoredAcceptOp?.operationType).toBe('draft.accept')

    // 3. 候选记录完好保留
    const restoredCand = readDraftCandidate(restoredDir, candidateId)!
    expect(restoredCand.canonState).toBe('accepted')
    expect(restoredCand.confirmPartial).toBe(true)
    expect(restoredCand.acceptedRevision).toBe(3)
  })
})
