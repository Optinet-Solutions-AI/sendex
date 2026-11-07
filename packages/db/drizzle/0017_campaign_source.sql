CREATE TYPE "public"."campaign_source" AS ENUM('dashboard', 'api');--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "source" "campaign_source" DEFAULT 'dashboard' NOT NULL;