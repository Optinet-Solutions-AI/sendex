CREATE TABLE "organisation_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid
);
--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "refused" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laps" ADD COLUMN "refusal_reason" text;--> statement-breakpoint
ALTER TABLE "organisation_alerts" ADD CONSTRAINT "organisation_alerts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_alerts" ADD CONSTRAINT "organisation_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_alerts_period_idx" ON "organisation_alerts" USING btree ("organisation_id","kind","period_key");--> statement-breakpoint
CREATE INDEX "organisation_alerts_open_idx" ON "organisation_alerts" USING btree ("organisation_id","acknowledged_at");