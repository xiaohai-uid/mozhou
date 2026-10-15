/**
 * S2 回归锁：等候选写锁期间取消 ⇒ 待写 delta 不得落盘，也不得按「自然结束」认定成功。
 *
 * 独立验收实跑输入：让 delta 的写锁排队，期间取消，再释放锁。
 * 修复前候选由空变成 30 字、最终状态还是 succeeded/complete。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { LocalDataPlane, createBook } from '@mozhou/data-plane'
import { createDraftCandidate, readDraftCandidate } from './draft-candidate.js'
import { makeDraftProviderBinding } from './draft-step.js'
import { proseFileSha256 } from './draft-accept.js'

const DELTA = 'SHOULD_NOT_PERSIST_AFTER_ABORT'

/** 绑定忽略 payload/snapshot（零参闭包），这里以零参方式驱动它。 */
function drive(binding: ReturnType<typeof makeDraftProviderBinding>): Promise<string> {
  return (binding as unknown as () => Promise<string>)()
}

function makeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'mozhou-lock-abort-'))
  const root = join(tempDir, '测试书')
  createBook({ dir: root, title: '测试书' })
  const plane = LocalDataPlane.open(root)
  plane.createChapterDraft({ chapterIndex: 1, title: '第一章' })
  plane.saveProseDraft({ chapterIndex: 1, body: '作者正文原文。\n', expectedRevision: 0 })
  const scan = plane.getProseChapter(1)
  plane.close()
  const bookId = (JSON.parse(readFileSync(join(root, 'book.json'), 'utf8')) as { id: string }).id
  const candidateId = randomUUID()
  const base = { revision: scan.revision, sha256: proseFileSha256(root, 1) }
  createDraftCandidate(root, {
    id: candidateId,
    generationId: 'gen_' + candidateId,
    bookId,
    chapterIndex: 1,
    base,
    mode: 'replace',
  })
  return { tempDir, root, candidateId, bookId, base }
}

describe('draft-step · 等候选写锁期间取消（S2）', () => {
  it('等锁期间取消：待写 delta 不落盘，候选字节不变，不认定成功', async () => {
    const { tempDir, root, candidateId, bookId, base } = makeFixture()
    try {
      const controller = new AbortController()
      let lockCalls = 0
      const binding = makeDraftProviderBinding({
        bookRoot: root,
        chapterIndex: 1,
        provider: 'deepseek',
        mode: 'generate',
        stream: () => Readable.from([DELTA]),
        candidate: { id: candidateId, generationId: 'gen_' + candidateId, bookId, base, mode: 'replace' },
        signal: controller.signal,
        withWriteLock: async (fn) => {
          lockCalls += 1
          // 第 1 次是候选读取/建候选；第 2 次是追加 delta —— 模拟「等锁期间作者按了停止」
          if (lockCalls === 2) controller.abort()
          return await fn()
        },
      })

      const text = await drive(binding)
      expect(text).toBe('')
      const candidate = readDraftCandidate(root, candidateId)
      expect(candidate?.text).toBe('')
      expect(candidate?.taskState).not.toBe('succeeded')
      expect(candidate?.status).not.toBe('complete')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('未取消时同一路径正常落盘（对照：修复不放宽正常路径）', async () => {
    const { tempDir, root, candidateId, bookId, base } = makeFixture()
    try {
      const binding = makeDraftProviderBinding({
        bookRoot: root,
        chapterIndex: 1,
        provider: 'deepseek',
        mode: 'generate',
        stream: () => Readable.from([DELTA]),
        candidate: { id: candidateId, generationId: 'gen_' + candidateId, bookId, base, mode: 'replace' },
        withWriteLock: async (fn) => await fn(),
      })

      const text = await drive(binding)
      expect(text).toBe(DELTA)
      expect(readDraftCandidate(root, candidateId)?.taskState).toBe('succeeded')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
