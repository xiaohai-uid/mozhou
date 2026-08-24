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
  canonicalJson,
  configVersionOf,
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

/** Receipt 一证一文件（T9，#25）：稳定键序美化序列化 + .mozhou/receipts/ 不可变凭证 +
 *  ContextCompiled 指针事件（INV-R1 崩溃一致序 / INV-R2 不可变 / 悬空指针校验，ADR-0021）。 */
export {
  assertNoDanglingReceiptPointers,
  DanglingReceiptPointerError,
  listReceiptIds,
  loadReceipt,
  persistReceipt,
  ReceiptAlreadyExistsError,
  ReceiptNotFoundError,
  RECEIPTS_DIRNAME,
  RUNTIME_EVENTS_RELPATH,
  serializeReceiptFile,
} from './receipt-file.js'
export type { PersistReceiptOptions, PersistedReceiptLocation } from './receipt-file.js'

/** Receipt 重放引擎（T9，#25）：replayInputs 最小重放输入面的运行时兑现——
 *  embedding 索引漂移后仍复现同一 desirability 终序与 recomputationHash，
 *  输入漂移逐条定位 fail loudly（spec §3.1 复算契约）。 */
export { ReplayHashMismatchError, ReplayInputDriftError, replayReceiptFromInputs, ReplayVersionMismatchError } from './receipt-replay.js'
export type { ReplayContentResolver, ReplayRuntime, ReplaySurface } from './receipt-replay.js'

/** 编译器全链路集成（T10a，#26）：目录卡四档激活 → 三通道召回 → 两阶段 Reserved
 *  预算装配 → 服务端 Receipt 一证一文件——compile() 端到端收口在 ContextCompiler。 */
export { activateCards, compile, EmptyRecallError } from './compile.js'
export type { CardActivation, CompileCard, CompileInput, CompileResult } from './compile.js'
