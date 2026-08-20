import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ArtifactRef,
  GenerationPlan,
  SkillInputContract,
  SkillOutputContract,
} from "@/lib/runtime/types";

/** 会员等级（11 工单消费） */
export const tierEnum = pgEnum("tier", ["free", "member"]);

/** 对话消息角色（04 工单） */
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

/** 用户（02 工单扩展认证字段） */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tier: tierEnum("tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 对话会话（04 工单；novelId 绑定当前写作作品，06 工单 R3 决策落地） */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新会话"),
  novelId: integer("novel_id").references(() => novels.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 对话消息（04 工单） */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 章节状态（05 工单） */
export const chapterStatusEnum = pgEnum("chapter_status", ["draft", "final"]);

/** 小说项目（05 工单；sessions.novel_id 绑定由此表承载） */
export const novels = pgTable("novels", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** RAG 注入开关（06 收尾：projects 页开关绑定，false 时对话不检索该作品设定） */
  ragEnabled: boolean("rag_enabled").notNull().default(true),
  /** 快速开始请求键：同一用户重试首写创建时返回原有作品，避免重复作品。 */
  bootstrapRequestKey: text("bootstrap_request_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  bootstrapRequestKeyIdx: uniqueIndex("novels_user_bootstrap_request_key_idx").on(
    table.userId,
    table.bootstrapRequestKey,
  ),
}));

/** 章节（05 工单；content 正文列 16 工单 V1.1 Journey ⑦ 加入） */
export const chapters = pgTable("chapters", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  ch: text("ch").notNull(), // 章节号（"001"）
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  status: chapterStatusEnum("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** 正文乐观并发版本；每次正文实际变化递增。 */
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  novelChapterKey: uniqueIndex("chapters_novel_id_ch_idx").on(table.novelId, table.ch),
}));

/** 首写工作流状态：作品创建与第一章创建的正式状态真源。 */
export const novelWorkflows = pgTable("novel_workflows", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .unique()
    .references(() => novels.id, { onDelete: "cascade" }),
  firstChapterId: integer("first_chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "restrict" }),
  state: text("state").notNull().default("ready"), // ready | writing | active
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DeconstructionMode = "long" | "short";

export interface DeconstructionStage {
  stage: number;
  name: string;
  status: "completed";
  artifact: DeconstructionArtifact;
}

export interface DeconstructionArtifact {
  id: string;
  kind: string;
  schemaVersion: number;
  [key: string]: unknown;
}

export interface DeconstructionResult {
  /** Legacy summary projection retained for existing consumers. */
  structure: string[];
  plot: string[];
  rhythm: string[];
  /** The selected oh-story-compatible analysis route. */
  mode: DeconstructionMode;
  /** Structured stage artifacts. The UI and downstream writing flows consume these. */
  stages: DeconstructionStage[];
  quality: {
    sourceLength: number;
    chapterCount: number;
    completedStages: number[];
    warnings: string[];
  };
}

/** 用户自有正文的拆解运行记录；结果可恢复，源文只存摘要哈希与长度，不重复保存正文。 */
export const deconstructionRuns = pgTable("deconstruction_runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  novelId: integer("novel_id").references(() => novels.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  sourceHash: text("source_hash").notNull(),
  sourceLength: integer("source_length").notNull(),
  requestKey: text("request_key").notNull(),
  status: text("status").notNull().default("pending"),
  result: jsonb("result_json").$type<DeconstructionResult>(),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastErrorClass: text("last_error_class"),
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  requestIdx: uniqueIndex("deconstruction_runs_user_request_idx").on(table.userId, table.requestKey),
}));

/**
 * 作品级长篇追踪真源（storyrepo adapter）。派生状态卡/伏笔/时间线都从这里重建，
 * 不把页面缓存或模型输出当作长期事实。
 */
export interface StoryTrackingState {
  statusCard: {
    currentChapterId: number | null;
    currentChapter: string | null;
    settledChapters: number;
    lastSettledAt: string | null;
  };
  characterStates: Array<{ name: string; state: string; chapterId: number }>;
  promises: Array<{ id?: string; text: string; status: "open" | "resolved"; chapterId: number }>;
  timeline: Array<{ text: string; chapterId: number; chapter: string; kind?: "fact" | "reveal" | "private" }>;
  readerKnowledge: Array<{ text: string; chapterId: number }>;
  chapterRecords: Array<{
    chapterId: number;
    chapter: string;
    title: string;
    revision: number;
    wordCount: number;
    checksPassed: number;
    checksTotal: number;
    settledAt: string;
  }>;
}

