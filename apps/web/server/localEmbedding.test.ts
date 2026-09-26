// @vitest-environment node
/**
 * 本地 embedding 第三召回通道惰性装载单元（T8b 接线的装载单元）。
 *
 * 被测不变量：
 *   - 惰性：模块导入不装载 24MB 资产，首次调用才装载；
 *   - 单例：并发首调共享同一次装载（不重复读盘/复核）；
 *   - 降级：装载失败返回 null 且不抛，调用方可退回双通道（失败路径）；
 *   - 可观测：降级必须留下带可执行指引的错误日志，不是静默吞掉；
 *   - 失败缓存：确定性环境错误不每次生成重读 24MB（重试边界是进程重启）；
 *   - 同步抛错安全：装载工厂同步抛出也不炸调用方（测试注入/非常规工厂）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED_MODEL_ID } from '@mozhou/context-compiler'
import type { LocalEmbeddingProvider } from '@mozhou/context-compiler'
import { localEmbeddingProvider, setLocalEmbeddingLoaderForTest } from './localEmbedding.js'

function stubProvider(): LocalEmbeddingProvider {
  return {
    modelId: BUNDLED_MODEL_ID,
    dimensions: 512,
    queryEmbed: () => Promise.resolve(new Array<number>(512).fill(0)),
    passageEmbed: () => Promise.resolve([]),
  }
}

afterEach(() => {
  // 恢复缺省工厂并清空缓存：避免测试间互相污染单例状态。
  setLocalEmbeddingLoaderForTest(null)
  vi.restoreAllMocks()
})

describe('localEmbeddingProvider · 惰性单例', () => {
  it('导入不装载，首次调用才调用装载工厂', async () => {
    let calls = 0
    setLocalEmbeddingLoaderForTest(() => {
      calls += 1
      return Promise.resolve(stubProvider())
    })

    expect(calls).toBe(0) // 惰性：装载工厂在首次调用前从未被执行
    const provider = await localEmbeddingProvider()
    expect(calls).toBe(1)
    expect(provider?.modelId).toBe(BUNDLED_MODEL_ID)
  })

  it('并发首调共享同一次装载，且后续调用命中缓存', async () => {
    let calls = 0
    const provider = stubProvider()
    setLocalEmbeddingLoaderForTest(() => {
      calls += 1
      return Promise.resolve(provider)
    })

    const [a, b] = await Promise.all([localEmbeddingProvider(), localEmbeddingProvider()])
    const c = await localEmbeddingProvider()

    expect(calls).toBe(1)
    expect(a).toBe(provider) // 同一实例（不是每次新建引擎）
    expect(b).toBe(provider)
    expect(c).toBe(provider)
  })
})

describe('localEmbeddingProvider · 装载失败降级（失败路径）', () => {
  it('异步失败返回 null 且不抛，并留下带安装指引的错误日志', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setLocalEmbeddingLoaderForTest(() => Promise.reject(new Error('模型资产校验失败（hash 不符）')))

    const provider = await localEmbeddingProvider()

    expect(provider).toBeNull() // 调用方据此退回双通道，不阻断生成
    expect(spy).toHaveBeenCalledTimes(1)
    const message = String(spy.mock.calls[0]?.[0] ?? '')
    expect(message).toContain('[mozhou-embedding]')
    expect(message).toContain('hash 不符')
    expect(message).toContain('docs/install.md')
  })

  it('同步抛错同样被收成 null（工厂不是 async 也不炸调用方）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setLocalEmbeddingLoaderForTest(() => {
      throw new Error('同步装载失败')
    })

    await expect(localEmbeddingProvider()).resolves.toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('失败结果被缓存：不变量——确定性环境错误不每次生成重读 24MB', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    setLocalEmbeddingLoaderForTest(() => {
      calls += 1
      return Promise.reject(new Error('资产缺失'))
    })

    expect(await localEmbeddingProvider()).toBeNull()
    expect(await localEmbeddingProvider()).toBeNull()
    expect(await localEmbeddingProvider()).toBeNull()

    expect(calls).toBe(1) // 只装载尝试一次（重试边界 = 进程重启）
    expect(spy).toHaveBeenCalledTimes(1) // 也不重复刷日志
  })
})

describe('localEmbeddingProvider · 测试接缝语义', () => {
  it('替换工厂即清空缓存：失败后换成可用工厂可重新装载', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setLocalEmbeddingLoaderForTest(() => Promise.reject(new Error('先失败')))
    expect(await localEmbeddingProvider()).toBeNull()

    const provider = stubProvider()
    setLocalEmbeddingLoaderForTest(() => Promise.resolve(provider))
    expect(await localEmbeddingProvider()).toBe(provider)
  })
})
