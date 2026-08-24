ALTER TABLE "skill_runs" ADD COLUMN "run_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_run_id_unique" UNIQUE("run_id");