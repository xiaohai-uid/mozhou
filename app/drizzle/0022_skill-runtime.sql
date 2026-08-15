CREATE TABLE "generation_manifests" (
	"generation_id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"model" text NOT NULL,
	"sections_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_roles_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_run_ids_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_plans" (
	"generation_id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer,
	"mode" text NOT NULL,
	"intent_hash" text NOT NULL,
	"plan_json" jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"token_budget" integer DEFAULT 0 NOT NULL,
	"executor" text NOT NULL,
	"input_contract" jsonb NOT NULL,
	"output_contract" jsonb NOT NULL,
	"prompt_text" text,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_definitions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "skill_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"skill_key" text NOT NULL,
	"status" text NOT NULL,
	"input_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_section" jsonb,
	"evidence" text NOT NULL,
	"reason" text,
	"tokens" integer DEFAULT 0 NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_plans" ADD CONSTRAINT "generation_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_definitions" ADD CONSTRAINT "skill_definitions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_runs_generation_id_idx" ON "skill_runs" USING btree ("generation_id");
--> statement-breakpoint
-- V1.3 内置五个默认创作技能种子（契约 §2；幂等，重复执行不产生新行）
INSERT INTO "skill_definitions" (key, user_id, name, description, role, kind, trigger, enabled, priority, token_budget, executor, input_contract, output_contract, prompt_text, builtin) VALUES
('story_grounding', NULL, '故事状态', '作品上下文与连续性：按当前章节筛选人物状态、世界观、时间线、伏笔与已发生事实，输出本章上下文包。', 'story_grounding', 'context', 'pre_write', true, 10, 1200, 'story_grounding', '{"sources":[{"kind":"novel_tracking","required":true},{"kind":"rag","required":false},{"kind":"chapter","required":false}]}', '{"artifactKind":"context_pack","structured":true}', NULL, true),
('chapter_planning', NULL, '章节规划', '结构与节奏：读取卷纲、剧情单元与本章细纲，确认情绪目标、冲突推进、爽点铺垫与章尾钩子，输出章节任务卡。', 'chapter_planning', 'planner', 'pre_write', true, 20, 900, 'chapter_planning', '{"sources":[{"kind":"novel_tracking","required":true},{"kind":"chapter","required":false}]}', '{"artifactKind":"chapter_task_card","structured":true}', NULL, true),
('audience_genre', NULL, '读者与题材', '题材与市场参照：读取已绑定市场简报，提炼题材期待、节奏密度、功能位与差异化约束，不把榜单书名当正文素材。', 'audience_genre', 'context', 'pre_write', true, 30, 700, 'audience_genre', '{"sources":[{"kind":"market_brief","required":true}]}', '{"artifactKind":"market_note","structured":true}', NULL, true),
('narrative_style', NULL, '叙事声音', '文风与自然表达：读取本书风格指南，控制句式、叙事视角、对话声线与情绪节奏。', 'narrative_style', 'context', 'pre_write', true, 40, 600, 'narrative_style', '{"sources":[{"kind":"style","required":true}]}', '{"artifactKind":"style_note","structured":true}', NULL, true),
('quality_gate', NULL, '成稿质量门', '连续性与质量门：候选生成后校验——一致性组（事实冲突/细纲覆盖/章尾推动力/元信息泄漏/禁用句式/退化）与 AI 味组分开记录，不通过返回具体返工原因。', 'quality_gate', 'validator', 'post_write', true, 50, 1200, 'quality_gate', '{"sources":[{"kind":"candidate","required":true},{"kind":"novel_tracking","required":false}]}', '{"artifactKind":"check_report","structured":true}', NULL, true)
ON CONFLICT ("key") DO NOTHING;