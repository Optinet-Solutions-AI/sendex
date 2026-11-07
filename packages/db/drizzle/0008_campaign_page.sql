ALTER TABLE "campaigns" ADD COLUMN "autosender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "profit_micro" bigint DEFAULT 0 NOT NULL;