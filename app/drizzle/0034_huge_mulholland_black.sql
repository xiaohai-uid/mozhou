ALTER TABLE "usage_ledger" ALTER COLUMN "prompt_tokens" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "prompt_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "completion_tokens" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "completion_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "usage_status" text DEFAULT 'unknown' NOT NULL;