import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { foldNarrativeRows, type EntityRef, type FactId } from '@mozhou/kernel'
import {
  BUNDLED_MODEL_ID,
  createLocalEmbeddingProvider,
  ensureCudaSkipEnv,
  ModelAssetsError,
} from './embedding.js'
import type { LocalEmbeddingProvider } from './embedding.js'
import { DEFAULT_KHOP_RECALL_CONFIG, recallCandidates } from './recall.js'

/** 测试锚点：包根（本文件位于 src/ 下）。 */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_MODELS_DIR = join(PKG_ROOT, 'assets', 'models')
const MODEL_DIR = join(ASSETS_MODELS_DIR, 'bge-small-zh-v1.5')
// 清单随模型目录自包含（可整体拷贝分发的自校验单元）；自身不入册（自指悖论）。
const MANIFEST_PATH = join(MODEL_DIR, 'manifest.json')

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 全树文件扫描，返回 assets/models 下相对 POSIX 路径（排序）。 */
function listFilesRecursively(root: string, rel = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(root, rel))) {
    const childRel = rel ? `${rel}/${name}` : name
    if (statSync(join(root, childRel)).isDirectory()) {
      files.push(...listFilesRecursively(root, childRel))
    } else {
      files.push(childRel)
    }
  }
  return files.sort()
}

interface ManifestModelEntry {
  readonly id: string
  readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
}

function norm(v: ReadonlyArray<number>): number {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const dot = a.reduce((sum, x, i) => {
    const bi = b[i]
    return bi === undefined ? sum : sum + x * bi
  }, 0)
  return dot / (norm(a) * norm(b))
}

describe('内置模型断网冷启动（P0 硬断言）', () => {
  let restoreFetch: () => void = () => {}
  let provider: LocalEmbeddingProvider

  beforeAll(async () => {
    // 封锁全局 fetch 再走完整装载生命周期——任何联网企图即刻爆炸。
    const realFetch = globalThis.fetch
    globalThis.fetch = () => {
      throw new Error('OFFLINE GUARD: network access attempted during embedding load')
    }
    restoreFetch = () => {
      globalThis.fetch = realFetch
    }
    provider = await createLocalEmbeddingProvider()
  })
  afterAll(() => restoreFetch())

  it('produces normalized 512-dim vectors with zero network access', async () => {
    expect(provider.modelId).toBe(BUNDLED_MODEL_ID)
    expect(provider.dimensions).toBe(512)

    const query = await provider.queryEmbed('主角为了给家人治病筹钱做了什么？')
    expect(query).toHaveLength(512)
    expect(norm(query)).toBeCloseTo(1, 4)

    const passages = await provider.passageEmbed([
      '他把怀表当掉换三十两银子给妹妹抓药。',
      '她在书房里练字临帖。',
    ])
    expect(passages).toHaveLength(2)
    for (const p of passages) {
      expect(p).toHaveLength(512)
      expect(norm(p)).toBeCloseTo(1, 4)
    }
  })

  it('ranks the semantically relevant passage first', async () => {
    const query = await provider.queryEmbed('主角为了给家人治病筹钱做了什么？')
    const passages = await provider.passageEmbed([
      '他把怀表当掉换三十两银子给妹妹抓药。', // 相关
      '他在书房里练字临帖。',
      '船夫说江上夜航危险。',
      '她把嫁妆首饰变卖了还债。',
    ])
    const sims = passages.map((p) => cosine(query, p))
    const topIndex = sims.indexOf(Math.max(...sims))
    expect(topIndex).toBe(0)
  })

  it('纯 CPU 单查询延迟冒烟：warm 后 5 次采样中位 <100ms（#24 AC①；T9 基准 18ms；#45 负载感知化）', async () => {
    // 这是负载感知的 CPU 冒烟而非精度断言（#45）：全量 vitest 并行下 CPU 饱和
    // 会整体抬高墙钟时间——原「单次 <50ms」对调度敏感，实测满载冲到 63.93ms、
    // 探针诊断尾部达 133ms 而隔离跑恒绿，属假红。取 5 次采样中位数滤除瞬时
    // 毛刺，阈值放宽至 100ms（实测满载中位 ~34ms，仍有 ~3× 余量）；病态回归
    // 照样落网：热路径混入同步 IO 或模型改走网络加载时，中位数将达数百 ms。
    await provider.queryEmbed('预热查询，排除 ONNX session 冷启动')
    const samples: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now()
      await provider.queryEmbed('主角为了给家人治病筹钱做了什么？')
      samples.push(performance.now() - start)
    }
    const medianMs = [...samples].sort((a, b) => a - b)[2]!
    expect(medianMs).toBeLessThan(100)
  })
})

describe('资产哈希登记进构建产物清单', () => {
  it('covers every asset file on disk with exact sha256 and byte size, and nothing else', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestModelEntry
    expect(manifest.id).toBe(BUNDLED_MODEL_ID)

    const diskPaths = listFilesRecursively(MODEL_DIR).filter((rel) => rel !== 'manifest.json')
    const listedPaths = manifest.files.map((f) => f.path).sort()
    expect(diskPaths).toEqual(listedPaths)

    for (const file of manifest.files) {
      const abs = join(MODEL_DIR, file.path)
      expect(sha256File(abs), file.path).toBe(file.sha256)
      expect(statSync(abs).size, file.path).toBe(file.bytes)
    }
  })
})

