CREATE TABLE "campaign_segments" (
	"campaign_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "campaign_segments_campaign_id_segment_id_pk" PRIMARY KEY("campaign_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"global_exclude" boolean DEFAULT false NOT NULL,
	"size" integer,
	"good" integer,
	"stats_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_segments" ADD CONSTRAINT "campaign_segments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_segments" ADD CONSTRAINT "campaign_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_segments" ADD CONSTRAINT "campaign_segments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_org_idx" ON "segments" USING btree ("organisation_id","created_at");