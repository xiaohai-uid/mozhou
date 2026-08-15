CREATE TABLE "artifact_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"artifact_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_bindings" ADD CONSTRAINT "artifact_bindings_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_bindings_novel_artifact_idx" ON "artifact_bindings" USING btree ("novel_id","artifact_id");