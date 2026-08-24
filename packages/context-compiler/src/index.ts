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

/** 关键词 + k-hop + embedding 三通道召回（T8a #21 / T8b-2 #24）：别名/正则快通道 + POV 可见子图扩边 + cosine 兜底 + raw 分 max 合并。 */
export {
  DEFAULT_KHOP_RECALL_CONFIG,
  detectKeywordTriggers,
  embeddingRecall,
  khopGraphRecall,
  mergeRecallChannels,
  recallCandidates,
} from './recall.js'
export type {
  ChannelInput,
  EmbeddingRecallConfig,
  EmbeddingRecallEntry,
  EmbeddingRecallInput,
  EmbeddingRecallResult,
  GraphRecallEntry,
  GraphRecallResult,
  GraphRecallScope,
  KeywordChannelResult,
  KeywordScoringConfig,
  KeywordTrigger,
  KhopRecallConfig,
  KhopRecallWeightsConfig,
  RecallPipelineInput,
  RecalledCandidate,
  RecallEntityCard,
  RecallExclusion,
  RecallResult,
  RecallTier,
} from './recall.js'

/** 两阶段 Reserved 预算装配（T7，#23）：三层预扣 → 序贯预订前缀语义 → 放置收敛 → Receipt 发射（ADR-0020）。 */
export {
  assembleBudgetedContext,
  DEFAULT_BUDGET_ASSEMBLY_CONFIG,
  CompileConfigError,
  ConvergenceError,
  TokenizerUnavailable,
} from './assemble.js'
export type {
  AssemblyModelProfile,
  AssemblyResult,
  AssemblyTierName,
  AssembleInput,
  AssembleTask,
  BudgetAssemblyConfig,
  ContextPacket,
  ExactTokenizer,
  PacketSettingEntry,
  PacketStructuralPiece,
  ReceiptIdentity,
  StructuralSection,
} from './assemble.js'
