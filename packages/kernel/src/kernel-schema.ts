/**
 * ============================================================================
 * MoZhou Story Kernel — 冻结领域 Schema 草案 v1（工单 #4 产出）
 * ============================================================================
 *
 * 来源约束（全部为规范性输入）：
 *   - docs/specs/story-kernel-and-domain-spec.md §2 九柱字段清单
 *   - ADR-0002 / 0004 / 0010 / 0011 及修订案 ADR-0019
 *   - Gate A 行为冻结条目 M1-M20 / N1-N12（卷二终章）
 *   - wayfinder 工单 #4 两轮 grilling 决策（Q1-Q14，见 kernel-schema-decisions.md）
 *
 * 编译假设：`strict: true` + `exactOptionalPropertyTypes: true`。
 * 零 import、零运行时依赖；可变体（readonly 数组）与 ISO 字符串时间戳
 * 保证 JSONL 双平面序列化无损（无 Date/Map/Set）。
 *
 * 全局不变量（违反即实现 bug）：
 *   I1  保护位语义：`protectedUserContent = true` 的内容任何自动化通道
 *       （压缩/重算/风格迁移）不得清除或改写；上游变更只能置下游 stale。ADR-0019 §4
 *   I2  stale 只是建议性重验信号，永不触发自动删除/重生成。ADR-0010
 *   I3  KnowledgeState 行无自有生命周期：引用事实进入 `rejected` 即级联失效，
 *       投影重建时自然消失（Q11）。错误信念走 `distortion`，不另立状态。
 *   I4  ContextReceipt 只能由服务端确定性装配产生（N10）；`assembledBy` 恒为 'server'。
 *   I5  章节提交（ChapterCommit）与时间线事件（TimelineEvent）不可变：
 *       `revision` 创建后恒定不增，变更只能以新记录表达（M3 事务纪律）。
 *   I6  被压缩微事实行保留（Q9）：`compactedIntoVolumeId` 非空即表示已折入卷摘要，
 *       行本身永不物理删除 —— Event Ledger 回放可复算的前提。
 */

/* ----------------------------------------------------------------------------
 * 0. 品牌化 ID（Q4：前缀 + ULID 本体；品牌类型防串用；Markdown/JSONL 内可 grep）
 * -------------------------------------------------------------------------- */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** ULID（26 位 Crockford Base32，字典序 = 时间序）。 */
export type Ulid = Brand<string, 'Ulid'>;

export type BookId = Brand<`book_${string}`, 'BookId'>;

/** 大纲四层各自的 ID 品牌（Q3：层级到 Chapter 为止）。 */
export type BookNodeId = Brand<`book_${string}`, 'BookNodeId'>;
export type VolumeNodeId = Brand<`volume_${string}`, 'VolumeNodeId'>;
export type ArcNodeId = Brand<`arc_${string}`, 'ArcNodeId'>;
export type ChapterNodeId = Brand<`chapter_${string}`, 'ChapterNodeId'>;
export type OutlineNodeId = BookNodeId | VolumeNodeId | ArcNodeId | ChapterNodeId;

export type SceneId = Brand<`scene_${string}`, 'SceneId'>;
export type FactId = Brand<`fact_${string}`, 'FactId'>;
export type KnowledgeStateId = Brand<`knst_${string}`, 'KnowledgeStateId'>;
export type NarrativePromiseId = Brand<`prom_${string}`, 'NarrativePromiseId'>;
export type RelationshipStateId = Brand<`rels_${string}`, 'RelationshipStateId'>;
export type TimelineEventId = Brand<`tle_${string}`, 'TimelineEventId'>;
export type StyleProfileId = Brand<`style_${string}`, 'StyleProfileId'>;
export type AuthorIntentId = Brand<`aint_${string}`, 'AuthorIntentId'>;
export type ChapterCommitId = Brand<`cmit_${string}`, 'ChapterCommitId'>;
export type ContextReceiptId = Brand<`rcpt_${string}`, 'ContextReceiptId'>;

/** 实体引用：`命名空间:名称` 形式的字符串主键（角色/物品/地点等 Codex 类实体
 *  不在本 Schema 的九柱内，以稳定字符串引用；本地文件内人读可 grep）。
 *  示例：`char:lin-xuan`、`item:qingyun-jian`、`location:tianyan-city`。 */
export type EntityRef =
  | `char:${string}`
  | `item:${string}`
  | `location:${string}`
  | `faction:${string}`
  | `concept:${string}`;

