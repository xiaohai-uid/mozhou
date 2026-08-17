ALTER TABLE "usage_ledger" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "task_id" text;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "source_class" text DEFAULT 'PUBLIC_FREE' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "credential_owner" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "billing_owner" text DEFAULT 'provider' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "route" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "status" text DEFAULT 'succeeded' NOT NULL;