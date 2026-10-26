/** 同章旧生成不能覆盖新运行态；每次结果只回读本候选的真实合成文件。 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createBook, LocalDataPlane } from '@mozhou/data-plane'
import { PublishBus, RuntimeEngine, type CapabilityRecipe } from '@mozhou/runtime'
import type { ContextPacket } from '@mozhou/context-compiler'
import { readDraftCandidate } from './draft-candidate.js'
import { proseFileSha256 } from './draft-accept.js'
import { makeDraftProviderBinding, readDraftState, runDraftStep, type DraftBindingOptions } from './draft-step.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mozhou-draft-owner-'))
  roots.push(root)
  createBook({ dir: root, title: '隔离所有权样本' })
  const plane = LocalDataPlane.open(root)
  plane.createChapterDraft({ chapterIndex: 1, title: '合成章节' })
  plane.saveProseDraft({ chapterIndex: 1, body: '合成原正文。\n', expectedRevision: 0 })
  const bookId = plane.book.id
  plane.close()
  const base = { revision: 1, sha256: proseFileSha256(root, 1) }
  const candidate = (seedText?: string): DraftBindingOptions['candidate'] => {
    const id = randomUUID()
    return { id, generationId: 'gen_' + id, bookId, base, mode: seedText === undefined ? 'replace' : 'continue', ...(seedText === undefined ? {} : { seedText }) }
  }
  return { root, base, candidate }
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

/** 真正串行的临界区；模型流的屏障在其外部。 */
function bookLock(): NonNullable<DraftBindingOptions['withWriteLock']> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = tail.then(fn)
    tail = next.then(() => {}, () => {})
    return next
  }
}

function binding(root: string, candidate: DraftBindingOptions['candidate'], stream: DraftBindingOptions['stream'], lock: DraftBindingOptions['withWriteLock'], signal?: AbortSignal) {
  return makeDraftProviderBinding({ bookRoot: root, chapterIndex: 1, provider: 'deepseek', mode: candidate.mode === 'continue' ? 'continue' : 'generate', candidate, stream, withWriteLock: lock, ...(signal === undefined ? {} : { signal }) })
}

function drive(provider: ReturnType<typeof makeDraftProviderBinding>): Promise<string> {
  return (provider as unknown as () => Promise<string>)()
}

function oneChunk(text: string): DraftBindingOptions['stream'] {
  return async function* () { yield await Promise.resolve(text) }
}

function privateState(root: string, candidateId: string) {
  return JSON.parse(readFileSync(join(root, '.mozhou/drafts/candidates', candidateId + '.json'), 'utf8')) as { stateVersion: number; candidateId: string; status: string; appendedChars: number }
}

const PACKET: ContextPacket = { taskType: 'CHAPTER_DRAFTING', chapterIndex: 1, structural: [], settings: [], story: { text: '', tokens: 0, trimType: 'none' }, text: '合成输入', totalTokens: 3 }
const RECIPE: CapabilityRecipe = {
  id: 'draft-owner-test', recipeVersion: '1.0.0',
  source: { repo: 'original', commit: '0'.repeat(40), license: 'original', refinedAt: '2026-10-12', refineNote: '合成所有权用例' },
  brief: { capability: '正文草稿', runtimeSemantics: '候选隔离', triggers: ['draft'] }, taskType: 'CHAPTER_DRAFTING',
  entry: { routerDoc: 'docs/router.md', phases: ['draft'], stopPoints: [] }, references: [], artifacts: [], prechecks: [],
  trackingGate: { authorityState: '正文/第一卷/第0001章.md', casField: 'revision', transactionModes: ['append'], derivedViews: [], budgets: { hotContextBytes: 1024, perChapterReads: [] }, failureTaxonomy: 'validationFailed', hookPoint: 'postWrite' },
  contextBudget: { hotContextBytes: 1024, fixedSections: [], perChapterReads: [] },
}

function engine(root: string, provider: ReturnType<typeof makeDraftProviderBinding>) {
  const runtime = new RuntimeEngine({ bus: new PublishBus(), ctx: { root }, newTaskRef: () => 'owner_' + randomUUID() })
  runtime.registerCapability({ taskType: 'CHAPTER_DRAFTING', providerId: 'deepseek', providerVersion: '1.0.0', failurePolicy: { timeoutMs: 5_000, fallbackProviderIds: [] } })
  runtime.registerProviderBinding('deepseek', provider)
  return runtime
}

