ALTER TABLE "chapter_messages" ADD COLUMN "generation_key" text;--> statement-breakpoint
ALTER TABLE "chapter_messages" ADD COLUMN "base_revision" integer;--> statement-breakpoint
ALTER TABLE "chapter_messages" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_messages_chapter_generation_key_idx" ON "chapter_messages" USING btree ("chapter_id","generation_key");