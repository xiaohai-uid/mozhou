/**
 * Capability Recipe Schema v1 类型层（T15 · #39）。
 * 规格真源：docs/specs/capability-recipe-schema-v1.md（工单 #33 冻结，九问 R1-R9 全采 A）。
 * 纪律：词表常量由本文件统一持有，各模块不得散写（沿 runtime/types.ts Q5 先例）；
 * JSON Schema 校验面见 ./schema.ts，装载管线见 ./loader.ts。
 * 命名边界（规格 §3）：recipe=方法论配方（本 Schema 管辖）；SkillDefinition/SkillRun=
 * 应用线运行时注册与执行证据实体，其 FROZEN 契约不因本 Schema 变更。
 */

/** 本 Schema 自身版本（双轨上游）：不认识即拒，零兼容承诺（R7/R8=A）。 */
export const RECIPE_SCHEMA_VERSION = 1;

/** 触发表静态四型枚举（F7+R3=A）：声明式、runtime 解释执行，不做 DSL。 */
export const LOAD_CONDITION_TYPES = ['phase', 'input', 'fallback', 'always'] as const;
export type LoadConditionType = (typeof LOAD_CONDITION_TYPES)[number];

/** failure 矩阵四策略（R4=A 条目化）：repairAction 仅 repair/failFast 必带。 */
export const FAILURE_POLICIES = ['repair', 'skip', 'failFast', 'rebuildFromRevision'] as const;
export type FailurePolicyKind = (typeof FAILURE_POLICIES)[number];
/** 需要 repairAction 的策略子集（schema if/then 与类型层共用同一事实源）。 */
export const FAILURE_POLICIES_REQUIRING_REPAIR_ACTION: readonly FailurePolicyKind[] = [
  'repair',
  'failFast',
];

/** 预检严重度（F11）：blocking=挡写，advisory=只报告不改写。 */
export const PRECHECK_SEVERITY_POLICIES = ['blocking', 'advisory'] as const;
export type PrecheckSeverityPolicy = (typeof PRECHECK_SEVERITY_POLICIES)[number];

/** trackingGate 失败三分法（F12，tracking_commit.py 同构）。 */
export const TRACKING_FAILURE_TAXONOMIES = ['validationFailed', 'writeFailed', 'drift'] as const;
export type TrackingFailureTaxonomy = (typeof TRACKING_FAILURE_TAXONOMIES)[number];

/** trackingGate 写入路径强制钩子位：preWrite/postWrite 强制，none=无强制点。 */
export const TRACKING_HOOK_POINTS = ['preWrite', 'postWrite', 'none'] as const;
export type TrackingHookPoint = (typeof TRACKING_HOOK_POINTS)[number];

/** source.license 两值：MIT=上游出处，original=自研配方（R9=A 出处字段化）。 */
export const SOURCE_LICENSES = ['MIT', 'original'] as const;
export type SourceLicense = (typeof SOURCE_LICENSES)[number];

/** F3+R9 出处三件套+炼化注记：commit 全 SHA 落库，短 SHA 仅展示。 */
export interface RecipeSource {
  /** owner/name 或 \"original\"（自研配方）。 */
  readonly repo: string;
  /** 40 位十六进制全 SHA。 */
  readonly commit: string;
  readonly license: SourceLicense;
  /** 炼化转写时间（ISO 日期 YYYY-MM-DD）。 */
  readonly refinedAt: string;
  /** 转写说明：改了什么/为何。 */
  readonly refineNote: string;
}

/** F4 结构化拆分：能力句 + 运行降级语义人读版 + 触发词枚举。 */
export interface RecipeBrief {
  readonly capability: string;
  readonly runtimeSemantics: string;
  readonly triggers: readonly string[];
}

/** F6 入口指令面：路由文档 + 阶段停靠点（防失控）。 */
export interface RecipeEntry {
  readonly routerDoc: string;
  readonly phases: readonly string[];
  readonly stopPoints: readonly string[];
}

/** F7+R3=A 静态声明式触发表条目：四型 + 取值（阶段名/输入键/兜底查询式；always 用空串哨兵）。 */
export interface RecipeLoadCondition {
  readonly type: LoadConditionType;
  readonly value: string;
}

/** R4=A 降级矩阵条目（C 路 F9 六条上游实证的同款可校验形态）。 */
export interface FailureMatrixEntry {
  readonly policy: FailurePolicyKind;
  /** policy=repair|failFast 时必带（schema 条件必填强制）。 */
  readonly repairAction?: string;
}

