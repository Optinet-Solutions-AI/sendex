CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'paused', 'stopped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."contact_reuse" AS ENUM('account_wide', 'per_campaign');--> statement-breakpoint
CREATE TYPE "public"."lap_status" AS ENUM('queued', 'sending', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "ad_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"text" text NOT NULL,
	"encoding" text NOT NULL,
	"parts" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"campaign_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "campaign_links_campaign_id_link_id_pk" PRIMARY KEY("campaign_id","link_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_lists" (
	"campaign_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "campaign_lists_campaign_id_list_id_pk" PRIMARY KEY("campaign_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_sid_group" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"sid_group_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"timezone" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"contact_reuse" "contact_reuse" DEFAULT 'account_wide' NOT NULL,
	"test_size" integer DEFAULT 200 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"test_size" integer NOT NULL,
	"status" "lap_status" DEFAULT 'queued' NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"cost_micro" bigint DEFAULT 0 NOT NULL,
	"rank" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"sid_group_id" uuid NOT NULL,
	"value" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sid_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"price_micro" bigint NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"country" char(2),
	"active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_texts" ADD CONSTRAINT "ad_texts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_texts" ADD CONSTRAINT "ad_texts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lists" ADD CONSTRAINT "campaign_lists_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lists" ADD CONSTRAINT "campaign_lists_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_lists" ADD CONSTRAINT "campaign_lists_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sid_group" ADD CONSTRAINT "campaign_sid_group_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sid_group" ADD CONSTRAINT "campaign_sid_group_sid_group_id_sid_groups_id_fk" FOREIGN KEY ("sid_group_id") REFERENCES "public"."sid_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sid_group" ADD CONSTRAINT "campaign_sid_group_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laps" ADD CONSTRAINT "laps_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_ids" ADD CONSTRAINT "sender_ids_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_ids" ADD CONSTRAINT "sender_ids_sid_group_id_sid_groups_id_fk" FOREIGN KEY ("sid_group_id") REFERENCES "public"."sid_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sid_groups" ADD CONSTRAINT "sid_groups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_prices" ADD CONSTRAINT "route_prices_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_texts_campaign_position_idx" ON "ad_texts" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "laps_campaign_idx" ON "laps" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_ids_group_value_idx" ON "sender_ids" USING btree ("sid_group_id","value");--> statement-breakpoint
CREATE INDEX "route_prices_route_country_valid_idx" ON "route_prices" USING btree ("route_id","country","valid_from");