/** storyrepo 作品级单一权威状态。 */
export const novelTrackings = pgTable("novel_trackings", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .unique()
    .references(() => novels.id, { onDelete: "cascade" }),
  stateRevision: integer("state_revision").notNull().default(0),
  state: jsonb("state_json").$type<StoryTrackingState>().notNull(),
  currentChapterId: integer("current_chapter_id").references(() => chapters.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 每章一次结算后的可审计记录；正文仍以 chapters 为唯一正文真源。 */
export const storyTrackingRecords = pgTable("story_tracking_records", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  chapterRevision: integer("chapter_revision").notNull(),
  status: text("status").notNull().default("settled"),
  wordCount: integer("word_count").notNull().default(0),
  checks: jsonb("checks_json").$type<Array<{ name: string; ok: boolean; detail: string }>>().notNull(),
  facts: jsonb("facts_json").$type<Record<string, unknown>>().notNull(),
  settledAt: timestamp("settled_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  novelChapterIdx: uniqueIndex("story_tracking_records_novel_chapter_idx").on(
    table.novelId,
    table.chapterId,
  ),
}));

/** 章节审查历史；每次结算保留结果，不用“当前页面状态”冒充历史。 */
export const storyReviews = pgTable("story_reviews", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  chapterRevision: integer("chapter_revision").notNull(),
  checks: jsonb("checks_json").$type<Array<{ name: string; ok: boolean; detail: string }>>().notNull(),
  source: text("source").notNull().default("storyrepo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 章节工作流运行记录：幂等键、阶段、终态和可恢复输出。 */
export const storyWorkflowRuns = pgTable("story_workflow_runs", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull().default("running"),
  output: jsonb("output_json").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idempotencyIdx: uniqueIndex("story_workflow_runs_novel_idempotency_idx").on(
    table.novelId,
    table.idempotencyKey,
  ),
}));

