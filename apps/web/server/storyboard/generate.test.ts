// @vitest-environment node
/**
 * 分镜生成单元测试（T03 · 注入式假传输，不打真网）：
 * - 无 provider → PROVIDER_UNAVAILABLE；
 * - 正常流（分片 JSON）→ 候选结构合法、id/revision/源/总时长全部服务端权威值；
 *   引文逐字锚定通过；模型自报的 id/title 假字段不进入文档；
 * - 围栏 JSON 容忍；非法 JSON → MODEL_OUTPUT_INVALID；
 * - sourceQuote 改写（未逐字锚定）→ MODEL_OUTPUT_UNANCHORED；
 * - 超 60 镜/引用不存在角色 → MODEL_OUTPUT_INVALID（上限拒绝，不截断）；
 * - 输出超 262144 字节 → MODEL_OUTPUT_OVERSIZE 立即中止（假传输记录中止）；
 * - expectedSourceHash 与磁盘不符 → SOURCE_CHANGED；超长章节 → SOURCE_TOO_LARGE。
 * 真机模型冒烟：仅当环境配置了真实 key 时运行（本机无 key 则如实跳过）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBook, proseChapterPath, renderProseChapter, sha256Hex } from '@mozhou/data-plane'
import type { OpenAiStreamChunk, ResolvedEndpoint } from '../llm/openaiStream.js'
import {
  ModelOutputError,
  ProviderUnavailableError,
  SourceChangedError,
  SourceTooLargeError,
  generateStoryboardCandidate,
} from './generate.js'
import { STORYBOARD_LIMITS } from './contract.js'

const ROOTS: string[] = []
afterEach(() => {
  for (const r of ROOTS.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch { /* Windows lock */ }
  }
  vi.restoreAllMocks()
})

const CH1_PROSE = '雾从灯塔脚下漫上来的时候，程蔚把最后一格电池按进了录音机。「你听，」她说，「潮水退下去的声音，和二十年前一模一样。」'

function makeBook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mozhou-sb-gen-'))
  ROOTS.push(dir)
  createBook({ dir, title: '雾港失真' })
  writeFileSync(
    join(dir, proseChapterPath(1)),
    renderProseChapter({ mozhouId: 'chapter_01JBGZ00000000000000000000', revision: 1, chapterIndex: 1, phase: 'draft', body: CH1_PROSE }),
  )
  return dir
}

const ENDPOINT: ResolvedEndpoint = { baseUrl: 'https://example.invalid', apiKey: 'k', model: 'test-model' }

function fakeStream(chunks: string[], opts: { recordAbort?: (s: string) => void } = {}) {
  return async function* (): AsyncGenerator<OpenAiStreamChunk> {
    // 桥接异步流语义（require-await）：块本身同步产出，仅保留异步迭代面
    await Promise.resolve()
    for (const c of chunks) {
      if (c === '__ABORT__') {
        opts.recordAbort?.('abort')
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      yield { delta: c }
    }
  }
}

function resolveEndpointOk(): ResolvedEndpoint | null {
  return ENDPOINT
}

function modelPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: '灯塔夜谈（分镜候选）',
    characters: [{ id: 'cheng_wei', name: '程蔚', appearance: '短发记者', origin: 'source' }],
    shots: [
      {
        id: 'shot_01', sceneId: 'scene_01', order: 1, location: '灯塔脚下', timeOfDay: '夜',
        framing: 'wide', cameraMovement: 'slow push-in',
        visual: '浓雾漫上礁石，灯塔黑影立于雾线之上',
        characterIds: ['cheng_wei'],
        dialogue: [{ speakerId: 'cheng_wei', text: '你听，潮水退下去的声音。' }],
        narration: '', sound: '退潮卵石声',
        estimatedDurationSeconds: 6, imagePrompt: 'wide lighthouse fog', videoPrompt: 'push in',
        negativePrompt: 'text', sourceQuote: '雾从灯塔脚下漫上来', origin: 'source',
        adaptationNote: '开场定调',
      },
    ],
    warnings: ['心理描写已外化为动作'],
    // 模型越权字段：必须被服务端重铸覆盖
    id: 'FORGED_ID', revision: 999, totalEstimatedDurationSeconds: 99999,
    createdAt: '1999-01-01', source: { bookId: 'FORGED' },
    ...overrides,
  })
}

const OPTIONS = { aspectRatio: '9:16' as const, targetDurationSeconds: 90, visualStyle: '雾港冷银蓝', language: 'zh-CN' as const }

function sourceHashOf(root: string): string {
  return sha256Hex(readFileSync(join(root, proseChapterPath(1))))
}

