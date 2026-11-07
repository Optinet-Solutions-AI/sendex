ALTER TABLE "laps" ADD COLUMN "budget_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "previews" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "scheduled_at" timestamp with time zone;