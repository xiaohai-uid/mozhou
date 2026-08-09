CREATE TYPE "public"."chapter_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"ch" text NOT NULL,
	"title" text NOT NULL,
	"status" "chapter_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worldview_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"novel_id" integer NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_entries" ADD CONSTRAINT "character_entries_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worldview_entries" ADD CONSTRAINT "worldview_entries_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;