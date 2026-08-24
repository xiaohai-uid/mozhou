CREATE TABLE "ranking_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"author" text,
	"category" text,
	"rank" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_snapshots_board_book_captured_idx" ON "ranking_snapshots" USING btree ("board_id","book_id","captured_at");--> statement-breakpoint
CREATE INDEX "ranking_snapshots_board_captured_idx" ON "ranking_snapshots" USING btree ("board_id","captured_at");
