/**
 * 本地 embedding 第三召回通道的进程内惰性装载（实现票 #18 的接线单元）。
 *
 * 为什么惰性：模型资产 24MB（ONNX int8，512 维），装载含逐文件 sha256 复核，是秒级
 * 成本；服务启动不该为一条兜底召回通道付这个代价（同文件族先例：draftContext.ts
 * 的精确 tokenizer 惰性装载）。
 *
 * 为什么装载失败降级而不是抛错（本票唯一需要拍板的点）：
 *   - embedding 是「兜底第三通道」（recall.ts:850「三通道互不阻塞」）。它缺席时，
 *     keyword + graph 两通道照样产出**合法** Receipt，没有任何一条已产出条目的
 *     正确性被改变——只是召回面变窄。
 *   - 若因一个二进制资产不可装载就阻断整章生成，等于把「召回面变窄」升级成
 *     「产品不可用」，代价与收益严重倒挂。
 *   - 对照同文件的 tokenizer：它缺席会让预算核算退化成被规格明令禁止的估算器
 *     （token-budget-assembly-spec §3），所以那条路径必须响亮失败
 *     （draftContext.ts:24-28）。判据是「缺席是否破坏正确性」，不是「是否重要」。
 *   - 降级**不是**静默：console.error 带可执行指引（安装文档）；且降级路径仍只会
 *     产出「双通道合法 Receipt」或显式 EmptyRecallError → 可审计结构回落，
 *     绝不伪造凭证或回落到 mock（UVSD §14/§15）。
 *
 * 失败缓存：资产缺失/哈希不符是确定性环境错误，每次生成都重读 24MB 复核是纯浪费；
 * 进程重启（部署修复后）才是重试边界。成功与失败结果都缓存，并发首调共享同一次装载。
 */
import { createLocalEmbeddingProvider } from '@mozhou/context-compiler'
import type { LocalEmbeddingProvider } from '@mozhou/context-compiler'

/** 装载工厂（测试可替换；生产恒为随仓资产的真实装载）。 */
export type LocalEmbeddingLoader = () => Promise<LocalEmbeddingProvider>

const defaultLoader: LocalEmbeddingLoader = () => createLocalEmbeddingProvider()

let loader: LocalEmbeddingLoader = defaultLoader
let cached: Promise<LocalEmbeddingProvider | null> | null = null

async function attemptLoad(): Promise<LocalEmbeddingProvider | null> {
  try {
    return await loader()
  } catch (error) {
    console.error(
      '[mozhou-embedding] 本地 embedding 第三召回通道装载失败，本次及后续生成退回 keyword+graph 双通道：' +
        `${(error as Error).message}（模型资产安装见 docs/install.md）`,
    )
    return null
  }
}

/**
 * 惰性单例：并发首调共享同一次装载（不重复读盘/复核）。
 * 装载失败返回 null —— 调用方据此退回双通道召回，不阻断生成。
 */
export async function localEmbeddingProvider(): Promise<LocalEmbeddingProvider | null> {
  cached ??= attemptLoad()
  return cached
}

/** 测试专用：替换装载工厂并清空缓存（null 恢复缺省工厂）。 */
export function setLocalEmbeddingLoaderForTest(next: LocalEmbeddingLoader | null): void {
  loader = next ?? defaultLoader
  cached = null
}
