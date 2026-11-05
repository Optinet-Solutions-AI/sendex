CREATE TABLE "organisation_postback_keys" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "revenue_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ad_text_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "organisation_postback_keys" ADD CONSTRAINT "organisation_postback_keys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ad_text_id_ad_texts_id_fk" FOREIGN KEY ("ad_text_id") REFERENCES "public"."ad_texts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postbacks_org_received_idx" ON "postbacks" USING btree ("organisation_id","received_at");--> statement-breakpoint
CREATE INDEX "postbacks_campaign_idx" ON "postbacks" USING btree ("campaign_id");