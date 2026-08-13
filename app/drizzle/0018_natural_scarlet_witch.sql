CREATE TABLE "novel_trackings" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"state_revision" integer DEFAULT 0 NOT NULL,
	"state_json" jsonb NOT NULL,
	"current_chapter_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "novel_trackings_novel_id_unique" UNIQUE("novel_id")
);
--> statement-breakpoint
CREATE TABLE "story_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"chapter_id" integer NOT NULL,
	"chapter_revision" integer NOT NULL,
	"checks_json" jsonb NOT NULL,
	"source" text DEFAULT 'storyrepo' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_tracking_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"chapter_id" integer NOT NULL,
	"chapter_revision" integer NOT NULL,
	"status" text DEFAULT 'settled' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"checks_json" jsonb NOT NULL,
	"facts_json" jsonb NOT NULL,
	"settled_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"chapter_id" integer,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"output_json" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "novel_trackings" ADD CONSTRAINT "novel_trackings_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_trackings" ADD CONSTRAINT "novel_trackings_current_chapter_id_chapters_id_fk" FOREIGN KEY ("current_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reviews" ADD CONSTRAINT "story_reviews_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_reviews" ADD CONSTRAINT "story_reviews_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tracking_records" ADD CONSTRAINT "story_tracking_records_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_tracking_records" ADD CONSTRAINT "story_tracking_records_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workflow_runs" ADD CONSTRAINT "story_workflow_runs_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workflow_runs" ADD CONSTRAINT "story_workflow_runs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_tracking_records_novel_chapter_idx" ON "story_tracking_records" USING btree ("novel_id","chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_workflow_runs_novel_idempotency_idx" ON "story_workflow_runs" USING btree ("novel_id","idempotency_key");