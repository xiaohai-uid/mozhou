CREATE TABLE "novel_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"first_chapter_id" integer NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "novel_workflows_novel_id_unique" UNIQUE("novel_id")
);
--> statement-breakpoint
ALTER TABLE "novels" ADD COLUMN "bootstrap_request_key" text;--> statement-breakpoint
ALTER TABLE "novel_workflows" ADD CONSTRAINT "novel_workflows_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novel_workflows" ADD CONSTRAINT "novel_workflows_first_chapter_id_chapters_id_fk" FOREIGN KEY ("first_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "novels_user_bootstrap_request_key_idx" ON "novels" USING btree ("user_id","bootstrap_request_key");