/** 秘密谓词命名空间（Q7：秘密即事实）。揭露时刻 = 该事实 valid 区间终点。 */
export type SecretPredicate = `secret.${string}`;

/* ----------------------------------------------------------------------------
 * 1. 共享结构件（Q5 双轨制 / Q14 revision）
 * -------------------------------------------------------------------------- */

/** 内容来源与保护位（I1）。三值来源统一用于正文工件与正典事实。 */
export interface AuthorProvenance {
  /** author=人直接创作/断言；ai=从 AI 产物提取；external=外部编辑对账写入 */
  readonly origin: 'author' | 'ai' | 'external';
  /** true ⇒ 自动化通道禁写（I1） */
  readonly protectedUserContent: boolean;
}

/** 下游传播的过期标记（I2）。挂在下游工件上，reason 是定向重算的输入。 */
export interface StaleMarker {
  readonly reason:
    | 'upstream_canon_changed'
    | 'upstream_outline_changed'
    | 'dependency_manifest_mismatch';
  /** 触发传播的上游精确版本（与 DependencyManifestEntry 同构） */
  readonly upstreamRefs: readonly DependencyManifestEntry[];
  /** 标记时刻（ISO-8601 UTC） */
  readonly markedAt: string;
}

/** 所有内核实体的公共头。revision 语义见 Q14：事务性原地变更 +1；
 *  不可变实体（ChapterCommit/TimelineEvent/ContextReceipt/BookRecord）恒为 0（I5）。 */
