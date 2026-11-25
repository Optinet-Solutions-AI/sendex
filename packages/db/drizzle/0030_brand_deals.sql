CREATE TABLE "brand_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"deal_key" text NOT NULL,
	"program" text NOT NULL,
	"brand" text NOT NULL,
	"deal" text NOT NULL,
	"top_geos" text DEFAULT '' NOT NULL,
	"cpa_micro" bigint,
	"reason" text,
	"starts_on" date NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "deal_key" text;--> statement-breakpoint
ALTER TABLE "postbacks" ADD COLUMN "revenue_micro" bigint;--> statement-breakpoint
ALTER TABLE "brand_deals" ADD CONSTRAINT "brand_deals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_deals_org_key_starts_idx" ON "brand_deals" USING btree ("organisation_id","deal_key","starts_on");--> statement-breakpoint
-- D5-16: revenue now comes only from brand deals (ADR 0012). Lap revenue held the tracker's
-- amounts; with no deals uploaded yet, nothing has been earned.
UPDATE "laps" SET "revenue_micro" = 0 WHERE "revenue_micro" <> 0;