describe('装载封装的纯本地失败模式', () => {
  it('fails fast with an actionable pointer when bundled assets are missing', async () => {
    const error = await createLocalEmbeddingProvider({
      modelDir: '/nonexistent/mozhou/bge-small-zh-v1.5',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelAssetsError)
    expect((error as Error).message).toMatch(/docs\/install\.md/)
  })
})

describe('ONNXRUNTIME_NODE_INSTALL_CUDA 环境守卫', () => {
  it('defaults to skip when unset and preserves explicit values', () => {
    const previous = process.env.ONNXRUNTIME_NODE_INSTALL_CUDA
    try {
      delete process.env.ONNXRUNTIME_NODE_INSTALL_CUDA
      ensureCudaSkipEnv()
      expect(process.env.ONNXRUNTIME_NODE_INSTALL_CUDA).toBe('skip')

      process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = 'explicit-value-preserved'
      ensureCudaSkipEnv()
      expect(process.env.ONNXRUNTIME_NODE_INSTALL_CUDA).toBe('explicit-value-preserved')
    } finally {
      if (previous === undefined) {
        delete process.env.ONNXRUNTIME_NODE_INSTALL_CUDA
      } else {
        process.env.ONNXRUNTIME_NODE_INSTALL_CUDA = previous
      }
    }
  })
})

/* ----------------------------------------------------------------------------
 * 三通道召回真模型端到端（#24 AC②）
 * -------------------------------------------------------------------------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 确定性 26 位 Crockford Base32（kernel validateHead 要求 prefixed-ULID）。 */
function ulid(seed: number): string {
  let out = ''
  let value = seed
  for (let i = 0; i < 26; i += 1) {
    out = CROCKFORD[value % 32]! + out
    value = Math.floor(value / 32)
  }
  return out
}

const BOOK_ID = `book_${ulid(1)}`
let factSeq = 5000

/** 最小事实行（与 recall.test.ts 夹具同构的精简版；渲染行 = `subject predicate=value`）。 */
function mkFactRow(subject: EntityRef, value: string) {
  return {
    id: `fact_${ulid(factSeq++)}` as FactId,
    bookId: BOOK_ID,
    revision: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    subject,
    predicate: '状态',
    value,
    validFrom: 1,
    validUntil: null,
    importance: 'notable' as const,
    riskClass: 'low' as const,
    source: { kind: 'chapter' as const, chapterIndex: 1 },
    status: 'confirmed' as const,
    compactedIntoVolumeId: null,
    provenance: { origin: 'author' as const, protectedUserContent: false },
  }
}

describe('三通道召回真模型端到端（#24 AC②）', () => {
  it('keyword+k-hop 双漏而向量命中：语义相关事实经兜底入候选，无关者被阈值门拦下', async () => {
    const provider = await createLocalEmbeddingProvider()
    const target = mkFactRow('char:lin-xuan', '把怀表当掉换三十两银子给妹妹抓药')
    const distractor = mkFactRow('char:su-yao', '她在书房里练字临帖')
    const snapshot = foldNarrativeRows({
      temporalFact: [target, distractor],
      knowledgeState: [],
      relationshipState: [],
      timelineEvent: [],
    })
    const draftText = '主角家里穷得叮当响，为了给家人治病四处筹钱。' // 不含任何主名 ⇒ keyword/graph 双漏

    // 阈值标定式注入：以实测相似度间隔取中点作入选门（生产值待自有语料标定，AC③）
    const query = await provider.queryEmbed(draftText)
    const passages = await provider.passageEmbed([
      `${target.subject} ${target.predicate}=${String(target.value)}`,
      `${distractor.subject} ${distractor.predicate}=${String(distractor.value)}`,
    ])
    const simOf = (index: number): number => {
      const vector = passages[index]
      if (vector === undefined) {
        throw new Error(`provider 少发向量：index=${index}`)
      }
      return cosine(query, vector)
    }
    const relevantSim = simOf(0)
    const distractorSim = simOf(1)
    expect(relevantSim).toBeGreaterThan(distractorSim)
    const thresh = (relevantSim + distractorSim) / 2

    const result = await recallCandidates({
      draftText,
      cards: [],
      snapshot,
      scope: { chapterIndex: 5, pov: 'protagonist' },
      config: { ...DEFAULT_KHOP_RECALL_CONFIG, embedding: { thresh } },
      embedding: provider,
    })

    expect(result.candidates).toHaveLength(1)
    const entry = result.candidates[0]!
    expect(entry).toMatchObject({ id: target.id, channel: 'embedding', tier: 'active_fact' })
    // 通道内积与测试 cosine 助手求和序不同 ⇒ 1e-9 级浮点发散，按 1e-6 断言
    expect(entry.relevanceScore).toBeCloseTo(relevantSim, 6)
    expect(entry.activation?.kind).toBe('embedding')
    if (entry.activation?.kind === 'embedding') {
      expect(entry.activation.score).toBeCloseTo(relevantSim, 6)
    }
  })
})
