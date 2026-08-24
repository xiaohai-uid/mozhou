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

/** 关键词 + k-hop 双通道召回（T8a，#21）：别名/正则快通道 + POV 可见子图扩边 + raw 分 max 合并。 */
export {
  DEFAULT_KHOP_RECALL_CONFIG,
  detectKeywordTriggers,
  khopGraphRecall,
  mergeRecallChannels,
  recallKeywordAndGraph,
} from './recall.js'
export type {
  ChannelInput,
  DualChannelRecallInput,
  GraphRecallEntry,
  GraphRecallResult,
  GraphRecallScope,
  KeywordChannelResult,
  KeywordScoringConfig,
  KeywordTrigger,
  KhopRecallConfig,
  KhopRecallWeightsConfig,
  RecalledCandidate,
  RecallEntityCard,
  RecallExclusion,
  RecallResult,
  RecallTier,
} from './recall.js'
