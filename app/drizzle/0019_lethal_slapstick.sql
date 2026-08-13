CREATE TABLE "deconstruction_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"novel_id" integer,
	"title" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_length" integer NOT NULL,
	"request_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_json" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deconstruction_runs" ADD CONSTRAINT "deconstruction_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deconstruction_runs" ADD CONSTRAINT "deconstruction_runs_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deconstruction_runs_user_request_idx" ON "deconstruction_runs" USING btree ("user_id","request_key");