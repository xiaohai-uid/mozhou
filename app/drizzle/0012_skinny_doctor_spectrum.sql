CREATE TABLE "chapter_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"inserted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_messages" ADD CONSTRAINT "chapter_messages_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_messages" ADD CONSTRAINT "chapter_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;