CREATE TABLE "organisation_settings" (
	"organisation_id" uuid PRIMARY KEY NOT NULL,
	"low_balance_threshold_micro" bigint,
	"low_balance_emails" text[] DEFAULT '{}' NOT NULL,
	"low_balance_alerted_at" timestamp with time zone,
	"daily_message_cap" integer,
	"daily_spend_cap_micro" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_settings" ADD CONSTRAINT "organisation_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;