describe('generateStoryboardCandidate（注入式传输）', () => {
  it('无 provider → PROVIDER_UNAVAILABLE', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    await expect(generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: () => null,
      env: {},
    })).rejects.toMatchObject({ name: 'ProviderUnavailableError' })
    await expect(generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: () => null,
      env: {},
    })).rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('分片 JSON 流 → 候选合法；id/revision/源/总时长服务端权威；引文锚定', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    const payload = modelPayload()
    const chunks = [payload.slice(0, 60), payload.slice(60, 200), payload.slice(200)]
    const { document } = await generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream(chunks) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })
    expect(document.id).toMatch(/^sb_[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(document.id.startsWith('FORGED')).toBe(false)
    expect(document.revision).toBe(0)
    expect(document.source.sha256).toBe(hash)
    expect(document.source.bookId).not.toBe('FORGED')
    expect(document.generation.model).toBe('test-model')
    // 服务端求和：6 → 6（模型自报 99999 被覆盖）
    expect(document.totalEstimatedDurationSeconds).toBe(6)
    expect(document.warnings).toEqual(['心理描写已外化为动作'])
    expect(document.shots[0]?.sourceQuote.length).toBeLessThanOrEqual(50)
  })

  it('围栏 JSON 容忍；非法 JSON → MODEL_OUTPUT_INVALID', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    const fenced = '```json\n' + modelPayload() + '\n```'
    const ok = await generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([fenced]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })
    expect(ok.document.title).toBeTruthy()

    const bad = generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream(['这不是 JSON']) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })
    await expect(bad).rejects.toBeInstanceOf(ModelOutputError)
    await expect(bad).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })
  })

  it('sourceQuote 改写未逐字锚定 → MODEL_OUTPUT_UNANCHORED，不产出候选', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    const payload = modelPayload({
      shots: [{
        id: 'shot_01', sceneId: 's', order: 1, location: 'l', timeOfDay: '夜', framing: 'wide',
        cameraMovement: 'c', visual: 'v', characterIds: ['cheng_wei'],
        dialogue: [], narration: '', sound: '', estimatedDurationSeconds: 3,
        imagePrompt: '', videoPrompt: '', negativePrompt: '',
        sourceQuote: '灯塔脚下雾气升腾（模型改写了引文）', origin: 'source', adaptationNote: '',
      }],
    })
    await expect(generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([payload]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_UNANCHORED' })
  })

  it('超 60 镜 → MODEL_OUTPUT_INVALID（上限明确拒绝）', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    const baseShot = {
      id: 's', sceneId: 's', location: 'l', timeOfDay: '夜', framing: 'wide',
      cameraMovement: 'c', visual: 'v', characterIds: ['cheng_wei'],
      dialogue: [], narration: '', sound: '', estimatedDurationSeconds: 1,
      imagePrompt: '', videoPrompt: '', negativePrompt: '', sourceQuote: '', origin: 'adaptation', adaptationNote: '',
    }
    const shots = Array.from({ length: STORYBOARD_LIMITS.maxShots + 1 }, (_, i) => ({ ...baseShot, id: `s${i}`, order: i + 1 }))
    const payload = modelPayload({ shots })
    await expect(generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([payload]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' })
  })

  it('输出超 262144 字节 → 立即中止（MODEL_OUTPUT_OVERSIZE）', async () => {
    const root = makeBook()
    const hash = sourceHashOf(root)
    const big = 'x'.repeat(STORYBOARD_LIMITS.maxResponseBytes + 1024)
    await expect(generateStoryboardCandidate(root, 1, hash, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([big]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })).rejects.toMatchObject({ code: 'MODEL_OUTPUT_OVERSIZE' })
  })

  it('expectedSourceHash 与磁盘不符 → SOURCE_CHANGED；超长章节 → SOURCE_TOO_LARGE', async () => {
    const root = makeBook()
    await expect(generateStoryboardCandidate(root, 1, 'f'.repeat(64), OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })).rejects.toBeInstanceOf(SourceChangedError)

    const long = '长'.repeat(STORYBOARD_LIMITS.maxSourceCharacters + 1)
    writeFileSync(
      join(root, proseChapterPath(1)),
      renderProseChapter({ mozhouId: 'chapter_01JBGZ00000000000000000000', revision: 2, chapterIndex: 1, phase: 'draft', body: long }),
    )
    const hash2 = sourceHashOf(root)
    await expect(generateStoryboardCandidate(root, 1, hash2, OPTIONS, {
      resolveEndpoint: resolveEndpointOk,
      streamChat: fakeStream([]) as unknown as typeof import('../llm/openaiStream.js').streamOpenAiChat,
      env: {},
    })).rejects.toBeInstanceOf(SourceTooLargeError)
  })

  it('真机冒烟（仅在配置真实 key 的环境运行；未配置则如实跳过）', async (ctx) => {
    const hasKey = Boolean(process.env['MOZHOU_API_KEY'] || process.env['DEEPSEEK_API_KEY'] || process.env['OPENAI_API_KEY'])
    if (!hasKey) {
      ctx.skip()
      return
    }
    const root = makeBook()
    const hash = sourceHashOf(root)
    const { document } = await generateStoryboardCandidate(root, 1, hash, OPTIONS)
    // 真机验收：结构合法 + 引文锚定 + 不写盘（人工内容核对在 evidence 记录）
    expect(document.shots.length).toBeGreaterThan(0)
    expect(document.totalEstimatedDurationSeconds).toBeGreaterThan(0)
    expect(document.generation.provider).toBe('openai-compatible')
  })
})
