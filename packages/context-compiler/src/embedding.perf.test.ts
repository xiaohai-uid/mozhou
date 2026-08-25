import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUNDLED_MODEL_ID, createLocalEmbeddingProvider } from './embedding.js'
import type { LocalEmbeddingProvider } from './embedding.js'

/** 固定迭代数的纯整数热循环：返回墙钟 ms。仅用于对比运行间单核吞吐退化倍率。 */
function busyLoopMs(iterations: number): number {
  const t0 = performance.now()
  let acc = 0
  for (let i = 0; i < iterations; i += 1) acc += Math.sqrt(i % 997)
  if (acc === -1) throw new Error('impossible')
  return performance.now() - t0
}

describe('#45 实验：perf 冒烟独立 project 诊断', () => {
  let restoreFetch: () => void = () => {}
  let provider: LocalEmbeddingProvider

  beforeAll(async () => {
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

  it('诊断采样：探针退化率 × 9 次查询延迟分布', async () => {
    await provider.queryEmbed('预热查询，排除 ONNX session 冷启动')
    busyLoopMs(2_000_000) // JIT 预热
    const probe1 = busyLoopMs(10_000_000)
    const samples: number[] = []
    for (let i = 0; i < 9; i += 1) {
      const t0 = performance.now()
      await provider.queryEmbed(`采样 ${i}：主角为了给家人治病筹钱做了什么？`)
      samples.push(performance.now() - t0)
    }
    const probe2 = busyLoopMs(10_000_000)
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(samples.length / 2)]!
    console.log(
      '[PERF45]',
      'probe1=' + probe1.toFixed(1),
      'probe2=' + probe2.toFixed(1),
      'samples=[' + samples.map((s) => s.toFixed(1)).join(',') + ']',
      'median=' + median.toFixed(1),
    )
    expect(median).toBeGreaterThan(0)
  })
})