describe('章运行态所有权与候选结果回读', () => {
  it('A 停止 → B 完成 → A 迟到：章指针保持 B，A 自己保留取消半稿', async () => {
    const f = fixture(), a = f.candidate(), b = f.candidate(), lock = bookLock()
    const waiting = deferred(), late = deferred(), controller = new AbortController()
    const oldTask = drive(binding(f.root, a, async function* () {
      yield 'OLD_HALF'
      waiting.release()
      await late.promise
      yield 'OLD_LATE'
    }, lock, controller.signal))
    await waiting.promise
    controller.abort()
    await drive(binding(f.root, b, oneChunk('NEW_COMPLETE'), lock))
    const before = readDraftState(f.root, 1)
    late.release()
    await oldTask
    expect(readDraftState(f.root, 1)).toEqual(before)
    expect(before).toMatchObject({ candidateId: b.id, status: 'complete', chars: 12 })
    expect(readDraftCandidate(f.root, a.id)).toMatchObject({ text: 'OLD_HALF', taskState: 'cancelled' })
    expect(privateState(f.root, a.id)).toMatchObject({ candidateId: a.id, status: 'partial', appendedChars: 8 })
    expect(proseFileSha256(f.root, 1)).toBe(f.base.sha256)
  })

  it('A 的正常晚完成也不能抢回 B 的章指针；当前 B 正常落盘', async () => {
    const f = fixture(), a = f.candidate(), b = f.candidate(), lock = bookLock()
    const waiting = deferred(), late = deferred()
    const oldTask = drive(binding(f.root, a, async function* () { yield 'A'; waiting.release(); await late.promise; yield 'A' }, lock))
    await waiting.promise
    await drive(binding(f.root, b, oneChunk('CURRENT'), lock))
    late.release()
    await oldTask
    expect(readDraftState(f.root, 1)).toEqual(privateState(f.root, b.id))
    expect({ ...readDraftState(f.root, 1), candidateId: 'current-candidate' }).toMatchInlineSnapshot(`
      {
        "appendedChars": 7,
        "candidateId": "current-candidate",
        "chapterIndex": 1,
        "chars": 7,
        "proseRelPath": "正文/第一卷/第0001章.md",
        "stateVersion": 1,
        "status": "complete",
      }
    `)
    expect(privateState(f.root, a.id)).toMatchObject({ candidateId: a.id, status: 'complete', appendedChars: 2 })
  })

  it('初始等锁期间取消的 A 不能认领已完成的 B，也不启动模型流', async () => {
    const f = fixture(), a = f.candidate(), b = f.candidate(), lock = bookLock()
    const queued = deferred(), release = deferred(), controller = new AbortController()
    let lockCalls = 0, streamCalls = 0
    const pausedLock: NonNullable<DraftBindingOptions['withWriteLock']> = async (fn) => {
      if (++lockCalls === 1) { queued.release(); await release.promise }
      return await lock(fn)
    }
    const oldTask = drive(binding(f.root, a, () => { streamCalls += 1; return oneChunk('FORBIDDEN')() }, pausedLock, controller.signal))
    await queued.promise
    controller.abort()
    await drive(binding(f.root, b, oneChunk('CURRENT'), lock))
    const before = readDraftState(f.root, 1)
    release.release()
    await oldTask
    expect(streamCalls).toBe(0)
    expect(readDraftState(f.root, 1)).toEqual(before)
    expect(privateState(f.root, a.id)).toMatchObject({ candidateId: a.id, status: 'partial', appendedChars: 0 })
  })

  it('旧 A 失败后 runDraftStep 读取 A 的半稿/产出，不能借用已完成 B 的状态', async () => {
    const f = fixture(), a = f.candidate(), b = f.candidate(), lock = bookLock()
    const waiting = deferred(), late = deferred()
    const oldEngine = engine(f.root, binding(f.root, a, async function* () { yield 'OWN_HALF'; waiting.release(); await late.promise; throw new Error('OLD_TASK_FAILURE') }, lock))
    const oldTask = runDraftStep({ engine: oldEngine, bookRoot: f.root, chapterIndex: 1, candidateId: a.id, packet: PACKET, recipe: RECIPE })
    await waiting.promise
    const current = await runDraftStep({ engine: engine(f.root, binding(f.root, b, oneChunk('NEW_COMPLETE'), lock)), bookRoot: f.root, chapterIndex: 1, candidateId: b.id, packet: PACKET, recipe: RECIPE })
    late.release()
    const old = await oldTask
    expect(current).toMatchObject({ outcome: 'succeeded', text: 'NEW_COMPLETE', partial: false, produced: true })
    expect(old).toMatchObject({ outcome: 'failed_terminal', text: 'OWN_HALF', chars: 8, partial: true, produced: true, reason: 'OLD_TASK_FAILURE' })
    expect(readDraftState(f.root, 1)).toMatchObject({ candidateId: b.id, status: 'complete' })
  })

  it('续写 A 只有基底时 produced 为 false，不能从全文或 B 的产出猜测', async () => {
    const f = fixture(), a = f.candidate('ONLY_SEED'), b = f.candidate(), lock = bookLock()
    const waiting = deferred(), late = deferred()
    const oldEngine = engine(f.root, binding(f.root, a, async function* () { waiting.release(); await late.promise; throw new Error('NO_NEW_OUTPUT'); yield '' }, lock))
    const oldTask = runDraftStep({ engine: oldEngine, bookRoot: f.root, chapterIndex: 1, candidateId: a.id, packet: PACKET, recipe: RECIPE, mode: 'continue' })
    await waiting.promise
    await drive(binding(f.root, b, oneChunk('NEW_COMPLETE'), lock))
    late.release()
    expect(await oldTask).toMatchObject({ text: 'ONLY_SEED', partial: true, produced: false })
  })

  it('旧章状态属于同候选时兼容回读；默认旧调用仍支持章文件', async () => {
    const f = fixture(), a = f.candidate(), lock = bookLock()
    await drive(binding(f.root, a, oneChunk('LEGACY'), lock))
    rmSync(join(f.root, '.mozhou/drafts/candidates', a.id + '.json'))
    const legacyEngine = engine(f.root, () => Promise.resolve('LEGACY'))
    expect(await runDraftStep({ engine: legacyEngine, bookRoot: f.root, chapterIndex: 1, candidateId: a.id, packet: PACKET, recipe: RECIPE })).toMatchObject({ text: 'LEGACY', produced: true, partial: false })
    expect(await runDraftStep({ engine: legacyEngine, bookRoot: f.root, chapterIndex: 1, packet: PACKET, recipe: RECIPE })).toMatchObject({ text: 'LEGACY', produced: true, partial: false })
  })

  it('没有 A 私有状态且章指针为 B 时，不把 B 的 appendedChars 借给 A', async () => {
    const f = fixture(), a = f.candidate(), b = f.candidate(), lock = bookLock()
    await drive(binding(f.root, a, oneChunk('LEGACY_A'), lock))
    rmSync(join(f.root, '.mozhou/drafts/candidates', a.id + '.json'))
    await drive(binding(f.root, b, oneChunk('B'), lock))
    const legacyEngine = engine(f.root, () => Promise.resolve('LEGACY_A'))
    expect(await runDraftStep({ engine: legacyEngine, bookRoot: f.root, chapterIndex: 1, candidateId: a.id, packet: PACKET, recipe: RECIPE })).toMatchObject({ text: 'LEGACY_A', produced: false })
  })

  it('非法候选路径在引擎启动前拒绝', async () => {
    const f = fixture()
    let calls = 0
    const runtime = engine(f.root, () => { calls += 1; return Promise.resolve('UNREACHABLE') })
    await expect(runDraftStep({ engine: runtime, bookRoot: f.root, chapterIndex: 1, candidateId: '../escape', packet: PACKET, recipe: RECIPE })).rejects.toMatchObject({ code: 'INVALID_CANDIDATE_ID' })
    expect(calls).toBe(0)
    expect(existsSync(join(f.root, '.mozhou/drafts/candidates'))).toBe(false)
  })
})