/** 人物库条目（05 工单） */
export const characterEntries = pgTable("character_entries", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 世界观条目（05 工单） */
export const worldviewEntries = pgTable("worldview_entries", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 用量事件（11 工单）：每次 LLM 调用记账一行，/api/v1/account 聚合展示 */
export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 功能节点：写作对话/风格蒸馏/小说拆解/抽卡模式 */
  nodeType: text("node_type").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 书架（08 工单）：从书源导入的书，供阅读参考与拆解 */
export const shelfBooks = pgTable("shelf_books", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source").notNull(),
  author: text("author"),
  site: text("site"),
  status: text("status"),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

/** 自定义技能契约（V1.3 工单 08 收尾）：声明执行类型/触发阶段后技能才「已接入正式写作」（ADR-0002 决策 7）。 */
export interface CustomSkillContract {
  kind: "context" | "planner";
  trigger: "pre_write" | "explicit";
  input: { sources: Array<{ kind: string; required: boolean }> };
  output: { artifactKind: "custom_section"; structured: boolean };
}

/** 技能（任务二-A）：声明式技能 = 名称 + 说明 + 系统提示词，chat 可加载注入 */
export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  /** 广场来源：墨舟官方 / 社区 */
  author: text("author").notNull().default("自定义"),
  /** 输入契约（V1.3）：null = 未声明 → 不注入正式写作、UI 标记未接入 */
  contract: jsonb("contract").$type<CustomSkillContract>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** WebDAV 同步配置（任务二-C）：每用户一条，保存后连接测试 */
export const syncConfigs = pgTable("sync_configs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  username: text("username").notNull(),
  /** 应用密码密文（AES-256-GCM；密钥来自 AUTH_SECRET，不回传客户端） */
  password: text("password").notNull(),
  autoSync: boolean("auto_sync").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 风格指南（蒸馏产物，四维）——POST /distill 返回、styles 表存储、chat 按 styleId 注入（工单 14/15） */
export interface StyleGuide {
  narrative: string; // 叙事视角
  sentence: string; // 句式节奏
  imagery: string; // 意象偏好
  rhythm: string; // 情绪节奏
}

/** 风格库（工单 14）：用户保存的风格指南，命名/列表/删除；同名允许（与 skills 一致，无唯一约束） */
export const styles = pgTable("styles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  guide: jsonb("guide_json").$type<StyleGuide>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 章节对话消息（工单 17，V1.1 Journey ⑦）：章节 AI 对话留存（Q1），assistant 带技能/正文快照 */
export const chapterMessages = pgTable("chapter_messages", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  /** 生效技能快照（assistant） */
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  /** 生成时正文快照（插入冲突检测基准，assistant） */
  snapshot: text("snapshot").notNull().default(""),
  /**
   * user 消息历史沿用 done；assistant 候选状态：
   * generating | completed_candidate | stopped | error | applied | discarded。
   */
  status: text("status").notNull().default("done"),
  inserted: boolean("inserted").notNull().default(false),
  /** 客户端生成请求身份；同一章节重复提交同一键只复用同一候选。 */
  generationKey: text("generation_key"),
  /** 生成请求内容的不可逆指纹，用于防止同一 key 被复用到另一条请求。 */
  requestHash: text("request_hash"),
  /** 候选生成时章节的 revision；确认时必须仍匹配。 */
  baseRevision: integer("base_revision"),
  /** 生成候选绑定的单次 Attempt；迟到的旧 Attempt 不得结算。 */
  attemptId: integer("attempt_id").references(() => generationAttempts.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  /** Stable client-facing failure taxonomy; errorMessage remains a safe human hint. */
  errorCode: text("error_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  generationKeyIdx: uniqueIndex("chapter_messages_chapter_generation_key_idx").on(
    table.chapterId,
    table.generationKey,
  ),
}));



/** ===== 技能运行时（V1.3，工单 01；契约见 .scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md） ===== */

/** SkillDefinition：内置五角色（user_id NULL）+ 自定义（user_id 非空）。 */
export const skillDefinitions = pgTable("skill_definitions", {
  id: serial("id").primaryKey(),
  /** 稳定键："story_grounding" 等；自定义前缀 "custom:"。 */
  key: text("key").notNull().unique(),
  /** NULL = 内置；非空 = 用户自定义。 */
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull(),
  trigger: text("trigger").notNull(),
  /** 默认开启 = 可按阶段被路由调用；不是每轮注入。 */
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  tokenBudget: integer("token_budget").notNull().default(0),
  /** 执行器注册表 key（lib/runtime/skill-registry.ts）。 */
  executor: text("executor").notNull(),
  inputContract: jsonb("input_contract").$type<SkillInputContract>().notNull(),
  outputContract: jsonb("output_contract").$type<SkillOutputContract>().notNull(),
  /** 自定义技能的 system prompt（内置为 null）。 */
  promptText: text("prompt_text"),
  builtin: boolean("builtin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** SkillRun：一次生成中某技能的执行记录（planned→completed/failed/degraded/skipped + evidence）。 */
export const skillRuns = pgTable("skill_runs", {
  id: serial("id").primaryKey(),
  /** uuid 运行证据身份；与 SSE done.skillRuns 的 runId 一致。 */
  runId: text("run_id").notNull().unique(),
  generationId: text("generation_id").notNull(),
  skillKey: text("skill_key").notNull(),
  status: text("status").notNull(),
  inputRefs: jsonb("input_refs").$type<ArtifactRef[]>().notNull().default([]),
  outputRefs: jsonb("output_refs").$type<ArtifactRef[]>().notNull().default([]),
  /** 实际进入模型的区段（assembler 裁决后）：{ kind, tokens }，绝不记录正文。 */
  promptSection: jsonb("prompt_section").$type<{ kind: string; tokens: number } | null>(),
  /** 任务运行时对齐（Q6）：挂到 generation_attempts.id。 */

  attemptId: integer("attempt_id").references(() => generationAttempts.id, { onDelete: "set null" }),

  evidence: text("evidence").notNull(),
  reason: text("reason"),
  tokens: integer("tokens").notNull().default(0),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  generationIdx: index("skill_runs_generation_id_idx").on(table.generationId),
}));

/** GenerationPlan：模型调用之前冻结的计划；generationId 幂等（同候选重试复用）。 */
export const generationPlans = pgTable("generation_plans", {
  generationId: text("generation_id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** session | chapter（作用域归属验证后写入）。 */
  scopeType: text("scope_type").notNull(),
  scopeId: integer("scope_id"),
  mode: text("mode").notNull(),
  intentHash: text("intent_hash").notNull(),
  plan: jsonb("plan_json").$type<GenerationPlan>().notNull(),
  status: text("status").notNull().default("planned"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** GenerationManifest：到达模型的精确载荷脱敏清单（白名单纪律）。 */
export const generationManifests = pgTable("generation_manifests", {
  generationId: text("generation_id").primaryKey(),
  requestId: text("request_id").notNull(),
  model: text("model").notNull(),
  sections: jsonb("sections_json").$type<Array<{ kind: string; tokens: number }>>().notNull().default([]),
  messageRoles: jsonb("message_roles_json").$type<Array<"user" | "assistant" | "system">>().notNull().default([]),
  skillRunIds: jsonb("skill_run_ids_json").$type<Array<string>>().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 持久化运行时产物（V1.3 工单 03）：check_report 等可查证据；MarketBrief/BenchmarkPack 复用（05/06）。 */
export const runtimeArtifacts = pgTable("runtime_artifacts", {
  id: serial("id").primaryKey(),
  artifactId: text("artifact_id").notNull().unique(),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  scope: text("scope").notNull(),
  scopeId: integer("scope_id"),
  provenance: jsonb("provenance_json").$type<{ source: string; capturedAt: string }>().notNull(),
  tokenBudget: integer("token_budget").notNull().default(0),
  data: jsonb("data_json").notNull(),
  /** 任务运行时扩展（ADR-0007）：内容指纹与产物状态判定。 */
  contentHash: text("content_hash"),
  /** current | stale | missing | blocked（spec §6.2）。 */
  artifactStatus: text("artifact_status").notNull().default("current"),
  /** 产出来源 step（generation_steps.id）。 */
  sourceStep: integer("source_step").references(() => generationSteps.id, { onDelete: "set null" }),
  /** 被本产物取代的 artifact_id（版本链）。 */
  supersedes: text("supersedes_artifact_id"),
  staleReason: text("stale_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 产物-作品绑定（V1.3 工单 05）：MarketBrief/BenchmarkPack 按作品绑定，绑定须归属校验。 */
export const artifactBindings = pgTable("artifact_bindings", {
  id: serial("id").primaryKey(),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull(),
  /** 绑定角色：market_brief / benchmark_pack。 */
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  novelArtifactIdx: uniqueIndex("artifact_bindings_novel_artifact_idx").on(
    table.novelId,
    table.artifactId,
  ),
}));

/** 榜单历史快照（T2/T3 趋势）：每轮扫榜把各 enabled 榜前 20 名落库。 */
export const rankingSnapshots = pgTable("ranking_snapshots", {
  id: serial("id").primaryKey(),
  boardId: text("board_id").notNull(),
  bookId: text("book_id").notNull(),
  name: text("name").notNull(),
  author: text("author"),
  /** 题材（详情页 categoryV2；无则 NULL） */
  category: text("category"),
  rank: integer("rank").notNull(),
  /** 扫榜时间戳；同一轮所有行同值，幂等键之一 */
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  boardBookCaptureIdx: uniqueIndex("ranking_snapshots_board_book_captured_idx").on(
    table.boardId,
    table.bookId,
    table.capturedAt,
  ),
  boardCaptureIdx: index("ranking_snapshots_board_captured_idx").on(
    table.boardId,
    table.capturedAt,
  ),
}));
/** ===== 可恢复创作任务运行时（ADR-0007；spec .scratch/mozhou-task-runtime/spec.md §6.2） ===== */

/** generation_jobs：任务权威记录；job 与 step 共用状态枚举（spec §6.1 Q1）。 */
export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  /** uuid；与 generationId 强制 1:1（Q6），SkillRun 挂 attempt。 */
  jobId: text("job_id").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  novelId: integer("novel_id").references(() => novels.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  /** chapter_generation | deconstruction | import | ranking_scan | market_brief ... */
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  inputHash: text("input_hash").notNull(),
  /** TaskStatus：planned→queued→running→waiting_retry→succeeded/failed/cancelled。 */
  status: text("status").notNull().default("planned"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  /** worker 身份与租约（claim/心跳/过期回收）。 */
  owner: text("owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  /** 上游供应商 job 身份（恢复续跑/不重复扣费锚点）。 */
  providerJobId: text("provider_job_id"),
  /** 提交时冻结的 checkpoint（provider/model/endpoint 身份，防在途切换）。 */
  executionCheckpoint: jsonb("execution_checkpoint_json").$type<Record<string, unknown>>(),
  errorClass: text("error_class"),
  /** 人工结束原因/终态说明（票 09）。 */

  errorMessage: text("error_message"),

  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  novelIdempotencyIdx: uniqueIndex("generation_jobs_novel_idempotency_idx").on(
    // novel_id 可空（扫榜/市场等无作品任务）：NULL 不参与唯一约束，用 COALESCE 统一
    sql`coalesce(${table.novelId}, 0)`,
    table.idempotencyKey,
  ),
  statusIdx: index("generation_jobs_status_idx").on(table.status),
}));

/** generation_steps：job 的步骤投影；状态枚举与 job 共用。 */
export const generationSteps = pgTable("generation_steps", {
  id: serial("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => generationJobs.jobId, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  ordinal: integer("ordinal").notNull(),
  status: text("status").notNull().default("planned"),
  /** 步骤输入快照（冻结，重试/审计依据）。 */
  inputSnapshot: jsonb("input_snapshot_json"),
  outputArtifactId: text("output_artifact_id"),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobStepKeyIdx: uniqueIndex("generation_steps_job_step_key_idx").on(table.jobId, table.stepKey),
}));

/** generation_attempts：单次模型调用尝试；append-only（成本账本锚点）。 */
export const generationAttempts = pgTable("generation_attempts", {
  id: serial("id").primaryKey(),
  stepId: integer("step_id")
    .notNull()
    .references(() => generationSteps.id, { onDelete: "cascade" }),
  attemptNo: integer("attempt_no").notNull(),
  /** initial | auto_retry | manual_retry | recovery_reissue */
  trigger: text("trigger").notNull(),
  provider: text("provider"),
  model: text("model"),
  /** AttemptStatus：queued/running/succeeded/failed/cancelled。 */
  status: text("status").notNull().default("running"),
  errorClass: text("error_class"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => ({
  stepAttemptIdx: uniqueIndex("generation_attempts_step_attempt_idx").on(
    table.stepId,
    table.attemptNo,
  ),
}));

/** generation_events：append-only 事件日志；seq 为 SSE 续传游标（Q2：首版只写任务事件）。 */
export const generationEvents = pgTable("generation_events", {
  jobId: text("job_id")
    .notNull()
    .references(() => generationJobs.jobId, { onDelete: "cascade" }),
  seq: bigint("seq", { mode: "number" }).notNull(),
  eventType: text("event_type").notNull(),
  /** 脱敏白名单字段（kind/status/tokens），绝不记正文/prompt。 */
  payload: jsonb("payload_json").notNull().default({}),
  /** 幂等键：同 (job, client_key) 只写一次。 */
  clientKey: text("client_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobSeqPk: primaryKey({ columns: [table.jobId, table.seq] }),
  jobClientKeyIdx: uniqueIndex("generation_events_job_client_key_idx").on(
    table.jobId,
    table.clientKey,
  ),
}));

/** usage_ledger：调用级成本账本（Q3 新表）；attempt 级、append-only、未归因保留。 */
export const usageLedger = pgTable("usage_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 客户请求与任务身份；generationId 继续作为生成幂等/回放锚点。 */
  requestId: text("request_id"),
  taskId: text("task_id"),
  /** 与 generation_plans.generationId 对齐（Q6：1:1）。 */
  generationId: text("generation_id"),
  attemptId: integer("attempt_id").references(() => generationAttempts.id, {
    onDelete: "set null",
  }),
  /** T6 authoritative source/economics identity；不从全局 token 反推。 */
  sourceClass: text("source_class").notNull().default("PUBLIC_FREE"),
  provider: text("provider"),
  model: text("model"),
  credentialOwner: text("credential_owner").notNull().default("platform"),
  billingOwner: text("billing_owner").notNull().default("provider"),
  route: text("route").notNull().default("legacy"),
  /** provider call terminal status：succeeded/failed/cancelled。 */
  status: text("status").notNull().default("succeeded"),
  /** reported = provider supplied usage; unknown = provider omitted usage. */
  usageStatus: text("usage_status").notNull().default("unknown"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  /** 可空：无价格时 NULL，costStatus=unpriced（不显示 0 元）。 */
  costAmount: numeric("cost_amount"),
  currency: text("currency"),
  /** priced | unpriced | partially_priced。 */
  costStatus: text("cost_status").notNull().default("unpriced"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  attemptIdx: index("usage_ledger_attempt_idx").on(table.attemptId),
  userIdx: index("usage_ledger_user_idx").on(table.userId),
  generationIdx: index("usage_ledger_generation_idx").on(table.generationId),
}));
