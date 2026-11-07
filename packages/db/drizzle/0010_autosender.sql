ALTER TABLE "campaigns" ADD COLUMN "autosender_measure_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "autosender_scale_factor" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "autosender_ctr_floor_percent" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "autosender_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "autosender_stop_reason" text;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "autosender" boolean DEFAULT false NOT NULL;