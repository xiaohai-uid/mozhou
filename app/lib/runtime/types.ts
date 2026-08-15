/**
 * Skill 运行时契约类型（FROZEN）。
 * 契约真源：.scratch/mozhou-workbench-a/contracts/01-技能运行时契约.md
 * 本文件是类型层面的唯一实现；字段变更必须先走 Contract Delta。
 */

/** 五个默认创作角色（互斥边界）：见契约 §2。 */
export type SkillRole =
  | "story_grounding"
  | "chapter_planning"
  | "audience_genre"
  | "narrative_style"
  | "quality_gate";

export type SkillKind = "context" | "planner" | "validator";

export type SkillTrigger = "pre_write" | "post_write" | "explicit";

export type SkillInputSourceKind =
  | "novel_tracking"
  | "rag"
  | "chapter"
  | "style"
  | "market_brief"
  | "benchmark_pack"
  | "candidate";

export interface SkillInputContract {
  sources: Array<{ kind: SkillInputSourceKind; required: boolean }>;
}

export type ArtifactKind =
  | "context_pack"
  | "chapter_task_card"
  | "market_note"
  | "style_note"
  | "check_report"
  | "market_brief"
  | "benchmark_pack";

export interface SkillOutputContract {
  artifactKind: ArtifactKind;
  structured: boolean;
}

export interface SkillDefinition {
  key: string;
  name: string;
  description: string;
  role: SkillRole;
  kind: SkillKind;
  trigger: SkillTrigger;
  /** 默认开启 = 可按阶段被路由调用；不是每轮注入。 */
  enabled: boolean;
  priority: number;
  tokenBudget: number;
  /** 执行器注册表 key（lib/runtime/skill-registry.ts）。 */
  executor: string;
  builtin: boolean;
  input: SkillInputContract;
  output: SkillOutputContract;
  /** 自定义技能的 system prompt（内置为 null，prompt 由执行器生成）。 */
  promptText?: string | null;
}

export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactKind;
  version: string;
  scope: "novel" | "chapter" | "session" | "global";
  scopeId: number | null;
  provenance: { source: string; capturedAt: string };
  tokenBudget: number;
  /** 被 ContextAssembler 裁剪时置 true；裁剪不静默。 */
  culled: boolean;
}

export type SkillRunStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "degraded"
  | "skipped";

export type SkillEvidence = "applied" | "not_applied";

export interface SkillRun {
  runId: string;
  generationId: string;
  skillKey: string;
  status: SkillRunStatus;
  inputRefs: ArtifactRef[];
  outputRefs: ArtifactRef[];
  /** 该技能产物实际进入模型的区段（assembler 裁决后）；只记 kind + tokens。 */
  promptSection: { kind: string; tokens: number } | null;
  evidence: SkillEvidence;
  reason: string | null;
  executedAt: string;
}

export interface GenerationPlan {
  generationId: string;
  intent: { summary: string; hash: string };
  route: { mode: "independent" | "chapter"; phase: "generation" | "discussion" };
  plannedSkills: Array<{
    skillKey: string;
    trigger: SkillTrigger;
    status: "planned";
    reason?: string;
  }>;
  artifactRefs: ArtifactRef[];
  contextBudget: { total: number; perSection: Record<string, number> };
  createdAt: string;
}

/** 到达模型的精确载荷脱敏清单（白名单纪律，绝不记录正文/prompt）。 */
export interface GenerationManifest {
  generationId: string;
  requestId: string;
  model: string;
  sections: Array<{ kind: string; tokens: number }>;
  messageRoles: Array<"user" | "assistant" | "system">;
  skillRuns: Array<{ runId: string; skillKey: string; evidence: SkillEvidence }>;
  currentUserPresent: boolean;
  createdAt: string;
}

/** 执行器上下文：归属验证完成后由运行时注入。 */
export interface SkillExecutorContext {
  userId: number;
  novelId: number | null;
  chapterId: number | null;
  /** 当前章节正文（章节模式；供故事状态/章节规划取参考）。 */
  chapterContent: string | null;
  request: string;
  definition: SkillDefinition;
  /** post_write 校验输入：生成候选正文（质量门）。 */
  candidate?: string | null;
  /** 显式引用（风格/市场绑定等由执行器自查 DB）。 */
  styleId?: number | null;
}

export interface SkillExecutorOutput {
  status: "completed" | "degraded";
  reason?: string;
  artifact: {
    kind: ArtifactKind;
    /** 结构化产物数据；由 ContextAssembler 渲染为区段。 */
    data: unknown;
    /** 估算 token 数（assembler 预算裁剪依据）。 */
    tokenEstimate: number;
    /** 持久化产物（runtime_artifacts）引用；运行时产物缺省用 runId。 */
    artifactId?: string;
  };
}

export interface SkillExecutor {
  run(ctx: SkillExecutorContext): Promise<SkillExecutorOutput>;
}

export type RuntimePhase = "generation" | "discussion";
