ALTER TABLE "deconstruction_runs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deconstruction_runs" ADD COLUMN "last_error_class" text;--> statement-breakpoint
ALTER TABLE "deconstruction_runs" ADD COLUMN "last_attempt_at" timestamp;
