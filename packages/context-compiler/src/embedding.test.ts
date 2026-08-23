import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BUNDLED_MODEL_ID,
  createLocalEmbeddingProvider,
  ensureCudaSkipEnv,
  ModelAssetsError,
} from './embedding.js'
import type { LocalEmbeddingProvider } from './embedding.js'

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
