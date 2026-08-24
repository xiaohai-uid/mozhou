CREATE TABLE "runtime_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" integer,
	"provenance_json" jsonb NOT NULL,
	"token_budget" integer DEFAULT 0 NOT NULL,
	"data_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_artifacts_artifact_id_unique" UNIQUE("artifact_id")
);