export interface KernelEntityHead {
  readonly id: string; // 各自的品牌化 ID 类型在具体接口中收窄
  readonly bookId: BookId;
  readonly revision: number;
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

/** DependencyManifest 条目 = "编译时读到的精确版本"（Q14 / ADR-0003 / M4）。 */
export interface DependencyManifestEntry {
  readonly kind: EntityKind;
  readonly id: string;
  readonly revision: number;
}

/** 内核实体种类全集（九柱 + Scene + 支撑结构）。 */
export type EntityKind =
  | 'book'
  | 'authorIntent'
  | 'outlineNode'
  | 'scene'
  | 'temporalFact'
  | 'knowledgeState'
  | 'narrativePromise'
  | 'relationshipState'
  | 'timelineEvent'
  | 'styleProfile'
  | 'chapterCommit';

/* ----------------------------------------------------------------------------
 * 2. 书容器与宪法层（非九柱的支撑结构 + AuthorIntent）
 * -------------------------------------------------------------------------- */

export interface BookRecord {
  readonly id: BookId;
  readonly title: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 宪法层。不变量：provenance 恒为 { origin:'author', protectedUserContent:true }
 *  —— 作者意图整体受保护，任何自动化通道不得改写（规格 §2.1 / I1）。 */
export interface AuthorIntent extends KernelEntityHead {
  readonly id: AuthorIntentId;
  readonly premise: string;
  readonly coreSatisfactionPoints: readonly string[];
  readonly protagonistDesire: string;
  readonly absoluteTaboos: readonly string[];
  readonly targetEnding: string;
  readonly tonePreference: string;
  readonly provenance: AuthorProvenance;
}

/* ----------------------------------------------------------------------------
 * 3. OutlineGraph（规划层；Q3 后层级 = Book → Volume → Arc → Chapter）
 * -------------------------------------------------------------------------- */

export type OutlineNodeStatus = 'drafted' | 'active' | 'completed' | 'stale';

export interface OutlineNode extends KernelEntityHead {
  readonly id: OutlineNodeId;
  readonly nodeType: 'book' | 'volume' | 'arc' | 'chapter';
  readonly parentId: OutlineNodeId | null; // book 层为 null
  readonly orderIndex: number; // 同父下的序
  readonly title: string;
  readonly goal?: string | undefined;
  readonly conflict?: string | undefined;
  readonly climax?: string | undefined;
  readonly outcome?: string | undefined;
  /** 结构依赖边：本书内其他大纲节点（影响分析 = 写入时建边，M1） */
  readonly dependencyNodeIds: readonly OutlineNodeId[];
  readonly status: OutlineNodeStatus;
  /** 大纲文本默认作者所有；AI 代拟的大纲节点 origin='ai' 且保护位 false（I1） */
  readonly provenance: AuthorProvenance;
  /** 上游变更传播的过期位（spec §2.2 status 含 'stale'，与 I2 同轨） */
  readonly stale: StaleMarker | null;
}

/* ----------------------------------------------------------------------------
 * 4. Scene（一等实体；Q3/Q8：编译原子单元，正文不入 Scene —— 正文归 ChapterCommit）
 * -------------------------------------------------------------------------- */

export type PovEntity = 'protagonist' | `char:${string}`;

export interface SceneBeat {
  readonly description: string;
  /** 该拍的表达意图备注（供编译器与作者复查；不参与确定性门禁） */
  readonly intentionNote?: string | undefined;
}

export type SceneStatus = 'planned' | 'drafted' | 'written';

export interface Scene extends KernelEntityHead {
  readonly id: SceneId;
  readonly chapterOutlineNodeId: ChapterNodeId;
  readonly orderIndex: number; // 章内序
  /** POV 声明：ADR-0011 场景级知识切片的锚点 */
  readonly povEntity: PovEntity;
  readonly summary: string;
  readonly beats: readonly SceneBeat[];
  readonly status: SceneStatus;
  /** true ⇒ 整场景为人写（Q8 工件级保护粒度），自动化通道禁改写（I1） */
  readonly provenance: AuthorProvenance;
  readonly stale: StaleMarker | null;
}

/* ----------------------------------------------------------------------------
 * 5. TemporalFact（时序事实；秘密即事实 Q7；压缩留位 Q9）
 * -------------------------------------------------------------------------- */

export type FactImportance = 'trivial' | 'notable' | 'critical';
export type FactStatus = 'planned' | 'candidate' | 'confirmed' | 'rejected';
export type FactRiskClass = 'low' | 'medium' | 'high';

/** 原子标量值。数值断言保持 number，使 M2 硬门禁可做确定性数值比较而无需解析。 */
export type FactValue = string | number | boolean;

export type FactSource =
  | { readonly kind: 'chapter'; readonly chapterIndex: number }
  | { readonly kind: 'outlineNode'; readonly outlineNodeId: OutlineNodeId };

export interface TemporalFact extends KernelEntityHead {
  readonly id: FactId;
  /** 断言主体（Codex 类实体引用，如 char:lin-xuan） */
  readonly subject: EntityRef;
  /** 属性名；秘密使用 SecretPredicate 命名空间（secret.*）（Q7） */
  readonly predicate: string;
  readonly value: FactValue;
  /** 生效章索引（含端点）；查询第 N 章 ⇔ validFrom ≤ N ≤ (validUntil ?? ∞) */
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly importance: FactImportance;
  /** 风险分级（本票新增，规格十步管线 §Risk-Graded 的数据落点）：
   *  high = 死亡/大境界突破/世界规则/秘密揭露/承诺兑现 ⇒ 阻塞式确认 */
  readonly riskClass: FactRiskClass;
  readonly source: FactSource;
  readonly status: FactStatus;
  /** 已折入的卷摘要所属大纲卷节点；null = 仍在活跃层（Q9，行保留纪律 I6） */
  readonly compactedIntoVolumeId: VolumeNodeId | null;
  /** 作者直接断言的正典事实 origin='author' + 保护位 true ⇒ 免疫自动改写（Q8/I1） */
  readonly provenance: AuthorProvenance;
}

/* ----------------------------------------------------------------------------
 * 6. KnowledgeState（一等存储实体；Q10 章+可选场景锚点；Q11 无自有状态机）
 * -------------------------------------------------------------------------- */

/** 知情者：读者 / 主角 / 具名角色。 */
export type KnowledgeHolder = 'reader' | 'protagonist' | `char:${string}`;

export interface KnowledgeState extends KernelEntityHead {
  readonly id: KnowledgeStateId;
  readonly factId: FactId;
  readonly holder: KnowledgeHolder;
  /** 得知章索引（必填锚点） */
  readonly knownSinceChapter: number;
  /** 场景级精化（可选；多视角章节钉到具体场景，喂给 ADR-0011 POV 切片） */
  readonly knownSinceSceneId?: SceneId | undefined;
  /** 畸变信念：持有者"以为"的假版本；缺省 = 如实知情（I3：错误信念不走状态机） */
  readonly distortion?: string | undefined;
}

/* ----------------------------------------------------------------------------
 * 7. NarrativePromise / RelationshipState / TimelineEvent / StyleProfile
 * -------------------------------------------------------------------------- */

export type PromiseType =
  | 'foreshadowing'
  | 'suspense'
  | 'reader_expectation'
  | 'character_vow'
  | 'countdown'
  | 'quest'
  | 'debt'
  | 'secret';

export type PromiseStatus =
  | 'introduced'
  | 'reinforced'
  | 'due'
  | 'paid_off'
  | 'abandoned'
  | 'overdue';

export interface NarrativePromise extends KernelEntityHead {
  readonly id: NarrativePromiseId;
  readonly type: PromiseType;
  readonly description: string;
  readonly introducedChapter: number;
  /** 预期兑现章；null = 无限期承诺（如世界观级悬念） */
  readonly targetChapter: number | null;
  readonly status: PromiseStatus;
  /** 兑现证据（章节号 + 摘引），paid_off 时必填（运行时校验） */
  readonly payoffNotes: string | null;
}

export interface RelationshipState extends KernelEntityHead {
  readonly id: RelationshipStateId;
  readonly entityA: EntityRef;
  readonly entityB: EntityRef;
  readonly relationshipType: string; // 开放词表（陌生人→盟友→…），不做封闭枚举
  /** [-100, +100]，越界为运行时校验错误 */
  readonly affinityScore: number;
  readonly validFrom: number;
  readonly validUntil: number | null;
  readonly sourceChapterIndex: number;
}

/** 世界时间：历法不可解析（修仙纪年等），故双字段（Q12）——
 *  label 给人读，order 承载 M2 时间线单调性硬门禁的确定性比较。 */
export interface TimelineEvent extends KernelEntityHead {
  readonly id: TimelineEventId;
  readonly worldTimeLabel: string;
  /** 全书严格单调递增；创建后随记录冻结（I5） */
  readonly worldTimeOrder: number;
  readonly chapterIndex: number;
  readonly locationRef?: EntityRef | undefined;
  readonly participants: readonly EntityRef[];
  readonly summary: string;
  /** 该事件确立/触发的时序事实 */
  readonly impactFactIds: readonly FactId[];
}

export type ScenarioType =
  | 'action'
  | 'dialogue'
  | 'romance_emotion'
  | 'exposition_worldbuilding';

export interface SentenceLengthBucket {
  /** 该桶句长上限（字符；中文网文按字计） */
  readonly maxLengthChars: number;
  /** 该桶占比 [0,1]，全表合计 ≈ 1 */
  readonly share: number;
}

/** 场景分类文风档案（Q13 补判别键；EMA 平滑簿记归 flywheel 层，此处存平滑结果）。
 *  规格 §2.8 的 version 字段由 KernelEntityHead.revision 承担（改名见决策记录）。 */
export interface StyleProfile extends KernelEntityHead {
  readonly id: StyleProfileId;
  readonly scenarioType: ScenarioType;
  readonly dialogueRatio: number; // [0,1]
  readonly sentenceLengthDistribution: readonly SentenceLengthBucket[];
  readonly tabooWords: readonly string[];
  readonly sensoryDensity: number; // 归一化 [0,1]
  readonly actionPacing: number; // 归一化 [0,1]
}

/* ----------------------------------------------------------------------------
 * 8. ContextReceipt（Phase 2 一等产物的预留冻结；Q6 冻结条目 schema 与枚举，
 *    Q15/Q16 为工单 #9 收敛定案的受控增补：activation / replayInputs）
 * -------------------------------------------------------------------------- */

export type CompileTaskType = 'chapter_writing' | 'scene_beat' | 'review' | 'fact_extraction';

/** 装配来源（工单要求预留字段①）：该条目经哪条召回通道进入候选。 */
export type AssemblyChannel =
  | 'structural' // 宪法层/任务框架/风格等结构性注入
  | 'keyword' // 关键词快通道（NAI activation 对应物）
  | 'graph_khop' // Temporal Canon Graph 显式 k-hop 召回（触发源必入候选集）
  | 'embedding' // 本地向量兜底长尾（M5 双轨第二路）
  | 'manual_pin'; // 作者手动钉选

/** 淘汰原因（工单要求预留字段②；NAI Inclusion/Reason 产品化的对应枚举）。 */
export type ExclusionReason =
  | 'budget_exhausted'
  | 'relevance_below_threshold'
  | 'pov_filtered' // ADR-0011 场景级 POV 切片滤除
  | 'interval_not_active' // valid 区间不含当前章
  | 'story_text_quota_protected' // 正文保底配额挤压设定条目（ADR-0019 §2）
  | 'duplicate';

/** 激活证据（Q15）：按召回通道判别的「为何成为候选」凭据，NAI Context Viewer Key 列的类型化对应物。
 *  structural 注入不经过召回，无此证据；双通道合并打分时记胜出（主）通道的证据。 */
export type ActivationEvidence =
  | { readonly kind: 'keyword'; readonly keys: readonly string[] } // 命中的激活键
  | {
      readonly kind: 'graph_khop';
      readonly sourceEntity: string; // 触发遍历的源实体（ULID 或 EntityRef）
      readonly hops: number;
      readonly score: number;
    }
  | { readonly kind: 'embedding'; readonly score: number } // 查询指纹在 ReplayInputs.embeddingQueryDigest 编译级单值
  | { readonly kind: 'manual_pin' }; // 作者钉选动作本身即凭据

export interface ReceiptEntry {
  readonly stage: string; // 装配阶段标识（编译器自定义，回放时逐阶段重算）
  readonly order: number; // 插入顺序
  readonly identifier: string; // 条目标识（实体 id / 分区名）
  readonly included: boolean;
  readonly assemblySource?: AssemblyChannel | undefined;
  /** 激活证据（Q15）：为何成为候选；structural 条目恒 undefined */
  readonly activation?: ActivationEvidence | undefined;
  /** 运行时不变量：included=false 时必填 */
  readonly exclusionReason?: ExclusionReason | undefined;
  readonly reservedTokens?: number | undefined; // 两阶段装配的预订额（NAI 先例）
  readonly tokens?: number | undefined; // 实际占用
  readonly trimType?: 'none' | 'atomic' | 'truncated' | undefined;
}

/** 解析失败记录（工单要求预留字段③；NovelForge budget_stats 桩的反面教材）。 */
export interface ParseFailure {
  readonly source: string; // 失败的输入源（DSL 表达式/文件路径/引用串）
  readonly detail: string; // 失败原因
}

/** 重放候选（Q16）：竞争池条目的重放描述——只存标量与摘要，内容本体不内嵌（真源唯一）。
 *  T9 受控增补（#25）：归档 `activation`——recomputationHash 覆盖 entries（含激活证据），
 *  重放要逐字节复现哈希就必须能为每个候选重建 activation；落选者（converge 淘汰）的
 *  激活证据在 receipt entries 中无第二载体，只能随重放面归档。 */
export interface ReplayCandidate {
  readonly id: string; // ULID 或 EntityRef
  readonly tier: string; // ADR-0004 修剪层级词表
  readonly channel: AssemblyChannel;
  readonly relevanceScore: number;
  readonly pinned?: boolean | undefined;
  readonly atomicOverride?: boolean | undefined;
  /** 激活证据（T9 #25 增补）：与 RecalledCandidate.activation 同构，逐字节重放的必要输入。 */
  readonly activation?: ActivationEvidence | undefined;
  readonly contentDigest: string; // SHA-256；codex 自由 md 无 revision，摘要兜底变异检测
}

/** 重放输入面（Q16）：复算预算装配阶段（structural/reserve/converge/story_text）所需的
 *  最小输入集。候选恒按 desirability 终序存储——前缀完备性（INV-2）在文件中直接可见，
 *  重放即顺序走查。recall_filter 阶段的透传条目不在此列（召回不承诺逐字节重放）。 */
export interface ReplayInputs {
  readonly configVersion: string;
  readonly tokenizerVersion: string;
  readonly modelProfileId: string;
  readonly contextWindowTokens: number;
  /** 双通道合并打分的查询指纹（编译级单值，不逐条存）；无 embedding 通道时缺省 */
  readonly embeddingQueryDigest?: string | undefined;
  readonly candidates: readonly ReplayCandidate[];
  readonly structuralSections: readonly {
    readonly section: string;
    readonly contentDigest: string;
  }[];
  readonly storyTextSlices: readonly { readonly digest: string; readonly tokens: number }[];
}

export interface ContextReceipt extends KernelEntityHead {
  readonly id: ContextReceiptId;
  readonly taskType: CompileTaskType;
  readonly chapterIndex?: number | undefined;
  readonly entries: readonly ReceiptEntry[];
  readonly parseFailures: readonly ParseFailure[];
  /** 正文保底配额核算（ADR-0019 §2）：reserved = 配额下限，actual = 实际正文占用 */
  readonly storyTextQuota: {
    readonly reservedTokens: number;
    readonly actualTokens: number;
  };
  readonly totalTokens: number;
  /** 恒为 'server'（N10，I4）——类型层面把客户端装配表达为非法状态 */
  readonly assembledBy: 'server';
  /** 重放输入面（Q16）：复算边界与漂移定位语义见 context-receipt-physical-format-spec §3 */
  readonly replayInputs: ReplayInputs;
  /** 输入固化摘要（INV-R6）：恒 = sha256(canonicalJson(replayInputs))，漂移检测锚点 */
  readonly inputsDigest: string;
  /** 同输入重算装配应得到同哈希；receipt 间 diff 即审计（可复算可 diff） */
  readonly recomputationHash: string;
}

/* ----------------------------------------------------------------------------
 * 9. ChapterCommit（事务性提交；delta 五族全量内嵌 = Ledger 回放的自足事件）
 * -------------------------------------------------------------------------- */

/** delta 家族的统一形状：created/updated 内嵌完整记录（事件溯源自足性），
 *  retiredIds 只留标识。T 必须携带提交后生效的最终字段值。 */
export interface CommitDelta<T, IdT> {
  readonly created: readonly T[];
  readonly updated: readonly T[];
  readonly retiredIds: readonly IdT[];
}

export interface DependencyManifest {
  readonly entries: readonly DependencyManifestEntry[];
}

/** 不可变事务单元（I5 / M3）。finalProse 为整章 Markdown；
 *  正文保护不在 commit 层重复设防 —— 不可变性即最强保护（Q8）。 */
export interface ChapterCommit extends KernelEntityHead {
  readonly id: ChapterCommitId;
  readonly chapterOutlineNodeId: ChapterNodeId;
  readonly chapterIndex: number;
  readonly finalProse: string;
  readonly summary: string;
  readonly factDelta: CommitDelta<TemporalFact, FactId>;
  readonly relationshipDelta: CommitDelta<RelationshipState, RelationshipStateId>;
  readonly knowledgeDelta: CommitDelta<KnowledgeState, KnowledgeStateId>;
  readonly promiseDelta: CommitDelta<NarrativePromise, NarrativePromiseId>;
  readonly timelineDelta: CommitDelta<TimelineEvent, TimelineEventId>;
  readonly dependencyManifest: DependencyManifest;
  /** 本次生成所依据的装配凭证（Receipt↔Commit 双向可追溯，ADR-0019 §2） */
  readonly receiptId: ContextReceiptId;
  /** 内容 SHA-256（外部对账哈希基准，ADR-0010） */
  readonly contentHash: string;
}

/* ----------------------------------------------------------------------------
 * 10. 实体目录层（工单 #13 受控增补；规划·宪法层工件，非九柱实体——#4 决策：
 *     "Codex 实体不在九柱内，以稳定字符串引用"。不进追踪 jsonl、不扩 EntityKind；
 *     落盘为 设定/<类型>/*.md frontmatter，规格见 entity-directory-spec.md）
 * -------------------------------------------------------------------------- */

/** AI Context 装配策略四档（#7 决议③；对齐 Novelcrafter AI Context）。
 *  仅裁决激活与否——secret.* 授权行与 POV 切片门禁中央强制，
 *  任何档位含 always / never / manual_pin 均不得绕过（entity-directory-spec D1）。 */
export type AiContextTier = 'always' | 'detected' | 'detectedOff' | 'never';

/** 别名规则：中文检测以 exact 全串匹配优先、regex 兜底变体；
 *  数组顺序即优先级；caseSensitive 仅影响拉丁字母，默认 false（spec Q3）。 */
export interface AliasRule {
  readonly text: string;
  readonly kind: 'exact' | 'regex';
  readonly caseSensitive?: boolean;
}

/** 实体目录卡 frontmatter（设定/<类型>/*.md；规划·宪法层，保存即落盘）。
 *  正文区人读且永不整体入包；AI 面仅 brief（缺省回退正文按 world_rule 截断）。
 *  ref 一经引用即冻结、全书唯一；文件名只是皮（Q13 身份规则延续）。 */
export interface EntityCardFrontmatter {
  readonly ref: EntityRef;
  /** 规范显示名，可随时改、不回写 ref；建卡时自动入 aliases 首位（作者可删）。 */
  readonly name: string;
  /** 装配策略四档，默认 'detected'。always ⇒ structural.sections 注入，
   *  受 structuralCapTokens 约束，超出 = 配置错误（spec D5）。 */
  readonly aiContext?: AiContextTier;
  /** 检测表；数组顺序即优先级。 */
  readonly aliases?: readonly AliasRule[];
  /** 卡级排除词表：命中但不触发检测。 */
  readonly excludedPhrases?: readonly string[];
  /** 进 prompt 的压缩面；缺省回退 = 正文按 world_rule truncateCap 截断。 */
  readonly brief?: string;
  /** 作者组织用标签，永不入包（spec D4）。 */
  readonly tags?: readonly string[];
}
