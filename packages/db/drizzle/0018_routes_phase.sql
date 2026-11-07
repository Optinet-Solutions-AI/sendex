ALTER TYPE "public"."ledger_kind" ADD VALUE 'fee';--> statement-breakpoint
CREATE TABLE "route_connection_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"source" text NOT NULL,
	"host" text NOT NULL,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "routing_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"country" char(2) NOT NULL,
	"route_order" uuid[] DEFAULT '{}' NOT NULL,
	"disabled_routes" uuid[] DEFAULT '{}' NOT NULL,
	"locked_route" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"type" text NOT NULL,
	"country" char(2) NOT NULL,
	"route_ids" uuid[] DEFAULT '{}' NOT NULL,
	"sender_modes" text[] DEFAULT '{}' NOT NULL,
	"custom_sender" text,
	"text_presets" text[] DEFAULT '{}' NOT NULL,
	"custom_text" text,
	"recipient" text,
	"test_networks" text[] DEFAULT '{}' NOT NULL,
	"hypothesis" text,
	"jitter" boolean DEFAULT false NOT NULL,
	"cascade" boolean DEFAULT false NOT NULL,
	"schedule_days" integer[],
	"schedule_times" text[],
	"last_slot" text,
	"tests_ran" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"cost_micro" bigint DEFAULT 0 NOT NULL,
	"queue_status" text DEFAULT 'queued' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "lap_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "secret" text;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "routing_strategy" text DEFAULT 'custom_first' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD COLUMN "custom_route_fee_micro" bigint DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "test_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "operator" text;--> statement-breakpoint
ALTER TABLE "route_connection_events" ADD CONSTRAINT "route_connection_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_connection_events" ADD CONSTRAINT "route_connection_events_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_exceptions" ADD CONSTRAINT "routing_exceptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_exceptions" ADD CONSTRAINT "routing_exceptions_locked_route_routes_id_fk" FOREIGN KEY ("locked_route") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_tests" ADD CONSTRAINT "sms_tests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_tests" ADD CONSTRAINT "sms_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "route_connection_events_route_at_idx" ON "route_connection_events" USING btree ("route_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_exceptions_org_country_idx" ON "routing_exceptions" USING btree ("organisation_id","country");--> statement-breakpoint
CREATE INDEX "sms_tests_org_created_idx" ON "sms_tests" USING btree ("organisation_id","created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_test_id_sms_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."sms_tests"("id") ON DELETE cascade ON UPDATE no action;