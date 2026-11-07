CREATE TABLE "enrichment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"daily_limit" integer DEFAULT 5000 NOT NULL,
	"monthly_budget_micro" bigint DEFAULT 25000000 NOT NULL,
	"on_schedule" boolean DEFAULT true NOT NULL,
	"after_upload" boolean DEFAULT false NOT NULL,
	"as_you_send" boolean DEFAULT false NOT NULL,
	"include_archived" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookup_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" char(2) NOT NULL,
	"route" text NOT NULL,
	"method" text NOT NULL,
	"price_micro" bigint NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lookup_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"country" char(2) NOT NULL,
	"status" text NOT NULL,
	"method" text NOT NULL,
	"operator" text,
	"ported" boolean DEFAULT false NOT NULL,
	"price_micro" bigint DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"request_id" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"source" text NOT NULL,
	"list_id" uuid,
	"rule_id" uuid,
	"limit" integer NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"good" integer DEFAULT 0 NOT NULL,
	"bad" integer DEFAULT 0 NOT NULL,
	"no_verdict" integer DEFAULT 0 NOT NULL,
	"cost_micro" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "enrichment_rules" ADD CONSTRAINT "enrichment_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_results" ADD CONSTRAINT "lookup_results_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_rule_id_enrichment_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."enrichment_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_rules_org_country_idx" ON "enrichment_rules" USING btree ("organisation_id","country");--> statement-breakpoint
CREATE INDEX "lookup_prices_country_valid_idx" ON "lookup_prices" USING btree ("country","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_results_org_e164_idx" ON "lookup_results" USING btree ("organisation_id","e164");--> statement-breakpoint
CREATE INDEX "lookup_results_org_country_idx" ON "lookup_results" USING btree ("organisation_id","country");--> statement-breakpoint
CREATE INDEX "verification_requests_org_at_idx" ON "verification_requests" USING btree ("organisation_id","requested_at");