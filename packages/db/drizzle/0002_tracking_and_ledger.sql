CREATE TYPE "public"."ledger_kind" AS ENUM('deposit', 'debit', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."postback_type" AS ENUM('lead', 'sale');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_micro" bigint NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lap_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"country" char(2),
	"user_agent" text,
	"device" text,
	"operator" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lap_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"sender_id" text NOT NULL,
	"text" text NOT NULL,
	"encoding" text NOT NULL,
	"parts" integer DEFAULT 1 NOT NULL,
	"route_id" uuid NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"short_code" text,
	"dynamic_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "postbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"type" "postback_type" NOT NULL,
	"dynamic_id" text NOT NULL,
	"message_id" uuid,
	"campaign_id" uuid,
	"lap_id" uuid,
	"value_micro" bigint,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_lap_id_laps_id_fk" FOREIGN KEY ("lap_id") REFERENCES "public"."laps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lap_id_laps_id_fk" FOREIGN KEY ("lap_id") REFERENCES "public"."laps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postbacks" ADD CONSTRAINT "postbacks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postbacks" ADD CONSTRAINT "postbacks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postbacks" ADD CONSTRAINT "postbacks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postbacks" ADD CONSTRAINT "postbacks_lap_id_laps_id_fk" FOREIGN KEY ("lap_id") REFERENCES "public"."laps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_idx" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_org_created_idx" ON "ledger_entries" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "clicks_lap_idx" ON "clicks" USING btree ("lap_id");--> statement-breakpoint
CREATE INDEX "clicks_message_idx" ON "clicks" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_key_idx" ON "messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "messages_lap_status_idx" ON "messages" USING btree ("lap_id","status");--> statement-breakpoint
CREATE INDEX "messages_org_created_idx" ON "messages" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_short_code_idx" ON "messages" USING btree ("short_code");--> statement-breakpoint
CREATE INDEX "messages_dynamic_id_idx" ON "messages" USING btree ("dynamic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "postbacks_event_key_idx" ON "postbacks" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "postbacks_dynamic_id_idx" ON "postbacks" USING btree ("dynamic_id");