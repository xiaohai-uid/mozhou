/** Context Compiler 骨架占位：装配管线随 wayfinder #7（查询 API 形态）/ #8（预算算法）决议落位。 */
export const CONTEXT_COMPILER_VERSION = '0.0.0'

/** 本地 embedding 装载封装（T8b-1，#18）：随仓模型资产 + fastembed CUSTOM 纯本地装载。 */
export {
  BUNDLED_MODEL_ID,
  createLocalEmbeddingProvider,
  ensureCudaSkipEnv,
  ModelAssetsError,
} from './embedding.js'
export type { CreateLocalEmbeddingProviderOptions, LocalEmbeddingProvider } from './embedding.js'
