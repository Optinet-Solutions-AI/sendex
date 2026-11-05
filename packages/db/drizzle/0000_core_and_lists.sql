CREATE TYPE "public"."member_role" AS ENUM('owner', 'campaign_manager', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"country" char(2) NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"custom1" text,
	"custom2" text,
	"custom3" text,
	"custom4" text,
	"custom5" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"flushed_at" timestamp with time zone,
	"bad" boolean DEFAULT false NOT NULL,
	"bad_reason" text
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" char(2) NOT NULL,
	"numbers_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_upload_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_action_idx" ON "audit_log" USING btree ("organisation_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_e164_idx" ON "contacts" USING btree ("organisation_id","e164");--> statement-breakpoint
CREATE UNIQUE INDEX "list_members_list_contact_idx" ON "list_members" USING btree ("list_id","contact_id");--> statement-breakpoint
CREATE INDEX "list_members_list_sent_idx" ON "list_members" USING btree ("list_id","sent_at");--> statement-breakpoint
CREATE INDEX "list_members_contact_idx" ON "list_members" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_e164_idx" ON "suppressions" USING btree ("organisation_id","e164");