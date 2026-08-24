CREATE TABLE "generation_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"step_id" integer NOT NULL,
	"attempt_no" integer NOT NULL,
	"trigger" text NOT NULL,
	"provider" text,
	"model" text,
	"status" text DEFAULT 'running' NOT NULL,
	"error_class" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generation_events" (
	"job_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_events_job_id_seq_pk" PRIMARY KEY("job_id","seq")
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"novel_id" integer,
	"chapter_id" integer,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"owner" text,
	"lease_until" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"provider_job_id" text,
	"execution_checkpoint_json" jsonb,
	"error_class" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "generation_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"input_snapshot_json" jsonb,
	"output_artifact_id" text,
	"retry_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"generation_id" text,
	"attempt_id" integer,
	"provider" text,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_amount" numeric,
	"currency" text,
	"cost_status" text DEFAULT 'unpriced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD COLUMN "artifact_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD COLUMN "source_step" integer;--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD COLUMN "supersedes_artifact_id" text;--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD COLUMN "stale_reason" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_step_id_generation_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."generation_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_events" ADD CONSTRAINT "generation_events_job_id_generation_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_steps" ADD CONSTRAINT "generation_steps_job_id_generation_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_step_attempt_idx" ON "generation_attempts" USING btree ("step_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_events_job_client_key_idx" ON "generation_events" USING btree ("job_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_novel_idempotency_idx" ON "generation_jobs" USING btree ("novel_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_steps_job_step_key_idx" ON "generation_steps" USING btree ("job_id","step_key");--> statement-breakpoint
CREATE INDEX "usage_ledger_attempt_idx" ON "usage_ledger" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_user_idx" ON "usage_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_generation_idx" ON "usage_ledger" USING btree ("generation_id");--> statement-breakpoint
ALTER TABLE "runtime_artifacts" ADD CONSTRAINT "runtime_artifacts_source_step_generation_steps_id_fk" FOREIGN KEY ("source_step") REFERENCES "public"."generation_steps"("id") ON DELETE set null ON UPDATE no action;