/** references 条目：条件化加载参考文件 + 自带降级矩阵。 */
export interface RecipeReference {
  readonly path: string;
  readonly loadCondition: RecipeLoadCondition;
  readonly failure: FailureMatrixEntry;
}

/** F8 产物字数预算：目标/上限双值。 */
export interface SizeBudget {
  readonly target: number;
  readonly max: number;
}

/** artifacts 条目：产物路径 + 粒度 + 产读时机 + 预算 + 降级矩阵。 */
export interface RecipeArtifact {
  readonly path: string;
  readonly granularity: string;
  readonly createdPhase: string;
  readonly readTiming: string;
  readonly sizeBudget: SizeBudget;
  readonly failure: FailureMatrixEntry;
}

/** F11 确定性预检：只报告不改写。 */
export interface RecipePrecheck {
  readonly script: string;
  readonly severityPolicy: PrecheckSeverityPolicy;
  readonly retryPolicy: { readonly maxBlockingRetries: number };
}

/**
 * F12+R5=A trackingGate 七件套整槽（tracking_commit.py 同构物）：
 * 配方自描述追踪义务，七字段整槽出现、缺一即拒。
 */
export interface TrackingGate {
  /** 权威态文件。 */
  readonly authorityState: string;
  /** 乐观并发字段（expected_state_revision 同款）。 */
  readonly casField: string;
  /** 提交事务模式枚举。 */
  readonly transactionModes: readonly string[];
  /** 派生视图（可重建）。 */
  readonly derivedViews: readonly { readonly name: string; readonly path: string }[];
  /** 门级预算。 */
  readonly budgets: {
    readonly hotContextBytes: number;
    readonly perChapterReads: readonly string[];
  };
  readonly failureTaxonomy: TrackingFailureTaxonomy;
  readonly hookPoint: TrackingHookPoint;
}

/** F16+R6=A 容量预算入 Schema：不同配方不同热上下文胃口。 */
export interface ContextBudget {
  readonly hotContextBytes: number;
  readonly fixedSections: readonly string[];
  readonly perChapterReads: readonly string[];
}

/** 配方本体：类型化字段全集（F1-F17 裁剪集）。 */
export interface CapabilityRecipe {
  /** F1 kebab-case 全局唯一标识。 */
  readonly id: string;
  /** F2 双轨下游：每配方独立 semver，自由演进不受 schemaVersion 牵制。 */
  readonly recipeVersion: string;
  readonly source: RecipeSource;
  readonly brief: RecipeBrief;
  /**
   * F5 对齐 #31 CapabilityType 词表。词表归运行时注册协议管辖（受控增补），
   * 本层只校形（非空标识符），不在此冻结枚举——registry.registerCapability 是对齐点。
   */
  readonly taskType: string;
  readonly entry: RecipeEntry;
  readonly references: readonly RecipeReference[];
  readonly artifacts: readonly RecipeArtifact[];
  readonly prechecks: readonly RecipePrecheck[];
  readonly trackingGate: TrackingGate;
  readonly contextBudget: ContextBudget;
}

/** R7=A 版本治理块：不兼容升 major 即拒 + 显式退役路径声明（RETIRED 先例）。 */
export interface RecipeVersioning {
  readonly schemaVersionRule: 'incompatible-change-requires-major-reject';
  readonly retiredPaths: readonly string[];
}

/** 文档根：schemaVersion × recipeVersion 双轨（R7）+ 零兼容承诺（R8）。 */
export interface CapabilityRecipeDocument {
  readonly schemaVersion: number;
  readonly recipe: CapabilityRecipe;
  readonly versioning: RecipeVersioning;
  readonly compatibilityPolicy: 'none';
}

/** 加载器错误码：报错文本必须指向具体字段路径（ANWA #28 教训，沿 NoProviderError 先例）。 */
export type RecipeErrorCode =
  | 'RECIPE_FILE_UNREADABLE'
  | 'RECIPE_PARSE_FAILED'
  | 'RECIPE_SCHEMA_UNSUPPORTED_VERSION'
  | 'RECIPE_SCHEMA_INVALID'
  | 'RECIPE_SEMANTIC_INVALID'
  | 'RETIRED_PATH_HIT';

export class RecipeLoadError extends Error {
  override name = 'RecipeLoadError';
  readonly code: RecipeErrorCode;
  constructor(code: RecipeErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}
