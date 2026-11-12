CREATE TABLE "campaign_routes" (
	"campaign_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_routes_campaign_id_route_id_pk" PRIMARY KEY("campaign_id","route_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_routes" ADD CONSTRAINT "campaign_routes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_routes" ADD CONSTRAINT "campaign_routes_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_routes" ADD CONSTRAINT "campaign_routes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;